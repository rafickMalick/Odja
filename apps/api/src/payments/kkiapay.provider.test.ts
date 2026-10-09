import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { KkiapayProvider } from './kkiapay.provider';

/**
 * Fournisseur KKiaPay.
 *
 * Son webhook n'est pas signé : l'en-tête porte un secret partagé. Ce qui
 * protège donc la commande, ce n'est pas seulement ce secret mais la relecture
 * de la transaction — et le rattachement de la transaction à NOTRE paiement.
 */

const WEBHOOK_SECRET = 'hash-secret-de-test';

function providerWith(env: Record<string, string> = {}): KkiapayProvider {
  return new KkiapayProvider(
    new ConfigService({
      KKIAPAY_PUBLIC_KEY: 'pk_abc',
      KKIAPAY_PRIVATE_KEY: 'prv_abc',
      KKIAPAY_SECRET_KEY: 'sec_abc',
      KKIAPAY_WEBHOOK_SECRET: WEBHOOK_SECRET,
      KKIAPAY_MODE: 'test',
      ...env,
    }),
  );
}

const successBody = JSON.stringify({
  transactionId: 'tx_1',
  isPaymentSucces: true,
  method: 'MOBILE_MONEY',
  amount: 44_100,
  fees: 800,
  partnerId: 'pay_1',
  performedAt: '2026-10-08T10:00:00.000Z',
  stateData: 'pay_1',
  event: 'transaction.success',
});

afterEach(() => vi.unstubAllGlobals());

describe('Fournisseur KKiaPay', () => {
  it('se déclare à vérifier : son webhook ne signe pas le corps', () => {
    expect(providerWith().verifiesWebhooks).toBe(true);
  });

  describe('initiate', () => {
    const input = {
      paymentId: 'pay_1',
      orderReference: 'CMD-2026-000001',
      amountXof: 44_100,
      channel: 'MOBILE_MONEY' as const,
      customer: { fullName: 'Ama Diallo', email: 'ama@example.com', phone: '+22997000000' },
      callbackUrl: 'https://oja.market/confirmation?commande=CMD-2026-000001',
    };

    it('renvoie la clé publique et le mode sandbox, sans appel réseau', async () => {
      const fetchSpy = vi.fn();
      vi.stubGlobal('fetch', fetchSpy);

      const initiated = await providerWith().initiate(input);

      expect(initiated.reference).toBe('pay_1');
      expect(initiated.checkout).toEqual({
        mode: 'widget',
        publicKey: 'pk_abc',
        amountXof: 44_100,
        sandbox: true,
      });
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('ouvre le widget en réel quand le mode est live', async () => {
      const initiated = await providerWith({ KKIAPAY_MODE: 'live' }).initiate(input);
      expect(initiated.checkout.sandbox).toBe(false);
    });

    it("n'expose jamais les clés privée et secrète", async () => {
      const initiated = await providerWith().initiate(input);
      const serialized = JSON.stringify(initiated);
      expect(serialized).not.toContain('prv_abc');
      expect(serialized).not.toContain('sec_abc');
    });
  });

  describe('parseWebhook — authenticité du secret', () => {
    it('accepte le bon secret et lit la transaction', () => {
      const event = providerWith().parseWebhook(Buffer.from(successBody), WEBHOOK_SECRET);

      expect(event.reference).toBe('tx_1');
      expect(event.eventType).toBe('transaction.success');
      expect(event.paymentId).toBe('pay_1');
      expect(event.status).toMatchObject({ status: 'paid', amountXof: 44_100, paymentId: 'pay_1' });
    });

    it('refuse un secret absent, faux ou de mauvaise longueur', () => {
      const provider = providerWith();
      const body = Buffer.from(successBody);
      expect(() => provider.parseWebhook(body, undefined)).toThrow(BadRequestException);
      expect(() => provider.parseWebhook(body, 'un-autre-secret!!!!')).toThrow(BadRequestException);
      expect(() => provider.parseWebhook(body, 'x')).toThrow(BadRequestException);
    });

    it('refuse un corps illisible, même avec le bon secret', () => {
      expect(() => providerWith().parseWebhook(Buffer.from('pas du JSON'), WEBHOOK_SECRET)).toThrow(
        BadRequestException,
      );
    });

    it('refuse un événement sans transactionId', () => {
      const body = JSON.stringify({ isPaymentSucces: true, amount: 1000 });
      expect(() => providerWith().parseWebhook(Buffer.from(body), WEBHOOK_SECRET)).toThrow(
        BadRequestException,
      );
    });

    it("n'écrit pas le secret en base : l'empreinte vient du corps", () => {
      const a = providerWith().parseWebhook(Buffer.from(successBody), WEBHOOK_SECRET);
      const b = providerWith().parseWebhook(
        Buffer.from(successBody.replace('transaction.success', 'transaction.failed')),
        WEBHOOK_SECRET,
      );

      expect(a.dedupeKey).toMatch(/^[0-9a-f]{64}$/);
      expect(a.dedupeKey).not.toContain(WEBHOOK_SECRET);
      expect(a.dedupeKey).not.toBe(b.dedupeKey);
    });

    it('retrouve notre paiement dans stateData si partnerId est absent', () => {
      const body = JSON.stringify({
        transactionId: 'tx_2',
        isPaymentSucces: true,
        amount: 1000,
        stateData: { paymentId: 'pay_9' },
        event: 'transaction.success',
      });
      const event = providerWith().parseWebhook(Buffer.from(body), WEBHOOK_SECRET);
      expect(event.paymentId).toBe('pay_9');
    });

    it('traduit un échec avec son motif', () => {
      const body = JSON.stringify({
        transactionId: 'tx_3',
        isPaymentSucces: false,
        failureCode: 'insufficient_funds',
        failureMessage: 'Solde insuffisant',
        partnerId: 'pay_1',
        event: 'transaction.failed',
      });
      const event = providerWith().parseWebhook(Buffer.from(body), WEBHOOK_SECRET);
      expect(event.status).toEqual({
        status: 'failed',
        code: 'insufficient_funds',
        message: 'Solde insuffisant',
      });
    });
  });

  describe('verify — relecture auprès de KKiaPay', () => {
    const respond = (status: number, body: unknown) =>
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(body), {
          status,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

    it('interroge la sandbox avec les trois clés', async () => {
      const fetchSpy = respond(200, { status: 'SUCCESS', amount: 44_100, fees: 800 });
      vi.stubGlobal('fetch', fetchSpy);

      await providerWith().verify('tx_1');

      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://api-sandbox.kkiapay.me/api/v1/transactions/status');
      expect(init.method).toBe('POST');
      expect(init.body).toBe(JSON.stringify({ transactionId: 'tx_1' }));
      expect(init.headers).toMatchObject({
        'x-api-key': 'pk_abc',
        'x-private-key': 'prv_abc',
        'x-secret-key': 'sec_abc',
      });
    });

    it("interroge l'API de production en mode live", async () => {
      const fetchSpy = respond(200, { status: 'PENDING' });
      vi.stubGlobal('fetch', fetchSpy);

      await providerWith({ KKIAPAY_MODE: 'live' }).verify('tx_1');

      expect((fetchSpy.mock.calls[0] as [string])[0]).toBe(
        'https://api.kkiapay.me/api/v1/transactions/status',
      );
    });

    it('SUCCESS devient un paiement, rattaché à notre identifiant', async () => {
      vi.stubGlobal(
        'fetch',
        respond(200, {
          status: 'SUCCESS',
          amount: 44_100,
          fees: 800,
          income: 43_300,
          feeSupportedBy: 'merchant',
          partnerId: 'pay_1',
          performed_at: '2026-10-08T10:00:00.000Z',
        }),
      );

      expect(await providerWith().verify('tx_1')).toEqual({
        status: 'paid',
        amountXof: 44_100,
        netAmountXof: 43_300,
        feeXof: 800,
        currency: 'XOF',
        paidAt: new Date('2026-10-08T10:00:00.000Z'),
        paymentId: 'pay_1',
      });
    });

    it("ne compte pas les frais à la charge du client dans le coût d'Ojà", async () => {
      vi.stubGlobal(
        'fetch',
        respond(200, { status: 'SUCCESS', amount: 40, fees: 1, income: 40, feeSupportedBy: 'customer' }),
      );

      expect(await providerWith().verify('tx_1')).toMatchObject({
        status: 'paid',
        feeXof: 0,
        netAmountXof: 40,
        paymentId: null,
      });
    });

    it('FAILED devient un échec motivé', async () => {
      vi.stubGlobal('fetch', respond(200, { status: 'FAILED', reason: 'invalid_number' }));
      expect(await providerWith().verify('tx_1')).toEqual({
        status: 'failed',
        code: 'invalid_number',
        message: 'invalid_number',
      });
    });

    it('tout autre statut, et une transaction inconnue, restent en attente', async () => {
      vi.stubGlobal('fetch', respond(200, { status: 'PENDING' }));
      expect(await providerWith().verify('tx_1')).toEqual({ status: 'pending' });

      vi.stubGlobal('fetch', respond(404, { reason: 'not found' }));
      expect(await providerWith().verify('inconnue')).toEqual({ status: 'pending' });
    });

    it('lève sur des clés refusées plutôt que de laisser croire à une attente', async () => {
      vi.stubGlobal('fetch', respond(401, { reason: 'bad keys' }));
      await expect(providerWith().verify('tx_1')).rejects.toThrow(BadRequestException);
    });

    it('lève si KKiaPay ne répond pas', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
      await expect(providerWith().verify('tx_1')).rejects.toThrow(BadRequestException);
    });
  });
});
