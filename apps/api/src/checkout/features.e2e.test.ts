import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../app.module';
import { DomainErrorFilter } from '../common/domain-error.filter';
import { ProblemFilter } from '../common/problem.filter';
import { InvoiceService } from './invoice.service';
import { LedgerService } from '../ledger/ledger.service';
import { PrismaService } from '../prisma/prisma.service';
import { resetTestData } from '../test/cleanup';

/**
 * Fonctionnalités transverses ajoutées ensemble : codes promo (L2-11), facture
 * PDF (L2-20), notifications in-app (LN-04) et suivi de livraison (F1-07).
 *
 * Un seul montage d'application et un seul atelier : ces vérifications
 * partagent le même décor, autant l'amortir.
 */

const MAKER_PHONE = '+2250781000001';
const CUSTOMER_PHONE = '+2250781000002';
const STRANGER_PHONE = '+2250781000003';
const ADMIN_PHONE = '+2250781000004';
const PASSWORD = 'un-mot-de-passe-solide';
const ABIDJAN = { latitude: 5.36, longitude: -4.0083 };
const COCODY = { latitude: 5.3599, longitude: -3.9855 };

describe('Codes promo, facture, notifications, suivi', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ledger: LedgerService;

  let adminCookies: string[];
  let customerCookies: string[];
  let strangerCookies: string[];
  let makerCookies: string[];
  let makerUserId: string;
  let productId: string;
  let addressId: string;

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
    customerCookies = await signUp('CUSTOMER', 'client.feat@oja.market', CUSTOMER_PHONE);
    strangerCookies = await signUp('CUSTOMER', 'tiers.feat@oja.market', STRANGER_PHONE);

    makerCookies = await signUp('MAKER', 'atelier.feat@oja.market', MAKER_PHONE);
    makerUserId = (
      await prisma.user.findFirstOrThrow({ where: { phone: MAKER_PHONE } })
    ).id;

    const profile = await api()
      .post('/api/v1/maker/profile')
      .set('Cookie', makerCookies)
      .send({
        shopName: 'Atelier Feat',
        cityId: abidjan.id,
        managerName: 'Responsable',
        contactPhone: '+2250799887766',
        contactEmail: 'atelier.feat@oja.market',
        postalAddress: 'Adresse postale',
        ifuNumber: 'IFU-TEST',
        pickupLine1: "Adresse de l'atelier",
        pickupLatitude: ABIDJAN.latitude,
        pickupLongitude: ABIDJAN.longitude,
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
        name: 'Table basse Feat',
        categoryId: category.id,
        description: 'Pièce façonnée à la main dans un atelier partenaire d’Ojà.',
        makerPriceXof: 100_000,
        isMadeToOrder: false,
        quantityAvailable: 20,
        weightGrams: 8_000,
        lengthMm: 500,
        widthMm: 400,
        heightMm: 450,
      })
      .expect(201);
    productId = product.body.id;
    await prisma.productImage.createMany({
      data: [0, 1, 2].map((position) => ({
        productId,
        fileKey: `demo/${position}.jpg`,
        position,
      })),
    });
    await api()
      .post(`/api/v1/maker/products/${productId}/submit`)
      .set('Cookie', makerCookies)
      .expect(201);
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
        latitude: COCODY.latitude,
        longitude: COCODY.longitude,
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
    const raw = response.headers['set-cookie'];
    return Array.isArray(raw) ? raw : raw ? [raw] : [];
  }

  async function signUpAdmin(): Promise<string[]> {
    await signUp('CUSTOMER', 'admin.feat@oja.market', ADMIN_PHONE);
    await prisma.user.update({
      where: { phone: ADMIN_PHONE },
      data: { role: 'ADMIN', status: 'ACTIVE' },
    });
    const response = await api()
      .post('/api/v1/auth/login')
      .send({ identifier: 'admin.feat@oja.market', password: PASSWORD })
      .expect(200);
    const raw = response.headers['set-cookie'];
    return Array.isArray(raw) ? raw : raw ? [raw] : [];
  }

  async function fillCart(quantity: number): Promise<void> {
    await api().delete('/api/v1/cart').set('Cookie', customerCookies).expect(204);
    await api()
      .post('/api/v1/cart/items')
      .set('Cookie', customerCookies)
      .send({ productId, quantity })
      .expect(201);
  }

  // ═══════════════════════════════ Codes promo + grand livre

  describe('codes promo', () => {
    it('refuse un code inconnu au chiffrage, sans bloquer le reste', async () => {
      await fillCart(1);
      const quote = await api()
        .post('/api/v1/checkout/quote')
        .set('Cookie', customerCookies)
        .send({ addressId, promoCode: 'NEXISTEPAS' })
        .expect(201);

      expect(quote.body.promo).toBeNull();
      expect(quote.body.discountXof).toBe(0);
      expect(quote.body.blockers.some((b: string) => b.includes('NEXISTEPAS'))).toBe(true);
    });

    it('plafonne une remise en pourcentage à la commission Ojà', async () => {
      await api()
        .post('/api/v1/admin/promo-codes')
        .set('Cookie', adminCookies)
        .send({ code: 'MOITIE', kind: 'PERCENT', valueBps: 5000 })
        .expect(201);

      await fillCart(1);
      const bare = await api()
        .post('/api/v1/checkout/quote')
        .set('Cookie', customerCookies)
        .send({ addressId })
        .expect(201);
      const quote = await api()
        .post('/api/v1/checkout/quote')
        .set('Cookie', customerCookies)
        .send({ addressId, promoCode: 'MOITIE' })
        .expect(201);

      // 50 % de (articles + livraison) dépasse largement la commission
      // (5 % de 100 000 = 5 000) : la remise est ramenée à la commission, le
      // créateur reste payé en entier.
      expect(quote.body.discountXof).toBe(5_000);
      expect(quote.body.totalXof).toBe(bare.body.totalXof - quote.body.discountXof);
      // Le chiffrage ne divulgue pas la commission.
      expect(bare.body.commissionTotalXof).toBeUndefined();
    });

    it('applique une remise fixe et garde le grand livre équilibré', async () => {
      await api()
        .post('/api/v1/admin/promo-codes')
        .set('Cookie', adminCookies)
        .send({ code: 'MOINS2000', kind: 'FIXED', amountXof: 2_000 })
        .expect(201);

      await fillCart(1);
      const bare = await api()
        .post('/api/v1/checkout/quote')
        .set('Cookie', customerCookies)
        .send({ addressId })
        .expect(201);
      const quote = await api()
        .post('/api/v1/checkout/quote')
        .set('Cookie', customerCookies)
        .send({ addressId, promoCode: 'MOINS2000' })
        .expect(201);
      expect(quote.body.discountXof).toBe(2_000);
      expect(quote.body.promo).toMatchObject({ code: 'MOINS2000' });

      const order = await api()
        .post('/api/v1/checkout')
        .set('Cookie', customerCookies)
        .send({ addressId, expectedTotalXof: quote.body.totalXof, promoCode: 'MOINS2000' })
        .expect(201);
      const reference: string = order.body.reference;
      expect(order.body.discountXof).toBe(2_000);
      expect(order.body.promoCode).toBe('MOINS2000');

      await api()
        .post(`/api/v1/admin/payments/simulate/${reference}`)
        .set('Cookie', adminCookies)
        .expect(201);

      const invariants = await ledger.checkInvariants();
      expect(invariants.ok, invariants.problems.join(' / ')).toBe(true);

      // Le créateur est dû la totalité de sa part, remise ou pas.
      expect(await ledger.balanceOf('MAKER_PAYABLE', makerUserId)).toBe(-100_000);
      // La remise sort du revenu Ojà : commission encaissée (5 000) − 2 000.
      expect(await ledger.balanceOf('PLATFORM_REVENUE')).toBe(-(5_000 - 2_000));
    });

    it("interdit un second usage du même code par le même client (perUserLimit)", async () => {
      await fillCart(1);
      const quote = await api()
        .post('/api/v1/checkout/quote')
        .set('Cookie', customerCookies)
        .send({ addressId, promoCode: 'MOINS2000' })
        .expect(201);
      expect(quote.body.blockers.some((b: string) => b.includes('déjà utilisé'))).toBe(true);
      expect(quote.body.promo).toBeNull();
    });
  });

  // ═══════════════════════════════ Facture

  describe('facture', () => {
    it('émet une facture téléchargeable une fois la commande payée', async () => {
      await fillCart(2);
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
      const reference: string = order.body.reference;

      // Pas encore payée : pas de facture.
      await api()
        .get(`/api/v1/orders/${reference}/invoice`)
        .set('Cookie', customerCookies)
        .expect(404);

      await api()
        .post(`/api/v1/admin/payments/simulate/${reference}`)
        .set('Cookie', adminCookies)
        .expect(201);

      // Payée : le bouton s'affiche, avant même que le PDF soit composé.
      const view = await api()
        .get(`/api/v1/orders/${reference}`)
        .set('Cookie', customerCookies)
        .expect(200);
      expect(view.body.hasInvoice).toBe(true);

      /* L'ordonnanceur et un clic en même temps : un seul numéro, et le
         compteur n'avance que d'un cran — la numérotation reste sans trou. */
      const invoices = app.get(InvoiceService);
      const [first, second] = await Promise.all([
        invoices.generateForOrder(order.body.id),
        invoices.generateForOrder(order.body.id),
      ]);
      expect(second.number).toBe(first.number);
      const year = first.issuedAt.getFullYear();
      const counter = await prisma.referenceCounter.findUniqueOrThrow({
        where: { scope_year: { scope: 'invoice', year } },
      });
      expect(first.number).toBe(`FAC-${year}-${String(counter.value).padStart(6, '0')}`);

      // Datée de l'encaissement, pas du premier téléchargement.
      const payment = await prisma.payment.findFirstOrThrow({
        where: { orderId: order.body.id, status: 'PAID' },
      });
      expect(first.issuedAt.toISOString()).toBe(payment.paidAt!.toISOString());

      // Déjà émise : l'ordonnanceur ne la refait pas.
      await invoices.issuePending();
      expect(await prisma.invoice.count({ where: { orderId: order.body.id } })).toBe(1);

      const invoice = await api()
        .get(`/api/v1/orders/${reference}/invoice`)
        .set('Cookie', customerCookies)
        .expect(200);
      expect(invoice.body.number).toBe(first.number);
      expect(invoice.body.url).toContain('http');

      // Idempotent : un second appel renvoie le même numéro.
      const again = await api()
        .get(`/api/v1/orders/${reference}/invoice`)
        .set('Cookie', customerCookies)
        .expect(200);
      expect(again.body.number).toBe(invoice.body.number);

      // Un tiers ne voit pas la facture d'autrui.
      await api()
        .get(`/api/v1/orders/${reference}/invoice`)
        .set('Cookie', strangerCookies)
        .expect(404);

      const stored = await prisma.invoice.findFirst({ where: { number: invoice.body.number } });
      expect(stored?.country).toBeTruthy();
    });
  });

  // ═══════════════════════════════ Notifications in-app

  describe('notifications in-app', () => {
    it('dépose un avis lisible au créateur quand une commande est payée', async () => {
      await fillCart(1);
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
      await api()
        .post(`/api/v1/admin/payments/simulate/${order.body.reference}`)
        .set('Cookie', adminCookies)
        .expect(201);

      const list = await api()
        .get('/api/v1/notifications')
        .set('Cookie', makerCookies)
        .expect(200);
      const received = list.body.items.find(
        (n: { template: string }) => n.template === 'sub_order_received',
      );
      expect(received).toBeTruthy();
      expect(received.href).toBe('/espace-createur/commandes');
      expect(received.readAt).toBeNull();

      const count = await api()
        .get('/api/v1/notifications/unread-count')
        .set('Cookie', makerCookies)
        .expect(200);
      expect(count.body.count).toBeGreaterThan(0);

      await api()
        .post('/api/v1/notifications/read')
        .set('Cookie', makerCookies)
        .send({})
        .expect(200);

      const after = await api()
        .get('/api/v1/notifications/unread-count')
        .set('Cookie', makerCookies)
        .expect(200);
      expect(after.body.count).toBe(0);

      // Le client ne voit pas les notifications du créateur.
      const customerList = await api()
        .get('/api/v1/notifications')
        .set('Cookie', customerCookies)
        .expect(200);
      expect(
        customerList.body.items.every(
          (n: { template: string }) => n.template !== 'sub_order_received',
        ),
      ).toBe(true);
    });
  });

  // ═══════════════════════════════ Suivi de livraison

  describe('suivi de livraison', () => {
    it('ne donne le suivi qu’au client de la commande', async () => {
      await fillCart(1);
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
      const reference: string = order.body.reference;
      await api()
        .post(`/api/v1/admin/payments/simulate/${reference}`)
        .set('Cookie', adminCookies)
        .expect(201);

      // Pièce en stock : l'acceptation la fait passer directement « prête à
      // enlever » et crée l'expédition.
      const subRef = `${reference}-A`;
      await api()
        .post(`/api/v1/maker/orders/${subRef}/accept`)
        .set('Cookie', makerCookies)
        .expect(201);

      const shipment = await prisma.shipment.findFirstOrThrow({
        where: { order: { reference } },
      });

      const track = await api()
        .get(`/api/v1/shipments/${shipment.reference}/track`)
        .set('Cookie', customerCookies)
        .expect(200);
      expect(track.body.reference).toBe(shipment.reference);
      expect(Array.isArray(track.body.events)).toBe(true);

      await api()
        .get(`/api/v1/shipments/${shipment.reference}/track`)
        .set('Cookie', strangerCookies)
        .expect(404);
    });
  });
});
