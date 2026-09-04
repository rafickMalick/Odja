import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';

import { PaymentService } from '../payments/payment.service';
import { SubOrderService } from '../orders/sub-order.service';
import { ValidationService } from '../orders/validation.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Ce qui doit arriver sans que personne ne clique.
 *
 * Quatre règles du cahier client sont des **échéances**, pas des actions : le
 * silence du client vaut acceptation au bout de 72 h, celui du créateur vaut
 * refus au bout de 48 h, le versement part 24 h après la validation, et un
 * paiement jamais confirmé doit rendre le stock qu'il retient. Tant que
 * personne ne les déclenche, elles ne sont que du texte.
 *
 * Deux garde-fous tiennent cet ordonnanceur :
 *
 *   · **toutes les tâches sont idempotentes**. Chacune sélectionne son travail
 *     par une condition qui cesse d'être vraie une fois le travail fait ; la
 *     rejouer ne double rien. C'est ce qui permet de les laisser aussi
 *     accessibles à la main depuis le back-office ;
 *   · **une seule instance travaille**. Un verrou consultatif PostgreSQL, pris
 *     et rendu à chaque passage, évite que deux conteneurs libèrent deux fois
 *     le même versement. Sans lui, la mise à l'échelle horizontale serait un
 *     incident financier.
 */
@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);
  private readonly enabled: boolean;

  constructor(
    private readonly validation: ValidationService,
    private readonly subOrders: SubOrderService,
    private readonly payments: PaymentService,
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.enabled = config.get<boolean>('SCHEDULER_ENABLED', true);
    if (!this.enabled) {
      this.logger.warn('Ordonnanceur désactivé (SCHEDULER_ENABLED=false)');
    }
  }

  /**
   * Validation automatique des livraisons restées sans réponse.
   *
   * Toutes les heures : le délai est de 72 h, une précision à l'heure suffit
   * largement, et ne réveille pas la base toutes les minutes pour rien.
   */
  @Cron(CronExpression.EVERY_HOUR, { name: 'auto-validate' })
  async autoValidate(): Promise<void> {
    await this.run('validation automatique', async () => {
      const result = await this.validation.autoValidateStale();
      return result.validated;
    });
  }

  /** Libération des versements échus. Même cadence, même raison. */
  @Cron(CronExpression.EVERY_HOUR, { name: 'release-payouts' })
  async releasePayouts(): Promise<void> {
    await this.run('libération des versements', () => this.validation.releaseDuePayouts());
  }

  /** Sous-commandes qu'aucun créateur n'a acceptées : le silence vaut refus. */
  @Cron(CronExpression.EVERY_HOUR, { name: 'expire-unanswered' })
  async expireUnanswered(): Promise<void> {
    await this.run('refus des commandes sans réponse', () => this.subOrders.expireUnanswered());
  }

  /** Relance des ateliers avant l'expiration du délai de réponse (LN-06). */
  @Cron(CronExpression.EVERY_HOUR, { name: 'remind-pending-makers' })
  async remindPendingMakers(): Promise<void> {
    await this.run('relance des ateliers', () => this.subOrders.remindPending());
  }

  /**
   * Paiements abandonnés.
   *
   * Toutes les cinq minutes, contrairement aux autres : chaque paiement
   * abandonné retient du stock qu'un autre client ne peut pas commander. Le
   * délai d'expiration se compte en minutes, la tâche doit suivre.
   */
  @Cron(CronExpression.EVERY_5_MINUTES, { name: 'expire-stale-payments' })
  async expireStalePayments(): Promise<void> {
    await this.run('expiration des paiements', () => this.payments.expireStalePayments());
  }

  /**
   * Exécution commune.
   *
   * Elle ne laisse jamais une exception remonter : une tâche qui échoue doit
   * apparaître dans les journaux et laisser les suivantes tourner, pas abattre
   * le processus. Et elle ne journalise que le travail réellement fait — un
   * « 0 traité » toutes les heures noie les lignes qui comptent.
   */
  private async run(label: string, work: () => Promise<number>): Promise<void> {
    if (!this.enabled) return;

    const key = lockKeyFor(label);
    const acquired = await this.tryLock(key);
    if (!acquired) {
      // Une autre instance s'en occupe. Ce n'est pas une erreur, c'est le
      // fonctionnement attendu à plusieurs conteneurs.
      this.logger.debug(`${label} : déjà en cours ailleurs, passage ignoré`);
      return;
    }

    try {
      const count = await work();
      if (count > 0) this.logger.log(`${label} : ${count} élément(s) traité(s)`);
    } catch (error) {
      this.logger.error(
        `${label} : échec — ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      await this.unlock(key);
    }
  }

  private async tryLock(key: number): Promise<boolean> {
    try {
      const rows = await this.prisma.$queryRaw<
        { locked: boolean }[]
      >`SELECT pg_try_advisory_lock(${key}::bigint) AS locked`;
      return rows[0]?.locked === true;
    } catch (error) {
      /* Un verrou indisponible ne doit pas empêcher la seule instance d'une
         installation mono-conteneur de travailler : on journalise et on
         continue. Le risque de double exécution est nul à un exemplaire, et
         les tâches sont de toute façon idempotentes. */
      this.logger.warn(
        `Verrou indisponible (${error instanceof Error ? error.message : String(error)}), exécution sans exclusion`,
      );
      return true;
    }
  }

  private async unlock(key: number): Promise<void> {
    try {
      await this.prisma.$queryRaw`SELECT pg_advisory_unlock(${key}::bigint)`;
    } catch {
      // Le verrou tombe de toute façon à la fermeture de la session.
    }
  }
}

/**
 * Clé de verrou dérivée du nom de la tâche.
 *
 * Une simple somme de caractères suffirait à collisionner ; on prend un hachage
 * façon FNV-1a, borné à 31 bits pour rester dans le `bigint` signé attendu par
 * `pg_try_advisory_lock`.
 */
function lockKeyFor(label: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < label.length; index++) {
    hash ^= label.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return Math.abs(hash | 0) % 0x7fffffff;
}
