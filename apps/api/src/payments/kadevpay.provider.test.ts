import { createHmac } from 'node:crypto';

import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { describe, expect, it } from 'vitest';

import { KadevPayProvider } from './kadevpay.provider';

/**
 * Fournisseur Kadev Pay, vérifié sur ce qui compte vraiment : la signature.
 *
 * C'est la seule barrière entre « quelqu'un a payé » et « on croit que
 * quelqu'un a payé ». Une signature acceptée à tort déclenche un versement
 * réel pour un encaissement qui n'a jamais eu lieu.
 */

const WEBHOOK_SECRET = 'secret-de-test-du-webhook';

function providerWith(env: Record<string, string> = {}): KadevPayProvider {
  const config = new ConfigService({
    KADEVPAY_PUBLIC_KEY: 'kdvp_test_abc',
    KADEVPAY_SECRET_KEY: 'kdvs_test_abc',
    KADEVPAY_WEBHOOK_SECRET: WEBHOOK_SECRET,
    ...env,
  });
  return new KadevPayProvider(config);
}

function sign(body: string, secret = WEBHOOK_SECRET): string {
  return createHmac('sha512', secret).update(body).digest('hex');
}

describe('Fournisseur Kadev Pay', () => {
  describe('initiate — préparation du widget', () => {
    it('ne fait aucun appel réseau et renvoie la clé publique', async () => {
      const provider = providerWith();

      const initiated = await provider.initiate({
        paymentId: 'pay_1',
        orderReference: 'CMD-2026-000001',
        amountXof: 44_100,
        channel: 'MOBILE_MONEY',
        customer: { fullName: 'Ama Diallo', email: 'ama@example.com', phone: '+2250700000000' },
        callbackUrl: 'https://oja.market/confirmation?commande=CMD-2026-000001',
      });

      expect(initiated.reference).toBe('pay_1');
      expect(initiated.checkout).toMatchObject({
        mode: 'widget',
        publicKey: 'kdvp_test_abc',
        amountXof: 44_100,
      });
    });
  });

  describe('parseWebhook — authenticité avant tout', () => {
    const payload = JSON.stringify({
      event: 'payment.success',
      data: { status: 'paid', reference: 'pay_1', amount: 44_100 },
    });

    it('accepte une signature correcte', () => {
      const provider = providerWith();
      const event = provider.parseWebhook(Buffer.from(payload), sign(payload));

      expect(event.reference).toBe('pay_1');
      expect(event.eventType).toBe('payment.success');
      expect(event.status).toMatchObject({ status: 'paid', amountXof: 44_100 });
    });

    it('refuse une signature absente', () => {
      const provider = providerWith();
      expect(() => provider.parseWebhook(Buffer.from(payload), undefined)).toThrow(
        BadRequestException,
      );
    });

    it('refuse une signature incorrecte', () => {
      const provider = providerWith();
      expect(() =>
        provider.parseWebhook(Buffer.from(payload), 'a'.repeat(128)),
      ).toThrow(BadRequestException);
    });

    it('refuse un corps modifié après signature — le cas qui compte', () => {
      const provider = providerWith();
      const validSignature = sign(payload);

      /* Le corps a changé — un montant gonflé par exemple — mais la signature
         est celle de l'original. C'est exactement ce qu'un attaquant qui
         intercepte une vraie notification tenterait. */
      const tampered = payload.replace('"amount":44100', '"amount":441000');

      expect(() => provider.parseWebhook(Buffer.from(tampered), validSignature)).toThrow(
        BadRequestException,
      );
    });

    it('refuse une signature calculée avec le mauvais secret', () => {
      const provider = providerWith();
      const wrongSecret = sign(payload, 'un-autre-secret');

      expect(() => provider.parseWebhook(Buffer.from(payload), wrongSecret)).toThrow(
        BadRequestException,
      );
    });

    it('ne lève jamais RangeError sur une signature de longueur différente', () => {
      // `timingSafeEqual` de Node lève sur deux tampons de longueurs
      // différentes : une signature tronquée ne doit pas produire une
      // exception non gérée, juste un refus normal.
      const provider = providerWith();
      expect(() => provider.parseWebhook(Buffer.from(payload), 'abc')).toThrow(
        BadRequestException,
      );
    });

    it('refuse un corps illisible même signé correctement', () => {
      const provider = providerWith();
      const garbage = 'ceci n’est pas du JSON';
      expect(() => provider.parseWebhook(Buffer.from(garbage), sign(garbage))).toThrow(
        BadRequestException,
      );
    });

    it('refuse un événement sans référence exploitable', () => {
      const provider = providerWith();
      const noRef = JSON.stringify({ event: 'payment.success', data: { status: 'paid' } });
      expect(() => provider.parseWebhook(Buffer.from(noRef), sign(noRef))).toThrow(
        BadRequestException,
      );
    });
  });

  describe('traduction du statut', () => {
    const send = (data: Record<string, unknown>) => {
      const provider = providerWith();
      const body = JSON.stringify({ event: 'payment.success', data: { reference: 'pay_1', ...data } });
      return provider.parseWebhook(Buffer.from(body), sign(body));
    };

    it('« paid » avec montant devient un statut payé', () => {
      const event = send({ status: 'paid', amount: 10_000 });
      expect(event.status).toEqual({
        status: 'paid',
        amountXof: 10_000,
        netAmountXof: 10_000,
        feeXof: 0,
        currency: 'XOF',
        paidAt: expect.any(Date),
      });
    });

    it('« paid » sans montant est refusé plutôt que silencieusement ignoré', () => {
      expect(() => send({ status: 'paid' })).toThrow(BadRequestException);
    });

    it('« failed » devient un échec motivé', () => {
      const event = send({ status: 'failed', message: 'Fonds insuffisants' });
      expect(event.status).toEqual({
        status: 'failed',
        code: 'failed',
        message: 'Fonds insuffisants',
      });
    });

    it('tout autre statut est traité comme en attente', () => {
      const event = send({ status: 'processing' });
      expect(event.status).toEqual({ status: 'pending' });
    });
  });
});
