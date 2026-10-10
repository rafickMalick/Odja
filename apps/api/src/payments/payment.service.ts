import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { PaymentCheckoutConfig } from '@oja/contracts';
import { Prisma as PrismaRuntime } from '@oja/db';
import type { Prisma } from '@oja/db';
import {
  deriveOrderStatus,
  needsProduction,
  productionDaysFor,
  type PaymentProvider,
  type ProviderPaymentStatus,
  type WebhookEvent,
} from '@oja/domain';

import { LedgerService } from '../ledger/ledger.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from '../notifications/notification.service';
import { PAYMENT_PROVIDER } from './payment-provider.factory';
import { SimulatedPaymentProvider } from './simulated.provider';

/**
 * Encaissement hors commande (billets d'exposition). Renvoie vrai si la
 * notification lui appartenait et a été traitée.
 */
export interface ExternalPaymentHandler {
  handleWebhookEvent(event: WebhookEvent): Promise<boolean>;
}

/**
 * Confirmation d'un encaissement.
 *
 * Ce service est le point de rencontre entre l'argent et la commande. Il sera
 * appelé demain par le webhook de l'agrégateur, il l'est aujourd'hui par la
 * route de simulation — **par le même chemin**, avec les mêmes contrôles et
 * les mêmes écritures. C'est ce qui garantit que brancher l'agrégateur ne
 * changera rien au reste.
 */
@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);
  private readonly isProduction: boolean;
  private readonly webOrigin: string;

  /** Voir `useExternalPayments`. */
  private external: ExternalPaymentHandler | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly simulated: SimulatedPaymentProvider,
    private readonly notifications: NotificationService,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    config: ConfigService,
  ) {
    this.isProduction = config.get<string>('NODE_ENV') === 'production';
    this.webOrigin = config.get<string>('WEB_ORIGIN', 'http://localhost:3000');
  }

  /**
   * Inscrit un module qui encaisse autre chose que des commandes — les
   * billets d'exposition. L'agrégateur n'a qu'une adresse de webhook : une
   * notification qui ne correspond à aucun paiement de commande lui est
   * proposée avant d'être écartée.
   */
  useExternalPayments(handler: ExternalPaymentHandler): void {
    this.external = handler;
  }

  /**
   * Amorce l'encaissement d'un paiement fraîchement créé.
   *
   * Rendue distincte de la création de la commande : `OrderService` sait
   * construire une commande, il n'a pas à savoir parler à un agrégateur. Le
   * fournisseur actif ne se choisit qu'ici — et changer de fournisseur, demain,
   * ne touche donc qu'un fichier.
   */
  async initiateCheckout(
    paymentId: string,
    customer: { fullName: string; email: string; phone: string },
  ): Promise<PaymentCheckoutConfig> {
    const payment = await this.prisma.payment.findUniqueOrThrow({
      where: { id: paymentId },
      include: { order: { select: { reference: true } } },
    });

    const initiated = await this.provider.initiate({
      paymentId: payment.id,
      orderReference: payment.order.reference,
      amountXof: payment.amountXof,
      channel: payment.channel,
      customer,
      callbackUrl: `${this.webOrigin}/confirmation?commande=${payment.order.reference}`,
    });

    await this.prisma.payment.update({
      where: { id: paymentId },
      data: { providerRef: initiated.reference, provider: this.provider.name },
    });

    return {
      mode: initiated.checkout.mode,
      amountXof: initiated.checkout.amountXof,
      reference: initiated.reference,
      ...(initiated.checkout.publicKey !== undefined
        ? { publicKey: initiated.checkout.publicKey }
        : {}),
      ...(initiated.checkout.redirectUrl !== undefined
        ? { redirectUrl: initiated.checkout.redirectUrl }
        : {}),
      ...(initiated.checkout.sandbox !== undefined
        ? { sandbox: initiated.checkout.sandbox }
        : {}),
    };
  }

  /**
   * Simule l'encaissement d'une commande.
   *
   * Réservée au développement et à la recette : elle refuse de s'exécuter en
   * production, où seul un webhook signé fait foi.
   */
  async simulatePayment(orderReference: string): Promise<{ status: string }> {
    if (this.isProduction) {
      throw new BadRequestException(
        "La simulation de paiement est refusée en production : seul un webhook signé fait foi.",
      );
    }

    const payment = await this.prisma.payment.findFirst({
      where: { order: { reference: orderReference }, status: { in: ['INITIATED', 'PENDING'] } },
      orderBy: { initiatedAt: 'desc' },
    });
    if (!payment) throw new NotFoundException('Aucun paiement en attente pour cette commande.');

    const reference = payment.providerRef ?? `SIM-${payment.id}`;
    const status = this.simulated.markPaid(reference, payment.amountXof);

    await this.prisma.payment.update({
      where: { id: payment.id },
      data: { providerRef: reference },
    });

    return this.applyProviderStatus(payment.id, status);
  }

  /**
   * Applique le résultat annoncé par le fournisseur.
   *
   * C'est ici que se tiennent les contrôles du § 7.5 du cahier. Le plus
   * important est celui du **montant** : un paiement partiel silencieusement
   * accepté est une perte sèche, et une commande marquée payée alors qu'elle
   * ne l'est pas met un atelier au travail pour rien.
   */
  async applyProviderStatus(
    paymentId: string,
    status: ProviderPaymentStatus,
  ): Promise<{ status: string }> {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      include: { order: true },
    });
    if (!payment) throw new NotFoundException();

    // Idempotence : rejouer une confirmation ne doit rien réécrire. Le webhook
    // réel arrive parfois deux fois.
    if (payment.status === 'PAID') return { status: 'PAID' };

    if (status.status === 'pending') return { status: payment.status };

    if (status.status === 'failed') {
      await this.prisma.payment.update({
        where: { id: paymentId },
        data: {
          status: 'FAILED',
          failedAt: new Date(),
          failureCode: status.code,
          failureMessage: status.message,
        },
      });
      await this.releaseStock(paymentId);
      return { status: 'FAILED' };
    }

    if (status.paymentId && status.paymentId !== payment.id) {
      /* La transaction a été ouverte pour un autre paiement. Sans ce contrôle,
         la transaction réglée pour une commande pourrait en confirmer une
         autre du même montant, présentée à la vérification par le client. */
      await this.flag(
        paymentId,
        `transaction rattachée à un autre paiement : ${status.paymentId}`,
      );
      throw new BadRequestException("Cette transaction n'appartient pas à cette commande.");
    }

    if (status.currency !== 'XOF') {
      await this.flag(paymentId, `devise inattendue : ${status.currency}`);
      throw new BadRequestException('Devise inattendue sur ce paiement.');
    }

    if (status.amountXof !== payment.amountXof) {
      /* Divergence de montant : on n'encaisse pas, et on alerte. Accepter
         silencieusement un paiement partiel coûterait la différence à chaque
         fois, sans que personne ne s'en aperçoive. */
      await this.flag(
        paymentId,
        `montant divergent : attendu ${payment.amountXof}, reçu ${status.amountXof}`,
      );
      throw new BadRequestException(
        'Le montant encaissé ne correspond pas au montant attendu. Un administrateur a été alerté.',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.payment.update({
        where: { id: paymentId },
        data: {
          status: 'PAID',
          paidAt: status.paidAt,
          paidAmountXof: status.amountXof,
          netAmountXof: status.netAmountXof,
          feeXof: status.feeXof,
        },
      });

      await this.confirmOrder(tx, payment.orderId);

      const order = await tx.order.findUniqueOrThrow({
        where: { id: payment.orderId },
        include: { subOrders: { select: { makerId: true, itemsMakerSubtotalXof: true } } },
      });

      // `order.upfrontXof` : ce qui a été payé en ligne. Le solde éventuel
      // devient une créance que le livreur recouvrera à la réception.
      await this.ledger.recordOrderPaid(tx, order);
      await this.ledger.recordPspFee(tx, { id: paymentId, feeXof: status.feeXof });
    });

    await this.announceConfirmedOrder(payment.orderId);

    this.logger.log(`Paiement ${paymentId} encaissé (${status.amountXof} F CFA)`);
    return { status: 'PAID' };
  }

  /**
   * Confirme une commande qui n'attend aucun paiement en ligne (paiement à la
   * livraison). Mêmes bascules et mêmes écritures qu'un encaissement : le
   * montant tout entier est inscrit comme créance, que le livreur recouvrera.
   *
   * Appelée **dans la transaction de création de la commande** : une commande
   * qui existe sans être confirmée, et sans paiement à expirer, ne se
   * terminerait jamais.
   */
  async confirmWithoutOnlinePayment(tx: Prisma.TransactionClient, orderId: string): Promise<void> {
    await this.confirmOrder(tx, orderId);

    const order = await tx.order.findUniqueOrThrow({
      where: { id: orderId },
      include: { subOrders: { select: { makerId: true, itemsMakerSubtotalXof: true } } },
    });
    await this.ledger.recordOrderPaid(tx, order);
  }

  /**
   * Prévient chaque atelier qu'une commande l'attend.
   *
   * Les avis partent après la transaction : le délai de 48 h vient de
   * s'ouvrir pour chaque atelier, et un artisan qui l'apprend deux jours plus
   * tard en rafraîchissant sa page a déjà perdu la commande. Un envoi qui
   * échoue ne doit évidemment pas défaire l'encaissement.
   */
  async announceConfirmedOrder(orderId: string): Promise<void> {
    const confirmed = await this.prisma.subOrder.findMany({
      where: { orderId, status: 'PAYMENT_CONFIRMED' },
      select: { id: true },
    });
    for (const subOrder of confirmed) {
      await this.notifications.subOrderReceived(subOrder.id);
    }
  }

  /**
   * Fait basculer la commande et ses sous-commandes à l'encaissement.
   *
   * Chaque atelier reçoit sa sous-commande en « Paiement confirmé » : c'est le
   * signal qui ouvre son délai de réponse de 48 h. Le stock réservé devient
   * définitivement consommé.
   */
  async confirmOrder(tx: Prisma.TransactionClient, orderId: string): Promise<void> {
    const order = await tx.order.findUniqueOrThrow({
      where: { id: orderId },
      include: { subOrders: { include: { lines: { include: { product: true } } } } },
    });

    for (const subOrder of order.subOrders) {
      if (subOrder.status !== 'RECEIVED') continue;

      const lines = subOrder.lines.map((line) => ({
        isMadeToOrder: line.product.isMadeToOrder,
        leadTimeDays: line.product.leadTimeDays,
      }));

      await tx.subOrder.update({
        where: { id: subOrder.id },
        data: {
          status: 'PAYMENT_CONFIRMED',
          // Le délai de fabrication n'est qu'une prévision tant que l'atelier
          // n'a pas accepté ; il sera recalculé à l'acceptation.
          dueReadyAt: needsProduction(lines)
            ? new Date(Date.now() + productionDaysFor(lines) * 86_400_000)
            : null,
        },
      });

      for (const line of subOrder.lines) {
        if (line.product.isMadeToOrder) continue;
        // La réservation devient une sortie de stock : la pièce est vendue.
        await tx.product.update({
          where: { id: line.productId },
          data: {
            quantityAvailable: { decrement: line.quantity },
            quantityReserved: { decrement: line.quantity },
          },
        });
      }
    }

    const statuses = await tx.subOrder.findMany({
      where: { orderId },
      select: { status: true },
    });

    await tx.order.update({
      where: { id: orderId },
      data: {
        status: deriveOrderStatus(
          statuses.map((s) => s.status),
          true,
        ),
        placedAt: new Date(),
      },
    });
  }

  /**
   * Relâche le stock réservé quand un paiement échoue ou expire.
   *
   * Sans cela, une pièce unique reste invendable après un simple abandon de
   * paiement.
   */
  async releaseStock(paymentId: string): Promise<void> {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      include: {
        order: { include: { subOrders: { include: { lines: { include: { product: true } } } } } },
      },
    });
    if (!payment) return;

    await this.prisma.$transaction(async (tx) => {
      for (const subOrder of payment.order.subOrders) {
        for (const line of subOrder.lines) {
          if (line.product.isMadeToOrder) continue;
          await tx.product.update({
            where: { id: line.productId },
            data: { quantityReserved: { decrement: line.quantity } },
          });
        }
      }
      await tx.order.update({
        where: { id: payment.orderId },
        data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: 'Paiement non abouti' },
      });
      await tx.subOrder.updateMany({
        where: { orderId: payment.orderId },
        data: { status: 'CANCELLED' },
      });
    });
  }

  /**
   * Balaie les paiements expirés.
   *
   * Destinée à une tâche planifiée. Un paiement resté en attente au-delà de
   * son délai immobilise du stock : mieux vaut le libérer et laisser le client
   * recommencer.
   *
   * **Une dernière vérification précède l'expiration.** Sans elle, un webhook
   * perdu en route ferait expirer une commande que le client a réellement
   * payée : il aurait payé, rien ne se serait passé, et il recommencerait —
   * double encaissement, litige assuré. Le fournisseur simulé répond toujours
   * `pending` ici, donc ce garde-fou ne change rien au comportement de
   * développement.
   */
  async expireStalePayments(): Promise<number> {
    const stale = await this.prisma.payment.findMany({
      where: { status: { in: ['INITIATED', 'PENDING'] }, expiresAt: { lt: new Date() } },
      select: { id: true, providerRef: true },
    });

    let expired = 0;

    for (const payment of stale) {
      const status = payment.providerRef
        ? await this.provider.verify(payment.providerRef).catch((error: unknown) => {
            this.logger.warn(
              `Vérification impossible pour ${payment.providerRef} : ${error instanceof Error ? error.message : String(error)}`,
            );
            return { status: 'pending' } as ProviderPaymentStatus;
          })
        : ({ status: 'pending' } as ProviderPaymentStatus);

      if (status.status === 'paid') {
        // Le fournisseur dit « payé » alors que rien n'est arrivé : on
        // rattrape par ce même chemin, plutôt que de perdre l'encaissement.
        await this.applyProviderStatus(payment.id, status);
        this.logger.warn(
          `Paiement ${payment.id} rattrapé à l'expiration — le webhook n'était jamais arrivé`,
        );
        continue;
      }

      await this.prisma.payment.update({
        where: { id: payment.id },
        data: { status: 'EXPIRED' },
      });
      await this.releaseStock(payment.id);
      expired++;
    }

    if (expired > 0) {
      this.logger.log(`${expired} paiement(s) expiré(s), stock relâché`);
    }
    return expired;
  }

  /**
   * Traite un webhook déjà authentifié par le fournisseur.
   *
   * L'idempotence tient à la contrainte d'unicité de `PaymentEvent` sur
   * `(providerRef, eventType, signature)` : une même notification rejouée —
   * l'agrégateur le fait volontiers en cas de doute sur la première livraison
   * — produit une violation de contrainte, que l'on traite comme un succès
   * silencieux plutôt que comme une erreur. Rejeter une notification déjà
   * traitée ferait revenir l'agrégateur à la charge, encore et encore.
   */
  async handleWebhook(rawBody: Buffer, signature: string | undefined): Promise<{ status: string }> {
    const event = this.provider.parseWebhook(rawBody, signature);

    /* Le statut annoncé n'est repris que s'il se confirme auprès du
       fournisseur — voir `PaymentProvider.verifiesWebhooks`. Une erreur de
       vérification remonte : le fournisseur réessaiera, ce qui vaut mieux que
       d'appliquer un statut non confirmé. */
    if (this.provider.verifiesWebhooks && event.status.status !== 'pending') {
      event.status = await this.provider.verify(event.reference);
    }

    /* `event.paymentId` — quand le fournisseur a pu le fournir — est NOTRE
       identifiant, posé dans les métadonnées à l'amorce du paiement : c'est
       la correspondance fiable. `providerRef` est un repli, utile tant que
       cette référence n'a pas encore été apprise (voir plus bas) ou pour un
       fournisseur qui échoue la sienne en écho fidèle de la nôtre. */
    const payment = event.paymentId
      ? await this.prisma.payment.findUnique({ where: { id: event.paymentId } })
      : await this.prisma.payment.findFirst({ where: { providerRef: event.reference } });

    if (!payment && this.external && (await this.external.handleWebhookEvent(event))) {
      return { status: 'processed' };
    }

    if (!payment) {
      /* Un webhook sur une référence inconnue est un signal, pas une erreur
         de format : soit l'agrégateur nous notifie d'un paiement qu'on n'a
         jamais amorcé, soit quelqu'un teste le point d'entrée. Journalisé,
         pas traité — mais toujours répondu 200, pour ne pas déclencher de
         réessais sur un cas qui ne se résoudra jamais. */
      this.logger.warn(`Webhook reçu pour une référence inconnue : ${event.reference}`);
      return { status: 'ignored' };
    }

    if (payment.providerRef !== event.reference) {
      /* Première nouvelle de la référence que Kadev Pay a réellement
         attribuée à cette transaction — `initiate()` ne pouvait que deviner.
         La corriger ici est ce qui rend `verify()` utilisable ensuite : sans
         elle, la vérification active de la page de confirmation et le
         balayage périodique interrogeraient l'agrégateur avec notre propre
         identifiant, qu'il n'a jamais vu. */
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: { providerRef: event.reference },
      });
    }

    try {
      await this.prisma.paymentEvent.create({
        data: {
          paymentId: payment.id,
          providerRef: event.reference,
          eventType: event.eventType,
          signature: event.dedupeKey ?? signature ?? '',
          rawBody: rawBody.toString('utf8'),
          payload: JSON.parse(rawBody.toString('utf8')) as Prisma.InputJsonValue,
          signatureOk: true,
        },
      });
    } catch (error) {
      if (
        error instanceof PrismaRuntime.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        this.logger.log(`Webhook déjà traité (${event.reference}/${event.eventType}) — ignoré`);
        return { status: 'already_processed' };
      }
      throw error;
    }

    return this.applyProviderStatus(payment.id, event.status);
  }

  /**
   * Vérification active, à l'ouverture de la page de confirmation — ou
   * juste après le widget, depuis la page de paiement elle-même.
   *
   * Le client peut atterrir sur `/confirmation` avant que le webhook n'ait eu
   * le temps d'arriver — l'agrégateur redirige souvent plus vite qu'il ne
   * notifie. Sans ce contrôle, la page afficherait « en attente » à quelqu'un
   * qui vient de payer, pendant de longues secondes d'inquiétude inutile.
   *
   * `knownProviderRef`, quand fourni, vient du widget lui-même
   * (`onSuccess`, voir `openKadevPayCheckout`) : c'est la référence que Kadev
   * Pay a réellement attribuée à la transaction. Sans elle, `providerRef`
   * vaut encore l'identifiant posé par `initiateCheckout` — que Kadev Pay ne
   * reconnaît pas — et `verify()` répondrait 404 tant qu'aucun webhook n'est
   * venu la corriger. C'est ce qui permet de confirmer un paiement réel sans
   * dépendre d'un webhook joignable (donc d'une URL publique).
   */
  async verifyPending(
    orderReference: string,
    knownProviderRef?: string,
  ): Promise<{ status: string }> {
    const payment = await this.prisma.payment.findFirst({
      where: { order: { reference: orderReference }, status: { in: ['INITIATED', 'PENDING'] } },
      orderBy: { initiatedAt: 'desc' },
    });
    if (!payment) return { status: 'PENDING' };

    let providerRef = payment.providerRef;
    if (knownProviderRef && knownProviderRef !== providerRef) {
      try {
        await this.prisma.payment.update({
          where: { id: payment.id },
          data: { providerRef: knownProviderRef },
        });
        providerRef = knownProviderRef;
      } catch (error) {
        /* Contrainte d'unicité sur `providerRef` : cette référence est déjà
           celle d'un autre paiement. Un client qui rejoue la référence d'une
           transaction qui n'est pas la sienne ne doit ni faire planter la
           requête, ni faire confirmer sa commande — on retombe simplement sur
           la référence déjà connue de CE paiement. */
        if (
          !(error instanceof PrismaRuntime.PrismaClientKnownRequestError) ||
          error.code !== 'P2002'
        ) {
          throw error;
        }
        this.logger.warn(
          `Référence Kadev Pay ${knownProviderRef} déjà attribuée à un autre paiement — ignorée pour ${payment.id}`,
        );
      }
    }
    if (!providerRef) return { status: 'PENDING' };

    const status = await this.provider.verify(providerRef);
    if (status.status === 'pending') return { status: 'PENDING' };

    return this.applyProviderStatus(payment.id, status);
  }

  private async flag(paymentId: string, reason: string): Promise<void> {
    this.logger.error(`ALERTE paiement ${paymentId} : ${reason}`);
    await this.prisma.paymentEvent.create({
      data: {
        paymentId,
        eventType: 'anomaly',
        rawBody: '',
        payload: { reason },
        signatureOk: false,
        error: reason,
      },
    });
  }
}
