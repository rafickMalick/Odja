import { createHmac } from 'node:crypto';

import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../app.module';
import { DomainErrorFilter } from '../common/domain-error.filter';
import { ProblemFilter } from '../common/problem.filter';
import { PrismaService } from '../prisma/prisma.service';
import { KadevPayProvider } from './kadevpay.provider';
import { PAYMENT_PROVIDER } from './payment-provider.factory';

/**
 * Webhook Kadev Pay, contre une vraie base.
 *
 * Le fournisseur actif est **remplacé** par `overrideProvider`, pas choisi
 * via `PAYMENT_PROVIDER` en environnement : NestJS réinjecte le contenu du
 * `.env` dans `process.env` **sans condition** à chaque chargement du module
 * de configuration (`config.module.js`, ligne `process.env[key] = value`),
 * si bien qu'une mutation faite avant `Test.createTestingModule` est
 * silencieusement écrasée. Remplacer le jeton d'injection est le chemin
 * prévu par NestJS pour ce cas exact, et n'a pas ce défaut.
 *
 * Le scénario qui compte est la **relecture** : un agrégateur renvoie
 * volontiers deux fois la même notification en cas de doute sur la première
 * livraison. La rejouer ne doit ni doubler le grand livre, ni faire échouer
 * la deuxième réponse.
 */

const MAKER_PHONE = '+2250795000001';
const CUSTOMER_PHONE = '+2250795000002';
const ADMIN_PHONE = '+2250795000003';
const PASSWORD = 'un-mot-de-passe-solide';
const WEBHOOK_SECRET = 'whsec_test_e2e_0123456789abcdef';

describe('Webhook Kadev Pay (bout en bout)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  let customerCookies: string[];
  let orderReference: string;
  let paymentReference: string;
  let totalXof: number;
  let catalogProductId: string;

  beforeAll(async () => {
    const kadevPay = new KadevPayProvider(
      new ConfigService({
        KADEVPAY_PUBLIC_KEY: 'kdvp_test_e2e',
        KADEVPAY_SECRET_KEY: 'kdvs_test_e2e',
        KADEVPAY_WEBHOOK_SECRET: WEBHOOK_SECRET,
      }),
    );

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PAYMENT_PROVIDER)
      .useValue(kadevPay)
      .compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    app.setGlobalPrefix('api/v1');
    app.use(cookieParser());
    app.useGlobalFilters(new ProblemFilter(), new DomainErrorFilter());
    await app.init();

    prisma = app.get(PrismaService);
    await cleanUp();

    const city = await prisma.city.findFirstOrThrow({ where: { country: { isActive: true } } });
    const category = await prisma.category.findFirstOrThrow({ where: { slug: 'mobilier' } });

    const adminCookies = await signUpAdmin();
    customerCookies = await signUp('CUSTOMER', 'client.webhook@oja.market', CUSTOMER_PHONE);
    const makerCookies = await signUp('MAKER', 'atelier.webhook@oja.market', MAKER_PHONE);

    await api()
      .post('/api/v1/maker/profile')
      .set('Cookie', makerCookies)
      .send({
        shopName: 'Atelier Webhook',
        cityId: city.id,
        managerName: 'Test',
        contactPhone: MAKER_PHONE,
        contactEmail: 'atelier.webhook@oja.market',
        postalAddress: 'Adresse test',
        pickupLine1: 'Atelier de test',
        ifuNumber: 'IFU-WEBHOOK',
      })
      .expect(201);

    const maker = await prisma.makerProfile.findFirstOrThrow({
      where: { shopName: 'Atelier Webhook' },
    });
    await api()
      .post(`/api/v1/admin/makers/${maker.id}/review`)
      .set('Cookie', adminCookies)
      .send({ decision: 'APPROVE' })
      .expect(201);

    const product = await api()
      .post('/api/v1/maker/products')
      .set('Cookie', makerCookies)
      .send({
        name: 'Chaise webhook',
        categoryId: category.id,
        description: 'Chaise de test pour vérifier le webhook Kadev Pay, du début à la fin.',
        makerPriceXof: 50_000,
        quantityAvailable: 3,
        weightGrams: 4_000,
        lengthMm: 400,
        widthMm: 400,
        heightMm: 900,
      })
      .expect(201);
    catalogProductId = product.body.id;

    await prisma.productImage.createMany({
      data: [0, 1, 2].map((position) => ({
        productId: product.body.id,
        fileKey: `demo/webhook-${position}.jpg`,
        position,
      })),
    });
    await api()
      .post(`/api/v1/maker/products/${product.body.id}/submit`)
      .set('Cookie', makerCookies)
      .expect(201);
    await api()
      .post(`/api/v1/admin/catalog/products/${product.body.id}/review`)
      .set('Cookie', adminCookies)
      .send({ decision: 'PUBLISH' })
      .expect(201);

    const address = await api()
      .post('/api/v1/me/addresses')
      .set('Cookie', customerCookies)
      .send({
        fullName: 'Client Webhook',
        phone: CUSTOMER_PHONE,
        cityId: city.id,
        line1: 'Adresse de livraison test',
        isDefault: true,
      })
      .expect(201);

    await api()
      .post('/api/v1/cart/items')
      .set('Cookie', customerCookies)
      .send({ productId: product.body.id, quantity: 1 })
      .expect(201);

    const quote = await api()
      .post('/api/v1/checkout/quote')
      .set('Cookie', customerCookies)
      .send({ addressId: address.body.id })
      .expect(201);
    totalXof = quote.body.totalXof;

    const order = await api()
      .post('/api/v1/checkout')
      .set('Cookie', customerCookies)
      .send({ addressId: address.body.id, expectedTotalXof: totalXof })
      .expect(201);

    orderReference = order.body.reference;
    paymentReference = order.body.checkout.reference;

    expect(order.body.checkout.mode).toBe('widget');
    expect(order.body.checkout.publicKey).toBe('kdvp_test_e2e');
  }, 90_000);

  afterAll(async () => {
    await app.close();
  });

  it('refuse une notification sans signature', async () => {
    await api()
      .post('/api/v1/webhooks/kadevpay')
      .send({ event: 'payment.success', data: { status: 'paid', reference: paymentReference, amount: totalXof } })
      .expect(400);
  });

  it('refuse une signature qui ne correspond pas au corps', async () => {
    const body = { event: 'payment.success', data: { status: 'paid', reference: paymentReference, amount: totalXof } };
    await api()
      .post('/api/v1/webhooks/kadevpay')
      .set('X-KadevPay-Signature', 'a'.repeat(128))
      .send(body)
      .expect(400);

    const payment = await prisma.payment.findFirst({ where: { providerRef: paymentReference } });
    expect(payment?.status).toBe('INITIATED');
  });

  it('ignore poliment une référence inconnue, sans lever d’erreur', async () => {
    const body = JSON.stringify({
      event: 'payment.success',
      data: { status: 'paid', reference: 'pay_jamais_vu', amount: 1_000 },
    });

    const response = await api()
      .post('/api/v1/webhooks/kadevpay')
      .set('X-KadevPay-Signature', sign(body))
      .set('Content-Type', 'application/json')
      .send(body)
      .expect(200);

    expect(response.body.status).toBe('ignored');
  });

  it('refuse un montant divergent — un paiement partiel ne doit pas passer pour complet', async () => {
    /* Ce test doit s'exécuter avant tout encaissement réussi : une fois le
       paiement passé « PAID », applyProviderStatus renvoie tôt sans même
       regarder le montant (idempotence) — ce n'est plus ce test-ci qui
       vérifierait quoi que ce soit. */
    const partial = JSON.stringify({
      event: 'payment.success',
      data: { status: 'paid', reference: paymentReference, amount: 1 },
    });

    // La première tentative doit être refusée, pas juste ignorée : c'est une
    // anomalie réelle, pas un doublon.
    const response = await api()
      .post('/api/v1/webhooks/kadevpay')
      .set('X-KadevPay-Signature', sign(partial))
      .set('Content-Type', 'application/json')
      .send(partial)
      .expect(400);
    expect(response.body.detail).toContain('montant');

    // Le paiement n'a pas basculé côté base malgré la notification.
    const payment = await prisma.payment.findFirst({ where: { providerRef: paymentReference } });
    expect(payment?.status).not.toBe('PAID');

    // Un réessai de l'agrégateur sur cette même notification ne redéclenche
    // pas l'alerte ni le contrôle : l'événement est déjà enregistré.
    const retry = await api()
      .post('/api/v1/webhooks/kadevpay')
      .set('X-KadevPay-Signature', sign(partial))
      .set('Content-Type', 'application/json')
      .send(partial)
      .expect(200);
    expect(retry.body.status).toBe('already_processed');
  });

  it('encaisse sur signature valide et montant conforme', async () => {
    const body = JSON.stringify({
      event: 'payment.success',
      data: { status: 'paid', reference: paymentReference, amount: totalXof },
    });

    const response = await api()
      .post('/api/v1/webhooks/kadevpay')
      .set('X-KadevPay-Signature', sign(body))
      .set('Content-Type', 'application/json')
      .send(body)
      .expect(200);

    expect(response.body.status).toBe('PAID');

    const order = await api()
      .get(`/api/v1/orders/${orderReference}`)
      .set('Cookie', customerCookies)
      .expect(200);
    // La commande a quitté « en attente de paiement » : chaque atelier a
    // maintenant 48 h pour répondre.
    expect(order.body.status).not.toBe('PENDING_PAYMENT');
  });

  it('rejoue la même notification sans rien doubler', async () => {
    const before = await prisma.ledgerEntry.count();

    const body = JSON.stringify({
      event: 'payment.success',
      data: { status: 'paid', reference: paymentReference, amount: totalXof },
    });

    const response = await api()
      .post('/api/v1/webhooks/kadevpay')
      .set('X-KadevPay-Signature', sign(body))
      .set('Content-Type', 'application/json')
      .send(body)
      .expect(200);

    expect(response.body.status).toBe('already_processed');

    const after = await prisma.ledgerEntry.count();
    expect(after).toBe(before);
  });

  it('retrouve le paiement par metadata.order_id — la référence Kadev Pay diffère de la nôtre', async () => {
    /* `initiate()` ne peut que proposer une référence : leur SDK ne laisse
       pas en choisir une, il en génère une à lui (`KDV-…`) au moment où le
       client règle dans le widget. Un vrai webhook porte donc SA référence
       en `data.reference`, différente de celle qu'on a émise — et c'est
       `metadata.order_id`, posé par `openKadevPayCheckout()`, qui doit
       permettre de retrouver le paiement malgré tout. */
    await api()
      .post('/api/v1/cart/items')
      .set('Cookie', customerCookies)
      .send({ productId: catalogProductId, quantity: 1 })
      .expect(201);

    const address = await api()
      .get('/api/v1/me/addresses')
      .set('Cookie', customerCookies)
      .expect(200);

    const quote = await api()
      .post('/api/v1/checkout/quote')
      .set('Cookie', customerCookies)
      .send({ addressId: address.body[0].id })
      .expect(201);

    const order = await api()
      .post('/api/v1/checkout')
      .set('Cookie', customerCookies)
      .send({ addressId: address.body[0].id, expectedTotalXof: quote.body.totalXof })
      .expect(201);

    const ourOwnId = order.body.checkout.reference;
    const kadevOwnReference = `KDV-${Date.now()}`;

    const body = JSON.stringify({
      event: 'payment.success',
      data: {
        status: 'paid',
        reference: kadevOwnReference,
        amount: quote.body.totalXof,
        metadata: { order_id: ourOwnId },
      },
    });

    const response = await api()
      .post('/api/v1/webhooks/kadevpay')
      .set('X-KadevPay-Signature', sign(body))
      .set('Content-Type', 'application/json')
      .send(body)
      .expect(200);

    expect(response.body.status).toBe('PAID');

    // La référence apprise du webhook remplace la nôtre : c'est elle que
    // `verify()` devra utiliser désormais.
    const payment = await prisma.payment.findUnique({ where: { id: ourOwnId } });
    expect(payment?.providerRef).toBe(kadevOwnReference);
  });

  function sign(body: string): string {
    return createHmac('sha512', WEBHOOK_SECRET).update(body).digest('hex');
  }

  function api() {
    return request(app.getHttpServer());
  }

  function cookiesOf(response: request.Response): string[] {
    const raw = response.headers['set-cookie'];
    return Array.isArray(raw) ? raw : raw ? [raw] : [];
  }

  async function signUp(role: string, email: string, phone: string): Promise<string[]> {
    const response = await api()
      .post('/api/v1/auth/register')
      .send({
        role,
        email,
        phone,
        password: PASSWORD,
        firstName: 'Test',
        lastName: 'Webhook',
        acceptedTermsVersion: '2026-01',
      })
      .expect(201);
    return cookiesOf(response);
  }

  async function signUpAdmin(): Promise<string[]> {
    await signUp('CUSTOMER', 'admin.webhook@oja.market', ADMIN_PHONE);
    await prisma.user.update({
      where: { email: 'admin.webhook@oja.market' },
      data: { role: 'ADMIN', status: 'ACTIVE' },
    });
    const response = await api()
      .post('/api/v1/auth/login')
      .send({ identifier: 'admin.webhook@oja.market', password: PASSWORD })
      .expect(200);
    return cookiesOf(response);
  }

  async function cleanUp(): Promise<void> {
    const emails = [
      'client.webhook@oja.market',
      'atelier.webhook@oja.market',
      'admin.webhook@oja.market',
    ];
    const users = await prisma.user.findMany({
      where: { email: { in: emails } },
      select: { id: true },
    });
    const ids = users.map((user) => user.id);
    if (ids.length === 0) return;

    const orders = await prisma.order.findMany({
      where: { customerId: { in: ids } },
      select: { id: true },
    });
    const orderIds = orders.map((order) => order.id);

    await prisma.paymentEvent.deleteMany({ where: { payment: { orderId: { in: orderIds } } } });
    await prisma.payment.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.subOrder.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } });

    const makers = await prisma.makerProfile.findMany({
      where: { userId: { in: ids } },
      select: { id: true },
    });
    const makerIds = makers.map((maker) => maker.id);
    await prisma.productImage.deleteMany({ where: { product: { makerId: { in: makerIds } } } });
    await prisma.product.deleteMany({ where: { makerId: { in: makerIds } } });
    await prisma.makerProfile.deleteMany({ where: { userId: { in: ids } } });

    await prisma.session.deleteMany({ where: { userId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
  }
});
