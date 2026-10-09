import { createHash, timingSafeEqual } from 'node:crypto';

import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  InitiatedPayment,
  InitiatePayment,
  PaymentProvider,
  ProviderPaymentStatus,
  WebhookEvent,
} from '@oja/domain';

/**
 * Fournisseur KKiaPay.
 *
 * Établi sur la documentation publique (`docs.kkiapay.me`) et sur le code du
 * SDK Node officiel (`@kkiapay-org/nodejs-sdk` 1.0.7) pour la route de
 * vérification — pas encore essayé contre un compte réel. Ce qui reste à
 * confirmer au premier paiement sandbox est marqué plus bas.
 *
 * Trois particularités de KKiaPay qui façonnent ce fichier :
 *
 *   · **le webhook n'est pas signé.** L'en-tête `x-kkiapay-secret` porte le
 *     « hash secret » du tableau de bord, tel quel : c'est un mot de passe
 *     partagé, identique d'une notification à l'autre, pas une signature du
 *     corps. Il authentifie l'expéditeur, pas le contenu. D'où
 *     `verifiesWebhooks` : le statut annoncé est toujours relu auprès de
 *     KKiaPay avant d'être appliqué ;
 *   · **la création du paiement ne fait aucun appel serveur.** Le widget
 *     (`k.js`) encaisse côté navigateur avec la clé publique. `initiate()` ne
 *     fait que préparer sa configuration ;
 *   · **la référence de transaction est choisie par KKiaPay**, pas par nous.
 *     Notre identifiant de paiement voyage dans `partnerId` — KKiaPay le
 *     conserve et le renvoie dans le webhook comme dans la vérification — ce
 *     qui relie sans ambiguïté une transaction à notre paiement.
 */
@Injectable()
export class KkiapayProvider implements PaymentProvider {
  readonly name = 'kkiapay';
  readonly verifiesWebhooks = true;

  private readonly logger = new Logger(KkiapayProvider.name);

  constructor(private readonly config: ConfigService) {
    /* Les clés ne sont pas lues ici : Nest instancie cette classe même quand
       PAYMENT_PROVIDER=simulated. `env.ts` garantit qu'elles sont présentes dès
       que ce fournisseur est réellement sélectionné. */
  }

  private get sandbox(): boolean {
    return this.config.get<string>('KKIAPAY_MODE', 'test') !== 'live';
  }

  private get baseUrl(): string {
    return this.sandbox ? 'https://api-sandbox.kkiapay.me' : 'https://api.kkiapay.me';
  }

  private get publicKey(): string {
    return this.config.getOrThrow<string>('KKIAPAY_PUBLIC_KEY');
  }

  private get privateKey(): string {
    return this.config.getOrThrow<string>('KKIAPAY_PRIVATE_KEY');
  }

  private get secretKey(): string {
    return this.config.getOrThrow<string>('KKIAPAY_SECRET_KEY');
  }

  private get webhookSecret(): string {
    return this.config.getOrThrow<string>('KKIAPAY_WEBHOOK_SECRET');
  }

  async initiate(input: InitiatePayment): Promise<InitiatedPayment> {
    return {
      reference: input.paymentId,
      checkout: {
        mode: 'widget',
        publicKey: this.publicKey,
        amountXof: input.amountXof,
        sandbox: this.sandbox,
      },
    };
  }

  /**
   * Relit une transaction auprès de KKiaPay — seule source de vérité, avec le
   * webhook lui-même relu par ce même appel.
   *
   * Même route que `k.verify()` du SDK officiel. Une transaction inconnue
   * répond 4xx : traitée comme « en attente », la référence apprise par le
   * navigateur pouvant précéder de quelques secondes sa disponibilité.
   */
  async verify(reference: string): Promise<ProviderPaymentStatus> {
    const response = await this.request('/api/v1/transactions/status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transactionId: reference }),
    });

    if (response.status === 404 || response.status === 400) {
      return { status: 'pending' };
    }

    if (!response.ok) {
      const body = await response.text();
      throw new BadRequestException(
        `KKiaPay a répondu ${response.status} à la vérification de ${reference} : ${body.slice(0, 200)}`,
      );
    }

    return this.toStatus((await response.json()) as Record<string, unknown>);
  }

  /**
   * Authentifie un webhook.
   *
   * Compare `x-kkiapay-secret` au hash secret, à temps constant, **avant** de
   * lire quoi que ce soit dans le corps. Cette comparaison ne protège pas le
   * contenu (voir l'en-tête de classe) : le statut est relu par `verify()`.
   */
  parseWebhook(rawBody: Buffer, signature: string | undefined): WebhookEvent {
    if (!signature) {
      throw new BadRequestException('En-tête x-kkiapay-secret absent.');
    }
    if (!constantTimeEquals(signature, this.webhookSecret)) {
      throw new BadRequestException('Secret de webhook invalide.');
    }

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(rawBody.toString('utf8')) as Record<string, unknown>;
    } catch {
      throw new BadRequestException('Corps de webhook illisible.');
    }

    const reference = typeof payload['transactionId'] === 'string' ? payload['transactionId'] : '';
    if (!reference) {
      throw new BadRequestException('Webhook sans référence exploitable.');
    }

    const eventType = typeof payload['event'] === 'string' ? payload['event'] : 'unknown';

    return {
      reference,
      paymentId: paymentIdOf(payload),
      eventType,
      status: this.fromWebhook(payload),
      // Le secret est le même à chaque notification : on ne le stocke pas, on
      // distingue les notifications par leur contenu.
      dedupeKey: createHash('sha256').update(rawBody).digest('hex'),
    };
  }

  /**
   * Statut tiré du corps d'un webhook. Provisoire par construction : il sert
   * à décider s'il y a quelque chose à vérifier, `verify()` tranche ensuite.
   */
  private fromWebhook(payload: Record<string, unknown>): ProviderPaymentStatus {
    if (payload['isPaymentSucces'] === true) {
      return this.toPaid({
        amount: payload['amount'],
        fees: payload['fees'],
        performedAt: payload['performedAt'],
        partnerId: payload['partnerId'],
      });
    }

    const failureCode =
      typeof payload['failureCode'] === 'string' && payload['failureCode'] !== ''
        ? payload['failureCode']
        : 'failed';
    const message =
      typeof payload['failureMessage'] === 'string' && payload['failureMessage'] !== ''
        ? payload['failureMessage']
        : failureCode;

    return payload['isPaymentSucces'] === false
      ? { status: 'failed', code: failureCode, message }
      : { status: 'pending' };
  }

  /**
   * Traduit la réponse de `/transactions/status`.
   *
   * **À confirmer contre un paiement sandbox** : la doc ne liste pas les
   * valeurs possibles de `status` (`SUCCESS` et `FAILED` sont les seules vues)
   * et ne dit pas si `amount` inclut les frais quand `feeSupportedBy` vaut
   * `customer`. Hypothèse retenue : `amount` est le montant de la commande ;
   * les frais ne comptent pour Ojà que s'ils sont à sa charge.
   */
  private toStatus(data: Record<string, unknown>): ProviderPaymentStatus {
    const status = typeof data['status'] === 'string' ? data['status'].toUpperCase() : '';

    if (status === 'FAILED') {
      const code =
        typeof data['failureCode'] === 'string' && data['failureCode'] !== ''
          ? data['failureCode']
          : typeof data['reason'] === 'string' && data['reason'] !== ''
            ? data['reason']
            : 'failed';
      const message =
        typeof data['failureMessage'] === 'string' && data['failureMessage'] !== ''
          ? data['failureMessage']
          : code;
      return { status: 'failed', code, message };
    }

    if (status !== 'SUCCESS') return { status: 'pending' };

    return this.toPaid({
      amount: data['amount'],
      fees: data['fees'],
      income: data['income'],
      feeSupportedBy: data['feeSupportedBy'],
      performedAt: data['performed_at'] ?? data['performedAt'],
      partnerId: data['partnerId'],
    });
  }

  private toPaid(data: {
    amount: unknown;
    fees: unknown;
    income?: unknown;
    feeSupportedBy?: unknown;
    performedAt: unknown;
    partnerId: unknown;
  }): ProviderPaymentStatus {
    const amountXof = toNumber(data.amount);
    if (amountXof === null) {
      throw new BadRequestException('Transaction « payée » sans montant exploitable.');
    }

    const fees = toNumber(data.fees) ?? 0;
    const feeXof = data.feeSupportedBy === 'customer' ? 0 : fees;
    const netAmountXof = toNumber(data.income) ?? amountXof - feeXof;

    const paidAt =
      typeof data.performedAt === 'string' || typeof data.performedAt === 'number'
        ? new Date(data.performedAt)
        : new Date();

    return {
      status: 'paid',
      amountXof,
      netAmountXof,
      feeXof,
      // KKiaPay ne renvoie pas de devise : le widget n'encaisse qu'en F CFA.
      currency: 'XOF',
      paidAt: Number.isNaN(paidAt.getTime()) ? new Date() : paidAt,
      paymentId: typeof data.partnerId === 'string' && data.partnerId !== '' ? data.partnerId : null,
    };
  }

  private async request(path: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    // Dix secondes : un agrégateur qui ne répond pas ne doit pas geler une
    // page de confirmation indéfiniment.
    const timeout = setTimeout(() => controller.abort(), 10_000);

    try {
      return await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          'x-api-key': this.publicKey,
          'x-private-key': this.privateKey,
          'x-secret-key': this.secretKey,
          Accept: 'application/json',
          ...init.headers,
        },
        signal: controller.signal,
      });
    } catch (error) {
      this.logger.error(
        `KKiaPay injoignable sur ${path} : ${error instanceof Error ? error.message : String(error)}`,
      );
      throw new BadRequestException("L'agrégateur de paiement n'a pas répondu à temps.");
    } finally {
      clearTimeout(timeout);
    }
  }
}

/**
 * Notre identifiant de paiement, tel que posé dans `partnerId` à l'ouverture
 * du widget. `stateData` (le champ `data` du widget) sert de repli.
 */
function paymentIdOf(payload: Record<string, unknown>): string | null {
  const partnerId = payload['partnerId'];
  if (typeof partnerId === 'string' && partnerId.trim() !== '') return partnerId;

  const state = payload['stateData'];
  if (typeof state === 'string' && state.trim() !== '') return state;
  if (state && typeof state === 'object') {
    const id = (state as Record<string, unknown>)['paymentId'];
    if (typeof id === 'string' && id.trim() !== '') return id;
  }
  return null;
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value);
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.round(parsed) : null;
  }
  return null;
}

/**
 * Égalité à temps constant, tolérante aux longueurs différentes — voir la
 * même fonction dans `kadevpay.provider.ts` pour le raisonnement.
 */
function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) {
    timingSafeEqual(bufB, bufB);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}
