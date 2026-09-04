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
 * Réclamations et remboursements.
 *
 * C'est le chemin qui restait ouvert sans conclusion : « Signaler un
 * problème » créait un litige que rien ne traitait. Il se ferme ici.
 *
 * Deux règles y sont vérifiées de près :
 *   · le remboursement porte sur **100 % du prix produit**, jamais partiel ;
 *   · client et créateur parlent à Ojà, **jamais l'un à l'autre**.
 */

const MAKER = '+2250750000001';
const COURIER = '+2250750000002';
const CUSTOMER = '+2250750000003';
const ADMIN = '+2250750000004';
const PASSWORD = 'un-mot-de-passe-solide';

const ATELIER = { latitude: 5.36, longitude: -4.0083 };
const CHEZ_LE_CLIENT = { latitude: 5.3599, longitude: -3.9855 };

describe('Réclamations (bout en bout)', () => {
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
  let makerUserId: string;

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
    customerCookies = await signUp('CUSTOMER', 'client.litige@oja.market', CUSTOMER);
    courierCookies = await signUp('COURIER', 'livreur.litige@oja.market', COURIER);
    makerCookies = await signUp('MAKER', 'atelier.litige@oja.market', MAKER);

    const makerUser = await prisma.user.findFirstOrThrow({ where: { phone: MAKER } });
    makerUserId = makerUser.id;

    const courierUser = await prisma.user.findFirstOrThrow({ where: { phone: COURIER } });
    const courier = await prisma.courierProfile.create({
      data: {
        userId: courierUser.id,
        vehicle: 'TRICYCLE',
        kycStatus: 'APPROVED',
        isAvailable: true,
      },
    });
    courierId = courier.id;
    await prisma.user.update({ where: { id: courierUser.id }, data: { status: 'ACTIVE' } });

    const profile = await api()
      .post('/api/v1/maker/profile')
      .set('Cookie', makerCookies)
      .send({
        shopName: 'Atelier Litige',
        cityId: abidjan.id,
        managerName: 'Responsable',
        contactPhone: '+2250799887766',
        contactEmail: 'atelier.litige@oja.market',
        postalAddress: 'Adresse postale',
        ifuNumber: 'IFU-TEST',
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
        name: 'Vase Sassandra',
        categoryId: category.id,
        description: 'Vase en terre cuite tourné et cuit au feu de bois.',
        makerPriceXof: 60_000,
        isMadeToOrder: false,
        quantityAvailable: 50,
        weightGrams: 4_000,
        lengthMm: 300,
        widthMm: 300,
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
    /* L'inscription ouvre le compte ET la session : plus de code à saisir.
       La vérification par SMS reste disponible derrière REQUIRE_PHONE_VERIFICATION. */
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
    await signUp('CUSTOMER', 'admin.litige@oja.market', ADMIN);
    await prisma.user.update({
      where: { phone: ADMIN },
      data: { role: 'ADMIN', status: 'ACTIVE' },
    });
    const response = await api()
      .post('/api/v1/auth/login')
      .send({ identifier: 'admin.litige@oja.market', password: PASSWORD })
      .expect(200);
    return cookiesOf(response);
  }

  /** Commande livrée, prête à faire l'objet d'une réclamation. */
  async function deliveredOrder(): Promise<{ order: string; deliveryFeeXof: number }> {
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

    const order = await api()
      .post('/api/v1/checkout')
      .set('Cookie', customerCookies)
      .send({ addressId, expectedTotalXof: quote.body.totalXof })
      .expect(201);

    const reference = order.body.reference;

    await api()
      .post(`/api/v1/admin/payments/simulate/${reference}`)
      .set('Cookie', adminCookies)
      .expect(201);
    await api()
      .post(`/api/v1/maker/orders/${reference}-A/accept`)
      .set('Cookie', makerCookies)
      .expect(201);

    const shipment = await prisma.shipment.findFirstOrThrow({
      where: { order: { reference } },
    });

    await api()
      .post(`/api/v1/admin/logistics/shipments/${shipment.reference}/assign`)
      .set('Cookie', adminCookies)
      .send({ courierId })
      .expect(201);
    await api()
      .post(`/api/v1/courier/missions/${shipment.reference}/pickup`)
      .set('Cookie', courierCookies)
      .expect(201);
    await api()
      .post(`/api/v1/courier/missions/${shipment.reference}/start`)
      .set('Cookie', courierCookies)
      .send(ATELIER)
      .expect(201);
    await api()
      .post(`/api/v1/courier/missions/${shipment.reference}/deliver`)
      .set('Cookie', courierCookies)
      .send({ otp: shipment.proofOtp, photoKey: 'p.jpg', ...CHEZ_LE_CLIENT })
      .expect(201);

    return { order: reference, deliveryFeeXof: order.body.deliveryTotalXof };
  }

  async function openDispute(orderReference: string): Promise<string> {
    const response = await api()
      .post(`/api/v1/orders/${orderReference}-A/report-problem`)
      .set('Cookie', customerCookies)
      .send({ reason: 'casse', description: 'Le vase est arrivé fendu sur toute la hauteur.' })
      .expect(201);
    return response.body.disputeReference;
  }

  describe('1 — ouverture et échanges', () => {
    let orderRef: string;
    let disputeRef: string;

    it('ouvre la réclamation à la réception', async () => {
      const placed = await deliveredOrder();
      orderRef = placed.order;
      disputeRef = await openDispute(orderRef);

      const response = await api()
        .get(`/api/v1/disputes/${disputeRef}`)
        .set('Cookie', customerCookies)
        .expect(200);

      expect(response.body.status).toBe('OPEN');
      expect(response.body.reasonLabel).toBe('La pièce est arrivée cassée');
      expect(response.body.messages).toHaveLength(1);
    });

    it('la rend visible au créateur concerné', async () => {
      const response = await api()
        .get('/api/v1/disputes')
        .set('Cookie', makerCookies)
        .expect(200);

      expect(response.body.some((d: { reference: string }) => d.reference === disputeRef)).toBe(
        true,
      );
    });

    it('la cache à tout tiers', async () => {
      const stranger = await signUp('CUSTOMER', 'curieux.litige@oja.market', '+2250750000009');
      // Un tiers ne doit pas même apprendre qu'une réclamation existe.
      await api()
        .get(`/api/v1/disputes/${disputeRef}`)
        .set('Cookie', stranger)
        .expect(404);
    });

    it('passe en examen dès la première réponse de l’équipe', async () => {
      await api()
        .post(`/api/v1/disputes/${disputeRef}/messages`)
        .set('Cookie', adminCookies)
        .send({ body: 'Bonjour, pouvez-vous nous envoyer une photo de la fente ?' })
        .expect(201);

      const response = await api()
        .get(`/api/v1/disputes/${disputeRef}`)
        .set('Cookie', customerCookies)
        .expect(200);

      expect(response.body.status).toBe('UNDER_REVIEW');
      expect(response.body.statusLabel).toBe('En cours d’examen');
      // Le client doit distinguer le Support de l'atelier.
      expect(response.body.messages.at(-1).fromAdmin).toBe(true);
    });

    it('garde les notes internes hors de portée des parties', async () => {
      await api()
        .post(`/api/v1/disputes/${disputeRef}/messages`)
        .set('Cookie', adminCookies)
        .send({ body: 'Atelier déjà signalé deux fois ce mois-ci.', isInternal: true })
        .expect(201);

      const forCustomer = await api()
        .get(`/api/v1/disputes/${disputeRef}`)
        .set('Cookie', customerCookies)
        .expect(200);
      expect(JSON.stringify(forCustomer.body)).not.toContain('deux fois ce mois-ci');

      const forMaker = await api()
        .get(`/api/v1/disputes/${disputeRef}`)
        .set('Cookie', makerCookies)
        .expect(200);
      expect(JSON.stringify(forMaker.body)).not.toContain('deux fois ce mois-ci');

      const forAdmin = await api()
        .get(`/api/v1/disputes/${disputeRef}`)
        .set('Cookie', adminCookies)
        .expect(200);
      expect(JSON.stringify(forAdmin.body)).toContain('deux fois ce mois-ci');
    });

    it('refuse une note interne écrite par une partie', async () => {
      await api()
        .post(`/api/v1/disputes/${disputeRef}/messages`)
        .set('Cookie', customerCookies)
        .send({ body: 'Note discrète', isInternal: true })
        .expect(403);
    });
  });

  describe('2 — remboursement', () => {
    it('rend 100 % du prix produit, et garde livraison et commission', async () => {
      const placed = await deliveredOrder();
      const disputeRef = await openDispute(placed.order);

      const owedBefore = await ledger.balanceOf('MAKER_PAYABLE', makerUserId);

      const response = await api()
        .post(`/api/v1/admin/disputes/${disputeRef}/resolve`)
        .set('Cookie', adminCookies)
        .send({
          decision: 'REFUND',
          note: 'Photos concluantes, la pièce est bien cassée.',
          chargeToMaker: true,
        })
        .expect(201);

      // Règle du cahier client : le prix produit, rien de plus.
      expect(response.body.refundXof).toBe(60_000);

      // La dette envers le créateur s'éteint : il ne sera pas payé.
      const owedAfter = await ledger.balanceOf('MAKER_PAYABLE', makerUserId);
      expect(owedAfter).toBe(owedBefore + 60_000);

      const order = await api()
        .get(`/api/v1/orders/${placed.order}`)
        .set('Cookie', customerCookies)
        .expect(200);
      expect(order.body.status).toBe('REFUNDED');
    });

    it('permet à l’administration de rendre aussi la livraison, en geste', async () => {
      const placed = await deliveredOrder();
      const disputeRef = await openDispute(placed.order);

      const response = await api()
        .post(`/api/v1/admin/disputes/${disputeRef}/resolve`)
        .set('Cookie', adminCookies)
        .send({
          decision: 'REFUND',
          note: 'Deuxième incident, geste commercial.',
          refundDelivery: true,
          chargeToMaker: true,
        })
        .expect(201);

      // C'est une exception assumée, pas un réglage silencieux.
      expect(response.body.refundXof).toBe(60_000 + placed.deliveryFeeXof);
    });

    it('peut faire porter la perte à Ojà plutôt qu’au créateur', async () => {
      const placed = await deliveredOrder();
      const disputeRef = await openDispute(placed.order);

      const owedBefore = await ledger.balanceOf('MAKER_PAYABLE', makerUserId);

      await api()
        .post(`/api/v1/admin/disputes/${disputeRef}/resolve`)
        .set('Cookie', adminCookies)
        .send({
          decision: 'REFUND',
          note: 'Casse survenue en transit, l’atelier n’y est pour rien.',
          chargeToMaker: false,
        })
        .expect(201);

      // Le créateur garde son dû : c'est Ojà qui absorbe.
      expect(await ledger.balanceOf('MAKER_PAYABLE', makerUserId)).toBe(owedBefore);
    });

    it('annule le versement programmé au créateur tenu pour responsable', async () => {
      const placed = await deliveredOrder();

      // Le client valide d'abord, puis se ravise — le versement était programmé.
      await api()
        .post(`/api/v1/orders/${placed.order}-A/validate`)
        .set('Cookie', customerCookies)
        .expect(201);

      const payout = await prisma.payoutItem.findFirstOrThrow({
        where: { subOrder: { reference: `${placed.order}-A` } },
      });
      expect(payout.status).toBe('SCHEDULED');

      /* La sous-commande est repassée en DELIVERED pour permettre le signalement :
         en pratique le client se prononce une seule fois, mais l'annulation du
         versement doit fonctionner si l'administration rouvre le dossier. */
      await prisma.subOrder.updateMany({
        where: { reference: `${placed.order}-A` },
        data: { status: 'DELIVERED' },
      });

      const disputeRef = await openDispute(placed.order);
      await api()
        .post(`/api/v1/admin/disputes/${disputeRef}/resolve`)
        .set('Cookie', adminCookies)
        .send({ decision: 'REFUND', note: 'Pièce non conforme.', chargeToMaker: true })
        .expect(201);

      const after = await prisma.payoutItem.findUniqueOrThrow({ where: { id: payout.id } });
      expect(after.status).toBe('CANCELLED');
    });

    it('refuse de trancher deux fois', async () => {
      const placed = await deliveredOrder();
      const disputeRef = await openDispute(placed.order);

      await api()
        .post(`/api/v1/admin/disputes/${disputeRef}/resolve`)
        .set('Cookie', adminCookies)
        .send({ decision: 'REFUND', note: 'Remboursé.', chargeToMaker: true })
        .expect(201);

      await api()
        .post(`/api/v1/admin/disputes/${disputeRef}/resolve`)
        .set('Cookie', adminCookies)
        .send({ decision: 'REJECT', note: 'Finalement non.' })
        .expect(400);
    });

    it('ferme les échanges une fois tranchée', async () => {
      const placed = await deliveredOrder();
      const disputeRef = await openDispute(placed.order);
      await api()
        .post(`/api/v1/admin/disputes/${disputeRef}/resolve`)
        .set('Cookie', adminCookies)
        .send({ decision: 'REFUND', note: 'Remboursé.', chargeToMaker: true })
        .expect(201);

      await api()
        .post(`/api/v1/disputes/${disputeRef}/messages`)
        .set('Cookie', customerCookies)
        .send({ body: 'Une dernière chose…' })
        .expect(400);
    });
  });

  describe('3 — rejet', () => {
    it('remet la livraison dans son état normal', async () => {
      const placed = await deliveredOrder();
      const disputeRef = await openDispute(placed.order);

      const shipmentBefore = await prisma.shipment.findFirstOrThrow({
        where: { order: { reference: placed.order } },
      });
      expect(shipmentBefore.status).toBe('RETURN_REQUIRED');

      await api()
        .post(`/api/v1/admin/disputes/${disputeRef}/resolve`)
        .set('Cookie', adminCookies)
        .send({
          decision: 'REJECT',
          note: 'Les photos montrent une pièce intacte, conforme à l’annonce.',
        })
        .expect(201);

      // La livraison est réputée conforme : le créateur sera payé.
      const shipmentAfter = await prisma.shipment.findUniqueOrThrow({
        where: { id: shipmentBefore.id },
      });
      expect(shipmentAfter.status).toBe('DELIVERED');

      const order = await api()
        .get(`/api/v1/orders/${placed.order}`)
        .set('Cookie', customerCookies)
        .expect(200);
      expect(order.body.status).toBe('DELIVERED');
    });

    it('exige une motivation', async () => {
      const placed = await deliveredOrder();
      const disputeRef = await openDispute(placed.order);

      await api()
        .post(`/api/v1/admin/disputes/${disputeRef}/resolve`)
        .set('Cookie', adminCookies)
        .send({ decision: 'REJECT', note: '' })
        .expect(400);
    });

    it('interdit de rembourser la livraison sur un rejet', async () => {
      const placed = await deliveredOrder();
      const disputeRef = await openDispute(placed.order);

      await api()
        .post(`/api/v1/admin/disputes/${disputeRef}/resolve`)
        .set('Cookie', adminCookies)
        .send({ decision: 'REJECT', note: 'Non retenu.', refundDelivery: true })
        .expect(400);
    });
  });

  describe('4 — délai de traitement', () => {
    it('signale les réclamations en retard', async () => {
      const placed = await deliveredOrder();
      const disputeRef = await openDispute(placed.order);

      await prisma.dispute.updateMany({
        where: { reference: disputeRef },
        data: { slaDueAt: new Date(Date.now() - 5 * 3_600_000) },
      });

      const response = await api()
        .get('/api/v1/admin/disputes/overdue')
        .set('Cookie', adminCookies)
        .expect(200);

      const late = response.body.find((d: { reference: string }) => d.reference === disputeRef);
      // Un client qui attend sans nouvelle appelle, puis renonce.
      expect(late.hoursLate).toBeGreaterThanOrEqual(4);
    });

    it('refuse l’arbitrage à un non-administrateur', async () => {
      const placed = await deliveredOrder();
      const disputeRef = await openDispute(placed.order);

      await api()
        .post(`/api/v1/admin/disputes/${disputeRef}/resolve`)
        .set('Cookie', customerCookies)
        .send({ decision: 'REFUND', note: 'Je me rembourse moi-même.' })
        .expect(404); // pas 403
    });
  });

  describe('5 — cohérence comptable', () => {
    it('garde le grand livre équilibré après tous les remboursements', async () => {
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
