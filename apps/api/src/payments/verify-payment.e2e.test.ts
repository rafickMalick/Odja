import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type {
  InitiatedPayment,
  InitiatePayment,
  PaymentProvider,
  ProviderPaymentStatus,
  WebhookEvent,
} from '@oja/domain';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../app.module';
import { DomainErrorFilter } from '../common/domain-error.filter';
import { ProblemFilter } from '../common/problem.filter';
import { PrismaService } from '../prisma/prisma.service';
import { PAYMENT_PROVIDER } from './payment-provider.factory';

/**
 * Confirmation « par le SDK » — sans webhook.
 *
 * Kadev Pay n'expose pas de route de création de paiement : leur widget
 * encaisse côté navigateur et apprend sa propre référence au moment du
 * succès (`onSuccess`, voir `openKadevPayCheckout()`). Tant que la plateforme
 * n'a pas d'URL publique, aucun webhook ne peut nous joindre — mais le
 * navigateur peut transmettre cette référence directement à
 * `POST /orders/:reference/verify-payment`, qui appelle alors `verify()`
 * (serveur à serveur) avec la bonne référence. C'est ce chemin, complet, que
 * ce fichier vérifie — sans jamais parler au vrai Kadev Pay : le fournisseur
 * actif est ici un faux, dont on contrôle la réponse de `verify()`.
 */

const MAKER_PHONE = '+2290795100001';
const CUSTOMER_PHONE = '+2290795100002';
const ADMIN_PHONE = '+2290795100003';
const PASSWORD = 'un-mot-de-passe-solide';

/** `verify()` ne « connaît » que les références posées via `markKnownAsPaid`. */
class FakeSdkProvider implements PaymentProvider {
  readonly name = 'kadevpay';
  private readonly paid = new Map<string, { amountXof: number }>();

  markKnownAsPaid(reference: string, amountXof: number): void {
    this.paid.set(reference, { amountXof });
  }

  async initiate(input: InitiatePayment): Promise<InitiatedPayment> {
    return {
      reference: input.paymentId,
      checkout: { mode: 'widget', publicKey: 'kdvp_test_fake', amountXof: input.amountXof },
    };
  }

  async verify(reference: string): Promise<ProviderPaymentStatus> {
    const known = this.paid.get(reference);
    if (!known) return { status: 'pending' };
    return {
      status: 'paid',
      amountXof: known.amountXof,
      netAmountXof: known.amountXof,
      feeXof: 0,
      currency: 'XOF',
      paidAt: new Date(),
    };
  }

  parseWebhook(): WebhookEvent {
    throw new Error('non utilisé dans ce test');
  }
}

describe('Confirmation de paiement par le SDK (sans webhook)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const provider = new FakeSdkProvider();

  let customerCookies: string[];
  let addressId: string;
  let productId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PAYMENT_PROVIDER)
      .useValue(provider)
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
    customerCookies = await signUp('CUSTOMER', 'client.sdkverify@oja.market', CUSTOMER_PHONE);
    const makerCookies = await signUp('MAKER', 'atelier.sdkverify@oja.market', MAKER_PHONE);

    await api()
      .post('/api/v1/maker/profile')
      .set('Cookie', makerCookies)
      .send({
        shopName: 'Atelier SDK Verify',
        cityId: city.id,
        managerName: 'Test',
        contactPhone: MAKER_PHONE,
        contactEmail: 'atelier.sdkverify@oja.market',
        postalAddress: 'Adresse test',
        pickupLine1: 'Atelier de test',
        ifuNumber: 'IFU-SDKVERIFY',
      })
      .expect(201);

    const maker = await prisma.makerProfile.findFirstOrThrow({
      where: { shopName: 'Atelier SDK Verify' },
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
        name: 'Tabouret SDK Verify',
        categoryId: category.id,
        description: 'Tabouret de test pour vérifier la confirmation par le SDK, sans webhook.',
        makerPriceXof: 20_000,
        quantityAvailable: 10,
        weightGrams: 2_000,
        lengthMm: 300,
        widthMm: 300,
        heightMm: 450,
      })
      .expect(201);
    productId = product.body.id;

    await prisma.productImage.createMany({
      data: [0, 1, 2].map((position) => ({
        productId: product.body.id,
        fileKey: `demo/sdkverify-${position}.jpg`,
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
        fullName: 'Client SDK Verify',
        phone: CUSTOMER_PHONE,
        cityId: city.id,
        line1: 'Adresse de livraison test',
        isDefault: true,
      })
      .expect(201);
    addressId = address.body.id;
  }, 90_000);

  afterAll(async () => {
    await cleanUp();
    await app.close();
  });

  it('confirme une commande avec la référence apprise du widget, sans webhook', async () => {
    const { orderReference, ourOwnId, totalXof } = await placeFreshOrder();
    const kadevReference = `KDV-${Date.now()}-a`;
    provider.markKnownAsPaid(kadevReference, totalXof);

    const response = await api()
      .post(`/api/v1/orders/${orderReference}/verify-payment`)
      .set('Cookie', customerCookies)
      .send({ providerRef: kadevReference })
      .expect(201);

    expect(response.body.status).not.toBe('PENDING_PAYMENT');

    const payment = await prisma.payment.findUnique({ where: { id: ourOwnId } });
    expect(payment?.providerRef).toBe(kadevReference);
    expect(payment?.status).toBe('PAID');
  });

  it('ignore une référence déjà utilisée par un autre paiement, sans planter ni confirmer à tort', async () => {
    // Une première commande, réellement payée sous sa propre référence.
    const first = await placeFreshOrder();
    const takenReference = `KDV-${Date.now()}-b`;
    provider.markKnownAsPaid(takenReference, first.totalXof);
    await api()
      .post(`/api/v1/orders/${first.orderReference}/verify-payment`)
      .set('Cookie', customerCookies)
      .send({ providerRef: takenReference })
      .expect(201);

    // Une seconde commande, du même montant, qui rejoue cette même référence.
    const second = await placeFreshOrder();
    const response = await api()
      .post(`/api/v1/orders/${second.orderReference}/verify-payment`)
      .set('Cookie', customerCookies)
      .send({ providerRef: takenReference })
      .expect(201);

    // Toujours en attente : la référence appartient déjà au premier paiement.
    expect(response.body.status).toBe('PENDING_PAYMENT');

    const secondPayment = await prisma.payment.findUnique({ where: { id: second.ourOwnId } });
    expect(secondPayment?.status).not.toBe('PAID');
    expect(secondPayment?.providerRef).toBe(second.ourOwnId);

    // Le premier paiement n'a pas bougé.
    const firstPayment = await prisma.payment.findUnique({ where: { id: first.ourOwnId } });
    expect(firstPayment?.providerRef).toBe(takenReference);
    expect(firstPayment?.status).toBe('PAID');
  });

  async function placeFreshOrder(): Promise<{
    orderReference: string;
    ourOwnId: string;
    totalXof: number;
  }> {
    await api()
      .post('/api/v1/cart/items')
      .set('Cookie', customerCookies)
      .send({ productId, quantity: 1 })
      .expect(201);

    const quote = await api()
      .post('/api/v1/checkout/quote')
      .set('Cookie', customerCookies)
      .send({ addressId })
      .expect(201);

    const order = await api()
      .post('/api/v1/checkout')
      .set('Cookie', customerCookies)
      .send({ addressId, expectedTotalXof: quote.body.totalXof })
      .expect(201);

    expect(order.body.checkout.mode).toBe('widget');

    return {
      orderReference: order.body.reference as string,
      ourOwnId: order.body.checkout.reference as string,
      totalXof: quote.body.totalXof as number,
    };
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
        lastName: 'SdkVerify',
        acceptedTermsVersion: '2026-01',
      })
      .expect(201);
    return cookiesOf(response);
  }

  async function signUpAdmin(): Promise<string[]> {
    await signUp('CUSTOMER', 'admin.sdkverify@oja.market', ADMIN_PHONE);
    await prisma.user.update({
      where: { email: 'admin.sdkverify@oja.market' },
      data: { role: 'ADMIN', status: 'ACTIVE' },
    });
    const response = await api()
      .post('/api/v1/auth/login')
      .send({ identifier: 'admin.sdkverify@oja.market', password: PASSWORD })
      .expect(200);
    return cookiesOf(response);
  }

  async function cleanUp(): Promise<void> {
    const emails = [
      'client.sdkverify@oja.market',
      'atelier.sdkverify@oja.market',
      'admin.sdkverify@oja.market',
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
