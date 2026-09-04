import { createHmac, timingSafeEqual } from 'node:crypto';

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
 * Fournisseur Kadev Pay.
 *
 * Extrait de leur documentation publique (`pay.kadev.ci/developer-documentation`),
 * pas d'un accès marchand réel — aucune clé n'a encore été délivrée à cette
 * date. Trois écarts avec leur exemple, volontaires :
 *
 *   · **la signature se vérifie sur le corps brut**, jamais sur
 *     `JSON.stringify(req.body)`. Leur propre exemple PHP calcule sur le
 *     corps désérialisé — une re-sérialisation change l'espacement ou l'ordre
 *     des clés, et la vérification échoue de façon intermittente. Le corps
 *     brut est disponible ici via `rawBody: true`, posé une fois pour toutes
 *     dans `main.ts` ;
 *   · **la comparaison est à temps constant** (`timingSafeEqual`), pas
 *     `===` : une comparaison naïve fuit, octet par octet, le temps qu'il
 *     faut pour deviner la signature attendue ;
 *   · **la création du paiement ne fait aucun appel serveur.** Leur SDK
 *     encaisse **côté navigateur** (`KadevPay.checkout()`) avec la clé
 *     publique ; `initiate()` ne fait que préparer la configuration que le
 *     front doit passer au widget.
 *
 * Ce que leur documentation ne précise pas — et qui reste donc à vérifier au
 * premier essai contre un vrai compte test — est marqué explicitement plus
 * bas.
 */
@Injectable()
export class KadevPayProvider implements PaymentProvider {
  readonly name = 'kadevpay';

  private readonly logger = new Logger(KadevPayProvider.name);

  constructor(private readonly config: ConfigService) {
    /* Les clés ne sont PAS lues ici. Nest instancie cette classe au démarrage
       même quand PAYMENT_PROVIDER=simulated — c'est le sélecteur de
       `payment-provider.factory.ts` qui décide laquelle sert, pas l'ordre de
       construction. Exiger les clés dans le constructeur ferait échouer le
       démarrage de toute installation qui n'a pas encore de compte marchand,
       ce qui est le cas de toutes à ce jour. Elles sont donc résolues à
       l'appel, où `env.ts` garantit déjà qu'elles sont présentes dès que ce
       fournisseur est réellement sélectionné. */
  }

  private get baseUrl(): string {
    return this.config.get<string>('KADEVPAY_BASE_URL', 'https://pay.kadev.ci/api/v1');
  }

  private get publicKey(): string {
    return this.config.getOrThrow<string>('KADEVPAY_PUBLIC_KEY');
  }

  private get secretKey(): string {
    return this.config.getOrThrow<string>('KADEVPAY_SECRET_KEY');
  }

  private get webhookSecret(): string {
    return this.config.getOrThrow<string>('KADEVPAY_WEBHOOK_SECRET');
  }

  /**
   * Prépare la configuration du widget.
   *
   * Kadev Pay n'expose pas de route serveur de création de paiement : c'est
   * leur script `kadev-pay.js`, chargé par le navigateur, qui encaisse
   * directement avec `public_key`. Le serveur ne fait ici que choisir la
   * référence et la retenir — c'est elle qui reviendra dans le webhook et
   * dans `metadata`, et qui relie l'encaissement à notre commande.
   */
  async initiate(input: InitiatePayment): Promise<InitiatedPayment> {
    return {
      reference: input.paymentId,
      checkout: {
        mode: 'widget',
        publicKey: this.publicKey,
        amountXof: input.amountXof,
      },
    };
  }

  /**
   * Vérification serveur à serveur — seule source de vérité avec le webhook.
   *
   * C'est elle qu'appelle la page de confirmation à l'ouverture, et le
   * balayage périodique des paiements en attente : un webhook qui n'arrive
   * jamais (relais en panne, notification perdue) ne doit pas laisser une
   * commande indéfiniment « en attente » alors que le client a bien payé.
   */
  async verify(reference: string): Promise<ProviderPaymentStatus> {
    const response = await this.request(`/transactions/verify/${encodeURIComponent(reference)}`, {
      method: 'GET',
    });

    if (response.status === 404) return { status: 'pending' };

    if (!response.ok) {
      const body = await response.text();
      throw new BadRequestException(
        `Kadev Pay a répondu ${response.status} à la vérification de ${reference} : ${body.slice(0, 200)}`,
      );
    }

    const payload = (await response.json()) as Record<string, unknown>;
    return this.toStatus(payload);
  }

  /**
   * Analyse et authentifie un webhook.
   *
   * Refuse tout ce qui ne porte pas une signature valide, **avant** de lire
   * quoi que ce soit dans le corps : un attaquant qui devine l'URL du webhook
   * ne doit obtenir aucune information, même une erreur de format, avant
   * d'avoir passé la signature.
   */
  parseWebhook(rawBody: Buffer, signature: string | undefined): WebhookEvent {
    if (!signature) {
      throw new BadRequestException('En-tête X-KadevPay-Signature absent.');
    }

    const expected = createHmac('sha512', this.webhookSecret).update(rawBody).digest('hex');

    if (!constantTimeEquals(signature, expected)) {
      throw new BadRequestException('Signature de webhook invalide.');
    }

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(rawBody.toString('utf8')) as Record<string, unknown>;
    } catch {
      throw new BadRequestException('Corps de webhook illisible.');
    }

    // Champs documentés : `event`, `data.status`, `data.reference`, `data.amount`.
    const eventType = typeof payload['event'] === 'string' ? (payload['event'] as string) : 'unknown';
    const data = (payload['data'] as Record<string, unknown> | undefined) ?? {};
    const reference = typeof data['reference'] === 'string' ? (data['reference'] as string) : '';

    if (!reference) {
      throw new BadRequestException('Webhook sans référence exploitable.');
    }

    /* `reference` (ex. `KDV-1775413916000`) est générée par Kadev Pay — leur
     * SDK ne laisse pas en choisir une : `KadevPay.checkout()` n'a pas de
     * paramètre `reference`. On ne peut donc **pas** supposer qu'elle
     * correspond à notre propre identifiant de paiement.
     *
     * Le seul lien qu'on maîtrise est `metadata.order_id`, posé par
     * `openKadevPayCheckout()` (`apps/web/src/lib/kadevpay.ts`) et que leur
     * documentation dit répercuté dans le webhook, sans en montrer la forme
     * exacte. On tente `data.metadata.order_id` d'abord — la position la plus
     * probable, l'objet `metadata` restant attaché à la transaction — puis
     * `metadata` à la racine, en repli. Si aucun des deux n'apparaît au
     * premier webhook réel, `paymentId` reste `null` et l'appelant retombe
     * sur `providerRef` (voir `PaymentService.handleWebhook`). */
    const metadata =
      (data['metadata'] as Record<string, unknown> | undefined) ??
      (payload['metadata'] as Record<string, unknown> | undefined) ??
      {};
    const orderId = metadata['order_id'];
    const paymentId = typeof orderId === 'string' && orderId.trim() !== '' ? orderId : null;

    return {
      reference,
      paymentId,
      eventType,
      status: this.toStatus(data),
    };
  }

  /**
   * Traduit une charge utile Kadev Pay en statut normalisé.
   *
   * **Ce que leur documentation publique ne précise pas**, et qui reste à
   * confirmer contre un vrai paiement test avant la mise en production :
   *
   *   · le nom exact des champs de montant net et de frais (`amount` est
   *     documenté ; `net_amount` / `fee` sont une supposition raisonnable,
   *     au vu des taux publiés — 2,3 % Mobile Money, 4,5 % carte) ;
   *   · la devise renvoyée (probablement toujours `XOF`, jamais confirmé) ;
   *   · le format exact de l'horodatage de paiement.
   */
  private toStatus(data: Record<string, unknown>): ProviderPaymentStatus {
    const status = typeof data['status'] === 'string' ? (data['status'] as string) : '';

    if (status === 'failed' || status === 'expired' || status === 'cancelled') {
      const message = typeof data['message'] === 'string' ? (data['message'] as string) : status;
      return { status: 'failed', code: status, message };
    }

    if (status !== 'paid') return { status: 'pending' };

    const amountXof = numberField(data, 'amount');
    if (amountXof === null) {
      throw new BadRequestException('Webhook « paid » sans montant exploitable.');
    }

    // Champs supposés — voir la note de méthode ci-dessus.
    const feeXof = numberField(data, 'fee') ?? numberField(data, 'fees') ?? 0;
    const netAmountXof = numberField(data, 'net_amount') ?? amountXof - feeXof;
    const currency = typeof data['currency'] === 'string' ? (data['currency'] as string) : 'XOF';
    const paidAtRaw = data['paid_at'] ?? data['paidAt'];
    const paidAt =
      typeof paidAtRaw === 'string' || typeof paidAtRaw === 'number'
        ? new Date(paidAtRaw)
        : new Date();

    return {
      status: 'paid',
      amountXof,
      netAmountXof,
      feeXof,
      currency,
      paidAt: Number.isNaN(paidAt.getTime()) ? new Date() : paidAt,
    };
  }

  private async request(path: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    // Dix secondes : un agrégateur qui ne répond pas ne doit pas geler une
    // requête administrateur ou une page de confirmation indéfiniment.
    const timeout = setTimeout(() => controller.abort(), 10_000);

    try {
      return await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${this.secretKey}`,
          Accept: 'application/json',
          ...init.headers,
        },
        signal: controller.signal,
      });
    } catch (error) {
      this.logger.error(
        `Kadev Pay injoignable sur ${path} : ${error instanceof Error ? error.message : String(error)}`,
      );
      throw new BadRequestException("L'agrégateur de paiement n'a pas répondu à temps.");
    } finally {
      clearTimeout(timeout);
    }
  }
}

function numberField(data: Record<string, unknown>, key: string): number | null {
  const value = data[key];
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value);
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.round(parsed) : null;
  }
  return null;
}

/**
 * Égalité à temps constant, tolérante aux longueurs différentes.
 *
 * `timingSafeEqual` de Node exige deux tampons de même longueur et lève une
 * exception sinon — ce qui recréerait exactement la fuite qu'on cherche à
 * éviter (une signature de mauvaise longueur échouerait plus vite qu'une de
 * bonne longueur mais fausse). On égalise donc la longueur avant de comparer.
 */
function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) {
    // Comparaison factice, de même coût, pour ne pas retourner plus vite.
    timingSafeEqual(bufB, bufB);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}
