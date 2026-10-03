import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NewsletterReceipt } from '@oja/contracts';

import { maskEmail } from '../notifications/email.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Abonnés à la newsletter.
 *
 * **La base fait foi.** Chaque inscription y est enregistrée, Brevo configuré
 * ou non : une adresse confiée par un visiteur ne doit pas dépendre d'un
 * service tiers pour exister.
 *
 * **Brevo reçoit une copie** quand `BREVO_API_KEY` et
 * `BREVO_NEWSLETTER_LIST_ID` sont renseignées : les campagnes partent de là,
 * et Brevo y gère lui-même le lien de désinscription. La copie est faite sans
 * faire attendre le visiteur ; un échec est journalisé et laisse
 * `brevoSyncedAt` à nul, ce qui désigne les adresses à rattraper.
 */

const BREVO_CONTACTS_ENDPOINT = 'https://api.brevo.com/v3/contacts';
const SYNC_TIMEOUT_MS = 10_000;

@Injectable()
export class NewsletterService {
  private readonly logger = new Logger(NewsletterService.name);
  private readonly brevoApiKey: string | null;
  private readonly brevoListId: number | null;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.brevoApiKey = config.get<string>('BREVO_API_KEY')?.trim() || null;
    this.brevoListId = config.get<number>('BREVO_NEWSLETTER_LIST_ID') ?? null;
  }

  async subscribe(email: string, source = 'footer'): Promise<NewsletterReceipt> {
    /* Une adresse déjà inscrite ne change rien ; une adresse désinscrite qui
       revient renouvelle son consentement. */
    const now = new Date();
    const existing = await this.prisma.newsletterSubscriber.findUnique({ where: { email } });

    if (!existing) {
      await this.prisma.newsletterSubscriber.create({ data: { email, source, subscribedAt: now } });
    } else if (existing.unsubscribedAt) {
      await this.prisma.newsletterSubscriber.update({
        where: { email },
        data: { unsubscribedAt: null, subscribedAt: now, source },
      });
    }

    if (!existing || existing.unsubscribedAt || !existing.brevoSyncedAt) {
      void this.syncToBrevo(email);
    }

    return { subscribed: true };
  }

  /** Copie l'adresse dans la liste Brevo. Ne lève jamais : le visiteur est déjà inscrit. */
  async syncToBrevo(email: string): Promise<boolean> {
    if (!this.brevoApiKey || !this.brevoListId) return false;

    try {
      /* `updateEnabled` : une adresse déjà connue de Brevo (cliente, par
         exemple) est ajoutée à la liste au lieu d'être refusée en doublon. */
      const response = await fetch(BREVO_CONTACTS_ENDPOINT, {
        method: 'POST',
        headers: {
          'api-key': this.brevoApiKey,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify({ email, listIds: [this.brevoListId], updateEnabled: true }),
        signal: AbortSignal.timeout(SYNC_TIMEOUT_MS),
      });

      if (!response.ok) {
        const detail = (await response.text().catch(() => '')).slice(0, 300);
        throw new Error(`HTTP ${response.status} : ${detail}`);
      }

      await this.prisma.newsletterSubscriber.update({
        where: { email },
        data: { brevoSyncedAt: new Date() },
      });
      return true;
    } catch (error) {
      this.logger.error(
        `Newsletter : copie vers Brevo impossible pour ${maskEmail(email)} — ${(error as Error).message}`,
      );
      return false;
    }
  }
}
