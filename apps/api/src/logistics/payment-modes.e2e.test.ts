import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../app.module';
import { DomainErrorFilter } from '../common/domain-error.filter';
import { ProblemFilter } from '../common/problem.filter';
import { LedgerService } from '../ledger/ledger.service';
import { PrismaService } from '../prisma/prisma.service';
import { resetTestData } from '../test/cleanup';

/**
 * Les trois façons de régler une commande.
 *
 * Le fil conducteur : **le livreur encaisse pour Ojà, et le grand livre sait à
 * tout instant ce qu'il doit reverser.** Une commande payée à la livraison ne
 * crée aucun paiement en ligne, mais ses écritures, elles, sont celles d'une
 * commande payée : seule la créance sur le client les distingue.
 */

const MAKER = '+2250761000001';
const COURIER = '+2250761000002';
const CUSTOMER = '+2250761000003';
const ADMIN = '+2250761000004';
const PASSWORD = 'un-mot-de-passe-solide';

const ATELIER = { latitude: 5.36, longitude: -4.0083 };
const CHEZ_LE_CLIENT = { latitude: 5.3599, longitude: -3.9855 };

describe('Modes de paiement (bout en bout)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ledger: LedgerService;

  let customerCookies: string[];
  let makerCookies: string[];
  let courierCookies: string[];
  let adminCookies: string[];
  let addressId: string;
  let productId: string;
  let courierId: string;
  let courierUserId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    app.setGlobalPrefix('api/v1');
    app.use(cookieParser());
    app.useGlobalFilters(new ProblemFilter(), new DomainErrorFilter());
    await app.init();

    prisma = app.get(PrismaService);
    ledger = app.get(LedgerService);
    await resetTestData(prisma);

    const abidjan = await prisma.city.findFirstOrThrow({ where: { country: { isActive: true } } });
    const category = await prisma.category.findFirstOrThrow({ where: { slug: 'mobilier' } });

    adminCookies = await signUpAdmin();
    customerCookies = await signUp('CUSTOMER', 'client.modes@oja.market', CUSTOMER);
    courierCookies = await signUp('COURIER', 'livreur.modes@oja.market', COURIER);
    makerCookies = await signUp('MAKER', 'atelier.modes@oja.market', MAKER);

    const courierUser = await prisma.user.findFirstOrThrow({ where: { phone: COURIER } });
    courierUserId = courierUser.id;
    const courier = await prisma.courierProfile.create({
      data: { userId: courierUser.id, vehicle: 'TRICYCLE', kycStatus: 'APPROVED', isAvailable: true },
    });
    courierId = courier.id;
    await prisma.user.update({ where: { id: courierUser.id }, data: { status: 'ACTIVE' } });

    const profile = await api()
      .post('/api/v1/maker/profile')
      .set('Cookie', makerCookies)
      .send({
        shopName: 'Atelier Modes',
        cityId: abidjan.id,
        managerName: 'Responsable',
        contactPhone: '+2250799887761',
        contactEmail: 'atelier.modes@oja.market',
        postalAddress: 'Adresse postale',
        ifuNumber: 'IFU-MODES',
        pickupLine1: 'Atelier, Treichville',
        pickupLatitude: ATELIER.latitude,
        pickupLongitude: ATELIER.longitude,
      })
      .expect(201);
    await api().post('/api/v1/maker/kyc/submit').set('Cookie', makerCookies).expect(201);
    await api()
      .post(`/api/v1/admin/makers/${profile.body.id}/review`)
      .set('Cookie', adminCookies)
      .send({ decision: 'APPROVE' })
      .expect(201);

    const product = await api()
      .post('/api/v1/maker/products')
      .set('Cookie', makerCookies)
      .send({
        name: 'Table basse Modes',
        categoryId: category.id,
        description: 'Table basse en bois de teck, façonnée à la main.',
        makerPriceXof: 120_000,
        isMadeToOrder: false,
        quantityAvailable: 50,
        weightGrams: 12_000,
        lengthMm: 900,
        widthMm: 500,
        heightMm: 400,
      })
      .expect(201);
    productId = product.body.id;
    await prisma.productImage.createMany({
      data: [0, 1, 2].map((position) => ({ productId, fileKey: `demo/${position}.jpg`, position })),
    });
    await api().post(`/api/v1/maker/products/${productId}/submit`).set('Cookie', makerCookies).expect(201);
    await api()
      .post(`/api/v1/admin/catalog/products/${productId}/review`)
      .set('Cookie', adminCookies)
      .send({ decision: 'PUBLISH' })
      .expect(201);

    const address = await api()
      .post('/api/v1/me/addresses')
      .set('Cookie', customerCookies)
      .send({
        fullName: 'Awa Koné',
        phone: '+2250700000000',
        cityId: abidjan.id,
        line1: 'Rue des Jardins, Cocody',
        latitude: CHEZ_LE_CLIENT.latitude,
        longitude: CHEZ_LE_CLIENT.longitude,
      })
      .expect(201);
    addressId = address.body.id;
  }, 120_000);

  afterAll(async () => {
    await resetTestData(prisma);
    await app?.close();
  });

  const api = () => request(app.getHttpServer());

  async function signUp(role: string, email: string, phone: string): Promise<string[]> {
    const response = await api()
      .post('/api/v1/auth/register')
      .send({
        role,
        firstName: 'Test',
        lastName: 'Utilisateur',
        email,
        phone,
        password: PASSWORD,
        acceptedTermsVersion: '2026-08',
      })
      .expect(201);
    return cookiesOf(response);
  }

  async function signUpAdmin(): Promise<string[]> {
    await signUp('CUSTOMER', 'admin.modes@oja.market', ADMIN);
    await prisma.user.update({ where: { phone: ADMIN }, data: { role: 'ADMIN', status: 'ACTIVE' } });
    const response = await api()
      .post('/api/v1/auth/login')
      .send({ identifier: 'admin.modes@oja.market', password: PASSWORD })
      .expect(200);
    return cookiesOf(response);
  }

  async function quoteTotal(): Promise<{ totalXof: number; options: any[] }> {
    await api().delete('/api/v1/cart').set('Cookie', customerCookies).expect(204);
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
    return { totalXof: quote.body.totalXof, options: quote.body.paymentOptions };
  }

  async function place(paymentMode?: string) {
    const { totalXof } = await quoteTotal();
    const order = await api()
      .post('/api/v1/checkout')
      .set('Cookie', customerCookies)
      .send({ addressId, expectedTotalXof: totalXof, ...(paymentMode ? { paymentMode } : {}) })
      .expect(201);
    return { order: order.body, totalXof };
  }

  async function ledgerBalance(type: Parameters<LedgerService['balanceOf']>[0], ownerId?: string) {
    return ledger.balanceOf(type, ownerId ?? null);
  }

  async function acceptAndAssign(orderReference: string): Promise<{ shipment: string; otp: string }> {
    await api()
      .post(`/api/v1/maker/orders/${orderReference}-A/accept`)
      .set('Cookie', makerCookies)
      .expect(201);
    const shipment = await prisma.shipment.findFirstOrThrow({
      where: { order: { reference: orderReference } },
    });
    await api()
      .post(`/api/v1/admin/logistics/shipments/${shipment.reference}/assign`)
      .set('Cookie', adminCookies)
      .send({ courierId })
      .expect(201);
    await api().post(`/api/v1/courier/missions/${shipment.reference}/pickup`).set('Cookie', courierCookies).expect(201);
    await api()
      .post(`/api/v1/courier/missions/${shipment.reference}/start`)
      .set('Cookie', courierCookies)
      .send(ATELIER)
      .expect(201);
    return { shipment: shipment.reference, otp: shipment.proofOtp ?? '' };
  }

  const proof = (otp: string) => ({ otp, photoKey: 'p.jpg', ...CHEZ_LE_CLIENT });

  describe('chiffrage', () => {
    it('propose les trois modes avec ce que chacun fait payer maintenant', async () => {
      const { totalXof, options } = await quoteTotal();
      const byMode = Object.fromEntries(options.map((o: any) => [o.mode, o]));

      expect(byMode.ONLINE_FULL).toMatchObject({ upfrontXof: totalXof, balanceXof: 0 });
      expect(byMode.CASH_ON_DELIVERY).toMatchObject({ upfrontXof: 0, balanceXof: totalXof });
      expect(byMode.DEPOSIT_50.upfrontXof + byMode.DEPOSIT_50.balanceXof).toBe(totalXof);
      expect(byMode.DEPOSIT_50.upfrontXof).toBe(Math.ceil(totalXof / 2));
    });
  });

  describe('paiement en ligne complet (comportement inchangé)', () => {
    it('crée un paiement pour le total et aucune créance', async () => {
      const { order, totalXof } = await place();

      expect(order.paymentMode).toBe('ONLINE_FULL');
      expect(order.upfrontXof).toBe(totalXof);
      expect(order.balanceXof).toBe(0);
      expect(order.checkout).toBeDefined();
      expect(order.status).toBe('PENDING_PAYMENT');

      const payment = await prisma.payment.findFirstOrThrow({ where: { order: { reference: order.reference } } });
      expect(payment.amountXof).toBe(totalXof);
    });
  });

  describe('paiement à la livraison', () => {
    let reference: string;
    let totalXof: number;
    let shipmentRef: string;
    let otp: string;
    let receivableBefore: number;

    it('confirme la commande tout de suite, sans aucun paiement en ligne', async () => {
      receivableBefore = await ledgerBalance('RECEIVABLE_ON_DELIVERY');
      const placed = await place('CASH_ON_DELIVERY');
      reference = placed.order.reference;
      totalXof = placed.totalXof;

      expect(placed.order.paymentMode).toBe('CASH_ON_DELIVERY');
      expect(placed.order.upfrontXof).toBe(0);
      expect(placed.order.balanceXof).toBe(totalXof);
      expect(placed.order.checkout).toBeUndefined();
      expect(placed.order.status).not.toBe('PENDING_PAYMENT');
      expect(placed.order.placedAt).not.toBeNull();
      expect(placed.order.subOrders[0].balanceDueXof).toBe(totalXof);
      expect(placed.order.subOrders[0].status).toBe('PAYMENT_CONFIRMED');

      const payments = await prisma.payment.count({ where: { order: { reference } } });
      expect(payments).toBe(0);
    });

    it('inscrit le total en créance sur le client, sans toucher à la caisse', async () => {
      expect((await ledgerBalance('RECEIVABLE_ON_DELIVERY')) - receivableBefore).toBe(totalXof);
      expect((await ledger.checkInvariants()).ok).toBe(true);
    });

    it('refuse de confirmer la remise sans avoir déclaré l\'encaissement', async () => {
      ({ shipment: shipmentRef, otp } = await acceptAndAssign(reference));

      const mission = await api().get('/api/v1/courier/missions').set('Cookie', courierCookies).expect(200);
      const mine = mission.body.find((m: any) => m.reference === shipmentRef);
      expect(mine.cashToCollectXof).toBe(totalXof);

      const response = await api()
        .post(`/api/v1/courier/missions/${shipmentRef}/deliver`)
        .set('Cookie', courierCookies)
        .send(proof(otp))
        .expect(400);
      expect(JSON.stringify(response.body)).toContain('Encaissez');
    });

    it('refuse un encaissement inférieur à la part due', async () => {
      await api()
        .post(`/api/v1/courier/missions/${shipmentRef}/deliver`)
        .set('Cookie', courierCookies)
        .send({ ...proof(otp), cashCollectedXof: totalXof - 1 })
        .expect(400);
    });

    it('accepte la remise avec le montant exact, et le livreur détient les espèces', async () => {
      const heldBefore = await ledgerBalance('COURIER_CASH_HELD', courierUserId);
      await api()
        .post(`/api/v1/courier/missions/${shipmentRef}/deliver`)
        .set('Cookie', courierCookies)
        .send({ ...proof(otp), cashCollectedXof: totalXof })
        .expect(201);

      expect((await ledgerBalance('COURIER_CASH_HELD', courierUserId)) - heldBefore).toBe(totalXof);
      expect(await ledgerBalance('RECEIVABLE_ON_DELIVERY')).toBe(receivableBefore);

      const subOrder = await prisma.subOrder.findFirstOrThrow({ where: { reference: `${reference}-A` } });
      expect(subOrder.cashCollectedAt).not.toBeNull();
      expect(subOrder.cashCollectedXof).toBe(totalXof);

      const earnings = await api().get('/api/v1/courier/earnings').set('Cookie', courierCookies).expect(200);
      expect(earnings.body.cashHeldXof).toBe(totalXof);
    });

    it('l\'administration voit ce que le livreur doit, et enregistre le reversement', async () => {
      const cash = await api().get('/api/v1/admin/couriers/cash').set('Cookie', adminCookies).expect(200);
      const row = cash.body.find((r: any) => r.courierId === courierId);
      expect(row.cashHeldXof).toBe(totalXof);

      // On ne peut pas enregistrer plus que ce qu'il détient.
      await api()
        .post(`/api/v1/admin/couriers/${courierId}/remittance`)
        .set('Cookie', adminCookies)
        .send({ amountXof: totalXof + 1 })
        .expect(400);

      const cashBefore = await ledgerBalance('PLATFORM_CASH');
      const after = await api()
        .post(`/api/v1/admin/couriers/${courierId}/remittance`)
        .set('Cookie', adminCookies)
        .send({ amountXof: totalXof, note: 'Remise en main propre' })
        .expect(201);

      expect(after.body.cashHeldXof).toBe(0);
      expect((await ledgerBalance('PLATFORM_CASH')) - cashBefore).toBe(totalXof);
      expect((await ledger.checkInvariants()).problems).toEqual([]);
    });
  });

  describe('acompte de 50 %', () => {
    let reference: string;
    let totalXof: number;
    let upfront: number;

    it('crée un paiement pour la moitié seulement', async () => {
      const placed = await place('DEPOSIT_50');
      reference = placed.order.reference;
      totalXof = placed.totalXof;
      upfront = Math.ceil(totalXof / 2);

      expect(placed.order.paymentMode).toBe('DEPOSIT_50');
      expect(placed.order.upfrontXof).toBe(upfront);
      expect(placed.order.balanceXof).toBe(totalXof - upfront);
      expect(placed.order.status).toBe('PENDING_PAYMENT');
      expect(placed.order.checkout.amountXof).toBe(upfront);

      const payment = await prisma.payment.findFirstOrThrow({ where: { order: { reference } } });
      expect(payment.amountXof).toBe(upfront);
    });

    it('confirme à l\'encaissement de l\'acompte, avec le solde en créance', async () => {
      const receivableBefore = await ledgerBalance('RECEIVABLE_ON_DELIVERY');
      const cashBefore = await ledgerBalance('PLATFORM_CASH');

      await api().post(`/api/v1/admin/payments/simulate/${reference}`).set('Cookie', adminCookies).expect(201);

      const order = await api().get(`/api/v1/orders/${reference}`).set('Cookie', customerCookies).expect(200);
      expect(order.body.status).not.toBe('PENDING_PAYMENT');

      // La caisse reçoit l'acompte, moins les frais que retient l'agrégateur.
      const payment = await prisma.payment.findFirstOrThrow({ where: { order: { reference } } });
      expect((await ledgerBalance('PLATFORM_CASH')) - cashBefore).toBe(upfront - (payment.feeXof ?? 0));
      expect((await ledgerBalance('RECEIVABLE_ON_DELIVERY')) - receivableBefore).toBe(totalXof - upfront);
      expect((await ledger.checkInvariants()).problems).toEqual([]);
    });

    it('exige le solde à la remise, puis le livreur le détient', async () => {
      const { shipment, otp } = await acceptAndAssign(reference);
      const balance = totalXof - upfront;

      await api()
        .post(`/api/v1/courier/missions/${shipment}/deliver`)
        .set('Cookie', courierCookies)
        .send(proof(otp))
        .expect(400);

      await api()
        .post(`/api/v1/courier/missions/${shipment}/deliver`)
        .set('Cookie', courierCookies)
        .send({ ...proof(otp), cashCollectedXof: balance })
        .expect(201);

      expect(await ledgerBalance('COURIER_CASH_HELD', courierUserId)).toBe(balance);
      expect((await ledger.checkInvariants()).problems).toEqual([]);
    });
  });

  describe('annulation avant livraison', () => {
    it('une commande payée à la livraison, refusée par l\'atelier, ne rembourse rien et laisse le livre équilibré', async () => {
      const receivableBefore = await ledgerBalance('RECEIVABLE_ON_DELIVERY');

      const { order, totalXof } = await place('CASH_ON_DELIVERY');
      expect((await ledgerBalance('RECEIVABLE_ON_DELIVERY')) - receivableBefore).toBe(totalXof);
      const customerId = (await prisma.order.findFirstOrThrow({ where: { reference: order.reference } })).customerId;
      const dueBefore = await ledgerBalance('CUSTOMER_REFUNDABLE', customerId);

      await api()
        .post(`/api/v1/maker/orders/${order.reference}-A/reject`)
        .set('Cookie', makerCookies)
        .send({ reason: 'Plus disponible' })
        .expect(201);

      // La créance s'éteint : le client n'a rien payé, rien ne lui est rendu.
      expect(await ledgerBalance('RECEIVABLE_ON_DELIVERY')).toBe(receivableBefore);
      expect(await ledgerBalance('CUSTOMER_REFUNDABLE', customerId)).toBe(dueBefore);
      expect((await ledger.checkInvariants()).problems).toEqual([]);
    });

    it('une commande avec acompte refusée par l\'atelier rend l\'acompte, pas plus', async () => {
      const { order, totalXof } = await place('DEPOSIT_50');
      await api().post(`/api/v1/admin/payments/simulate/${order.reference}`).set('Cookie', adminCookies).expect(201);

      const customerId = (await prisma.order.findFirstOrThrow({ where: { reference: order.reference } })).customerId;
      const dueBefore = await ledgerBalance('CUSTOMER_REFUNDABLE', customerId);

      await api()
        .post(`/api/v1/maker/orders/${order.reference}-A/reject`)
        .set('Cookie', makerCookies)
        .send({ reason: 'Plus disponible' })
        .expect(201);

      const refunded = -((await ledgerBalance('CUSTOMER_REFUNDABLE', customerId)) - dueBefore);
      const upfront = Math.ceil(totalXof / 2);
      expect(refunded).toBeGreaterThan(0);
      expect(refunded).toBeLessThanOrEqual(upfront);
      expect((await ledger.checkInvariants()).problems).toEqual([]);
    });
  });

  describe('cohérence comptable', () => {
    it('garde le grand livre équilibré après tous les parcours', async () => {
      const result = await ledger.checkInvariants();
      expect(result.problems).toEqual([]);
      expect(result.ok).toBe(true);
    });
  });
});

function cookiesOf(response: request.Response): string[] {
  const raw = response.headers['set-cookie'];
  if (!raw) return [];
  return Array.isArray(raw) ? raw : [raw];
}
