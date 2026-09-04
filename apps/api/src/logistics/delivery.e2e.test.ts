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
 * De l'enlèvement au versement.
 *
 * Le fil conducteur : **la preuve de livraison est le verrou du circuit
 * financier**. Sans elle, pas de remise ; sans remise, pas de validation ;
 * sans validation, pas de versement au créateur.
 */

const MAKER = '+2250760000001';
const COURIER = '+2250760000002';
const CUSTOMER = '+2250760000003';
const ADMIN = '+2250760000004';
const PASSWORD = 'un-mot-de-passe-solide';

const ATELIER = { latitude: 5.36, longitude: -4.0083 };
const CHEZ_LE_CLIENT = { latitude: 5.3599, longitude: -3.9855 };

describe('Livraison et versement (bout en bout)', () => {
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
    customerCookies = await signUp('CUSTOMER', 'client.livraison@oja.market', CUSTOMER);
    courierCookies = await signUp('COURIER', 'livreur@oja.market', COURIER);
    makerCookies = await signUp('MAKER', 'atelier.livraison@oja.market', MAKER);

    const makerUser = await prisma.user.findFirstOrThrow({ where: { phone: MAKER } });
    makerUserId = makerUser.id;

    // Profil livreur validé, avec un tricycle : il peut tout porter ou presque.
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
        shopName: 'Atelier Livraison',
        cityId: abidjan.id,
        managerName: 'Responsable',
        contactPhone: '+2250799887766',
        contactEmail: 'atelier.livraison@oja.market',
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
        name: 'Table basse Ébrié',
        categoryId: category.id,
        description: 'Table basse en bois de teck, façonnée à la main.',
        makerPriceXof: 120_000,
        isMadeToOrder: false,
        quantityAvailable: 20,
        weightGrams: 12_000,
        lengthMm: 900,
        widthMm: 500,
        heightMm: 400,
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
    await signUp('CUSTOMER', 'admin.livraison@oja.market', ADMIN);
    await prisma.user.update({
      where: { phone: ADMIN },
      data: { role: 'ADMIN', status: 'ACTIVE' },
    });
    const response = await api()
      .post('/api/v1/auth/login')
      .send({ identifier: 'admin.livraison@oja.market', password: PASSWORD })
      .expect(200);
    return cookiesOf(response);
  }

  /** Commande payée, acceptée par l'atelier, donc prête à enlever. */
  async function orderReadyForPickup(): Promise<{ order: string; shipment: string; otp: string }> {
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

    await api()
      .post(`/api/v1/admin/payments/simulate/${order.body.reference}`)
      .set('Cookie', adminCookies)
      .expect(201);

    await api()
      .post(`/api/v1/maker/orders/${order.body.reference}-A/accept`)
      .set('Cookie', makerCookies)
      .expect(201);

    const shipment = await prisma.shipment.findFirstOrThrow({
      where: { order: { reference: order.body.reference } },
    });

    return {
      order: order.body.reference,
      shipment: shipment.reference,
      otp: shipment.proofOtp ?? '',
    };
  }

  describe('1 — création et affectation', () => {
    let refs: { order: string; shipment: string; otp: string };

    it('crée l’expédition dès que la pièce est prête, avec un code de réception', async () => {
      refs = await orderReadyForPickup();

      expect(refs.shipment).toMatch(/^LIV-\d{4}-\d{6}$/);
      // Le client doit avoir son code en main avant que le livreur ne sonne.
      expect(refs.otp).toMatch(/^\d{4}$/);
    });

    it('apparaît dans les missions à affecter', async () => {
      const response = await api()
        .get('/api/v1/admin/logistics/unassigned')
        .set('Cookie', adminCookies)
        .expect(200);

      const mission = response.body.find(
        (m: { reference: string }) => m.reference === refs.shipment,
      );
      expect(mission.shopName).toBe('Atelier Livraison');
      expect(mission.weightKg).toBe(12);
    });

    it('propose les livreurs dont le véhicule convient', async () => {
      const response = await api()
        .get(`/api/v1/admin/logistics/shipments/${refs.shipment}/couriers`)
        .set('Cookie', adminCookies)
        .expect(200);

      expect(response.body[0].suitable).toBe(true);
      expect(response.body[0].vehicle).toBe('TRICYCLE');
    });

    it('refuse un véhicule trop petit pour la charge', async () => {
      // Envoyer une moto chercher une table fait perdre une course à tout le
      // monde, et le livreur repart à vide.
      await prisma.courierProfile.update({
        where: { id: courierId },
        data: { vehicle: 'MOTO' },
      });
      await prisma.shipment.updateMany({
        where: { reference: refs.shipment },
        data: { vehicle: 'CAMIONNETTE' },
      });

      const response = await api()
        .post(`/api/v1/admin/logistics/shipments/${refs.shipment}/assign`)
        .set('Cookie', adminCookies)
        .send({ courierId })
        .expect(400);
      expect(response.body.detail).toContain('camionnette');

      await prisma.courierProfile.update({
        where: { id: courierId },
        data: { vehicle: 'TRICYCLE' },
      });
      await prisma.shipment.updateMany({
        where: { reference: refs.shipment },
        data: { vehicle: 'TRICYCLE' },
      });
    });

    it('affecte le livreur', async () => {
      const response = await api()
        .post(`/api/v1/admin/logistics/shipments/${refs.shipment}/assign`)
        .set('Cookie', adminCookies)
        .send({ courierId })
        .expect(201);
      expect(response.body.reference).toBe(refs.shipment);
    });

    it('n’expose jamais la mission à un autre livreur', async () => {
      const other = await signUp('COURIER', 'autre.livreur@oja.market', '+2250760000009');
      const otherUser = await prisma.user.findFirstOrThrow({
        where: { phone: '+2250760000009' },
      });
      await prisma.courierProfile.create({
        data: { userId: otherUser.id, vehicle: 'MOTO', kycStatus: 'APPROVED' },
      });

      await api()
        .post(`/api/v1/courier/missions/${refs.shipment}/pickup`)
        .set('Cookie', other)
        .expect(404); // pas 403
    });
  });

  describe('2 — la course', () => {
    let refs: { order: string; shipment: string; otp: string };

    beforeAll(async () => {
      refs = await orderReadyForPickup();
      await api()
        .post(`/api/v1/admin/logistics/shipments/${refs.shipment}/assign`)
        .set('Cookie', adminCookies)
        .send({ courierId })
        .expect(201);
    });

    it('donne au livreur les deux adresses et le téléphone du client', async () => {
      const response = await api()
        .get('/api/v1/courier/missions')
        .set('Cookie', courierCookies)
        .expect(200);

      const mission = response.body.find(
        (m: { reference: string }) => m.reference === refs.shipment,
      );
      expect(mission.pickup.shopName).toBe('Atelier Livraison');
      expect(mission.drop.phone).toBe('+2250700000000');
      expect(mission.statusLabel).toBe('À récupérer');
    });

    it('suit l’enlèvement puis le départ', async () => {
      await api()
        .post(`/api/v1/courier/missions/${refs.shipment}/pickup`)
        .set('Cookie', courierCookies)
        .expect(201);

      const order = await api()
        .get(`/api/v1/orders/${refs.order}`)
        .set('Cookie', customerCookies)
        .expect(200);
      expect(order.body.status).toBe('IN_DELIVERY');
      expect(order.body.statusLabel).toBe('En livraison');

      await api()
        .post(`/api/v1/courier/missions/${refs.shipment}/start`)
        .set('Cookie', courierCookies)
        .send(ATELIER)
        .expect(201);
    });

    it('interdit de sauter l’enlèvement', async () => {
      const autre = await orderReadyForPickup();
      await api()
        .post(`/api/v1/admin/logistics/shipments/${autre.shipment}/assign`)
        .set('Cookie', adminCookies)
        .send({ courierId })
        .expect(201);

      /* La machine à états refuse : on ne livre pas ce qu'on n'a pas récupéré.
         409 et non 500 — la demande est bien formée, c'est l'état de la
         mission qui s'y oppose. */
      const refus = await api()
        .post(`/api/v1/courier/missions/${autre.shipment}/deliver`)
        .set('Cookie', courierCookies)
        .send({ otp: autre.otp, photoKey: 'p.jpg' })
        .expect(409);
      expect(refus.body.detail).toContain('PICKED_UP');
    });

    describe('preuve de livraison', () => {
      it('refuse une remise sans preuve, en disant quoi apporter', async () => {
        const response = await api()
          .post(`/api/v1/courier/missions/${refs.shipment}/deliver`)
          .set('Cookie', courierCookies)
          .send({})
          .expect(400);

        const problems = JSON.stringify(response.body.errors);
        expect(problems).toContain('code');
        expect(problems).toContain('photo');
        expect(problems).toContain('localisation');
      });

      it('refuse un seul élément', async () => {
        await api()
          .post(`/api/v1/courier/missions/${refs.shipment}/deliver`)
          .set('Cookie', courierCookies)
          .send({ photoKey: 'proof/photo.jpg' })
          .expect(400);
      });

      it('refuse un code erroné', async () => {
        const response = await api()
          .post(`/api/v1/courier/missions/${refs.shipment}/deliver`)
          .set('Cookie', courierCookies)
          .send({ otp: '0000', photoKey: 'proof/photo.jpg' })
          .expect(400);
        expect(JSON.stringify(response.body.errors)).toContain('ne correspond pas');
      });

      it('refuse une position trop loin de l’adresse', async () => {
        await api()
          .post(`/api/v1/courier/missions/${refs.shipment}/deliver`)
          .set('Cookie', courierCookies)
          .send({ photoKey: 'p.jpg', latitude: 5.5, longitude: -4.2 })
          .expect(400);
      });

      it('accepte deux éléments sur trois', async () => {
        const response = await api()
          .post(`/api/v1/courier/missions/${refs.shipment}/deliver`)
          .set('Cookie', courierCookies)
          .send({
            otp: refs.otp,
            photoKey: 'proof/photo.jpg',
            ...CHEZ_LE_CLIENT,
          })
          .expect(201);

        expect(response.body.status).toBe('DELIVERED');
        expect(response.body.provided).toEqual(['otp', 'photo', 'gps']);
      });

      it('fait passer la commande en « Livrée »', async () => {
        const order = await api()
          .get(`/api/v1/orders/${refs.order}`)
          .set('Cookie', customerCookies)
          .expect(200);
        expect(order.body.status).toBe('DELIVERED');
        expect(order.body.statusLabel).toBe('Livrée');
      });

      it('retire le téléphone du client une fois la course finie', async () => {
        // Ojà reste l'intermédiaire unique, y compris après coup.
        const response = await api()
          .get('/api/v1/courier/missions?scope=past')
          .set('Cookie', courierCookies)
          .expect(200);

        const mission = response.body.find(
          (m: { reference: string }) => m.reference === refs.shipment,
        );
        expect(mission.drop.phone).toBeNull();
      });
    });

    describe('validation par le client', () => {
      it('ne verse rien tant que le client n’a pas validé', async () => {
        const payouts = await prisma.payoutItem.count({
          where: { beneficiaryId: makerUserId },
        });
        expect(payouts).toBe(0);
      });

      it('programme le versement 24 h après la validation', async () => {
        const response = await api()
          .post(`/api/v1/orders/${refs.order}-A/validate`)
          .set('Cookie', customerCookies)
          .expect(201);

        expect(response.body.status).toBe('VALIDATED');

        const hours = (new Date(response.body.payoutAt).getTime() - Date.now()) / 3_600_000;
        expect(Math.round(hours)).toBe(24);

        const payout = await prisma.payoutItem.findFirstOrThrow({
          where: { beneficiaryId: makerUserId },
        });
        expect(payout.amountXof).toBe(120_000); // le prix du créateur, en entier
        expect(payout.status).toBe('SCHEDULED');
      });

      it('clôt la commande', async () => {
        const order = await api()
          .get(`/api/v1/orders/${refs.order}`)
          .set('Cookie', customerCookies)
          .expect(200);
        expect(order.body.status).toBe('COMPLETED');
      });

      it('montre au créateur ce qui lui est dû', async () => {
        const response = await api()
          .get('/api/v1/maker/wallet')
          .set('Cookie', makerCookies)
          .expect(200);
        expect(response.body.scheduledXof).toBeGreaterThanOrEqual(120_000);
      });

      it('libère le versement à l’échéance', async () => {
        await prisma.payoutItem.updateMany({
          where: { beneficiaryId: makerUserId, status: 'SCHEDULED' },
          data: { releaseAt: new Date(Date.now() - 1_000) },
        });

        const response = await api()
          .post('/api/v1/admin/jobs/release-payouts')
          .set('Cookie', adminCookies)
          .expect(201);
        expect(response.body.released).toBeGreaterThanOrEqual(1);
      });

      it('empêche un client de valider la commande d’un autre', async () => {
        await api()
          .post(`/api/v1/orders/${refs.order}-A/validate`)
          .set('Cookie', adminCookies)
          .expect(404); // pas 403
      });
    });
  });

  describe('3 — le client signale un problème', () => {
    it('bloque le versement et fait repartir le colis', async () => {
      const refs = await orderReadyForPickup();
      await api()
        .post(`/api/v1/admin/logistics/shipments/${refs.shipment}/assign`)
        .set('Cookie', adminCookies)
        .send({ courierId })
        .expect(201);
      await api()
        .post(`/api/v1/courier/missions/${refs.shipment}/pickup`)
        .set('Cookie', courierCookies)
        .expect(201);
      await api()
        .post(`/api/v1/courier/missions/${refs.shipment}/start`)
        .set('Cookie', courierCookies)
        .send(ATELIER)
        .expect(201);
      await api()
        .post(`/api/v1/courier/missions/${refs.shipment}/deliver`)
        .set('Cookie', courierCookies)
        .send({ otp: refs.otp, photoKey: 'p.jpg', ...CHEZ_LE_CLIENT })
        .expect(201);

      const before = await prisma.payoutItem.count({ where: { beneficiaryId: makerUserId } });

      const response = await api()
        .post(`/api/v1/orders/${refs.order}-A/report-problem`)
        .set('Cookie', customerCookies)
        .send({ reason: 'casse', description: 'Le plateau est fendu sur toute la longueur.' })
        .expect(201);

      expect(response.body.disputeReference).toMatch(/^REC-\d{4}-\d{5}$/);

      // Aucun versement de plus : l'argent reste chez Ojà le temps du litige.
      expect(await prisma.payoutItem.count({ where: { beneficiaryId: makerUserId } })).toBe(
        before,
      );

      const shipment = await prisma.shipment.findFirstOrThrow({
        where: { reference: refs.shipment },
      });
      expect(shipment.status).toBe('RETURN_REQUIRED');

      const order = await api()
        .get(`/api/v1/orders/${refs.order}`)
        .set('Cookie', customerCookies)
        .expect(200);
      expect(order.body.status).toBe('DISPUTED');
    });
  });

  describe('4 — validation automatique', () => {
    it('valide au bout du délai si le client ne se prononce pas', async () => {
      const refs = await orderReadyForPickup();
      await api()
        .post(`/api/v1/admin/logistics/shipments/${refs.shipment}/assign`)
        .set('Cookie', adminCookies)
        .send({ courierId })
        .expect(201);
      await api()
        .post(`/api/v1/courier/missions/${refs.shipment}/pickup`)
        .set('Cookie', courierCookies)
        .expect(201);
      await api()
        .post(`/api/v1/courier/missions/${refs.shipment}/start`)
        .set('Cookie', courierCookies)
        .send(ATELIER)
        .expect(201);
      await api()
        .post(`/api/v1/courier/missions/${refs.shipment}/deliver`)
        .set('Cookie', courierCookies)
        .send({ otp: refs.otp, photoKey: 'p.jpg', ...CHEZ_LE_CLIENT })
        .expect(201);

      // Le client n'a rien cliqué depuis quatre jours.
      await prisma.subOrder.updateMany({
        where: { reference: `${refs.order}-A` },
        data: { deliveredAt: new Date(Date.now() - 4 * 86_400_000) },
      });

      const response = await api()
        .post('/api/v1/admin/jobs/auto-validate')
        .set('Cookie', adminCookies)
        .expect(201);

      // Un client passif ne doit pas priver indéfiniment le créateur de son
      // paiement : il a livré, il a fait son travail.
      expect(response.body.validated).toBeGreaterThanOrEqual(1);

      const order = await api()
        .get(`/api/v1/orders/${refs.order}`)
        .set('Cookie', customerCookies)
        .expect(200);
      expect(order.body.status).toBe('COMPLETED');
    });
  });

  describe('5 — cohérence comptable', () => {
    it('garde le grand livre équilibré après tout le parcours', async () => {
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
