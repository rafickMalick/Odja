import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../app.module';
import { DomainErrorFilter } from '../common/domain-error.filter';
import { ProblemFilter } from '../common/problem.filter';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Parcours du livreur, contre une vraie base.
 *
 * Le cas qui compte vraiment est le dernier : **un livreur validé doit
 * apparaître dans la liste d'affectation**. Il a manqué en développement — le
 * dossier passait à « validé » sans que le compte utilisateur soit activé, si
 * bien que `suggestCouriers` le filtrait. Validé, disponible, et pourtant
 * introuvable : la panne la plus coûteuse à diagnostiquer, parce que tout
 * semble correct des deux côtés.
 */

const PASSWORD = 'un-mot-de-passe-solide';
const COURIER_EMAIL = 'livreur.test@oja.market';
const COURIER_PHONE = '+2250793000001';
const ADMIN_EMAIL = 'admin.livreur@oja.market';
const ADMIN_PHONE = '+2250793000002';

describe('Espace livreur (bout en bout)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let courierCookies: string[];
  let adminCookies: string[];
  let courierId: string;
  let shipmentReference: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    app.setGlobalPrefix('api/v1');
    app.use(cookieParser());
    app.useGlobalFilters(new ProblemFilter(), new DomainErrorFilter());
    await app.init();

    prisma = app.get(PrismaService);
    await cleanUp();

    courierCookies = await signUp('COURIER', COURIER_EMAIL, COURIER_PHONE);
    adminCookies = await signUpAdmin();
  }, 90_000);

  afterAll(async () => {
    await cleanUp();
    await app.close();
  });

  describe('1 — profil', () => {
    it('crée le profil livreur', async () => {
      const response = await api()
        .post('/api/v1/courier/profile')
        .set('Cookie', courierCookies)
        .send({ vehicle: 'CAMIONNETTE', plateNumber: 'CI 1234 AB' })
        .expect(201);

      expect(response.body.kycStatus).toBe('NOT_SUBMITTED');
      expect(response.body.isAvailable).toBe(false);
      courierId = response.body.id;
    });

    it('refuse la création à un client', async () => {
      // 404 et non 403 : on ne confirme pas l'existence de la route.
      await api().post('/api/v1/courier/profile').send({ vehicle: 'MOTO' }).expect(401);
    });

    it('rend les valeurs brutes de son propre formulaire', async () => {
      const response = await api()
        .get('/api/v1/courier/profile')
        .set('Cookie', courierCookies)
        .expect(200);

      expect(response.body.vehicle).toBe('CAMIONNETTE');
      expect(response.body.plateNumber).toBe('CI 1234 AB');
    });
  });

  describe('2 — dossier', () => {
    it('énumère TOUS les manques d’un coup', async () => {
      const response = await api()
        .post('/api/v1/courier/kyc/submit')
        .set('Cookie', courierCookies)
        .expect(400);

      /* Renvoyer le candidat cinq fois de suite pour un champ à la fois est le
         meilleur moyen de le perdre. */
      const detail = response.body.detail as string;
      expect(detail).toContain("pièce d'identité");
      expect(detail).toContain('permis');
      expect(detail).toContain('carte grise');
    });

    it('accepte le dépôt une fois les pièces déposées', async () => {
      await prisma.kycDocument.createMany({
        data: ['cni_recto', 'permis', 'carte_grise'].map((type) => ({
          courierId,
          type,
          fileKey: `private/test/${type}.jpg`,
        })),
      });

      const response = await api()
        .post('/api/v1/courier/kyc/submit')
        .set('Cookie', courierCookies)
        .expect(201);

      expect(response.body.status).toBe('PENDING');
    });

    it('exige un motif pour refuser', async () => {
      await api()
        .post(`/api/v1/admin/couriers/${courierId}/review`)
        .set('Cookie', adminCookies)
        .send({ decision: 'REJECT' })
        .expect(400);
    });
  });

  describe('3 — validation et affectation', () => {
    it('valide le dossier', async () => {
      const response = await api()
        .post(`/api/v1/admin/couriers/${courierId}/review`)
        .set('Cookie', adminCookies)
        .send({ decision: 'APPROVE' })
        .expect(201);

      expect(response.body.kycStatus).toBe('APPROVED');
    });

    it('active AUSSI le compte utilisateur', async () => {
      /* C'est le bug qui a manqué : sans cette activation, le livreur est
         validé mais son compte reste « en attente », et il disparaît de toute
         liste d'affectation. */
      const profile = await prisma.courierProfile.findUniqueOrThrow({
        where: { id: courierId },
        include: { user: { select: { status: true } } },
      });
      expect(profile.user.status).toBe('ACTIVE');
    });

    it('apparaît dans les livreurs proposés une fois disponible', async () => {
      await api()
        .post('/api/v1/courier/availability')
        .set('Cookie', courierCookies)
        .send({ isAvailable: true })
        .expect(201);

      /* On fabrique une expédition minimale : ce qu'on teste ici est le
         filtrage des livreurs, pas la création d'une commande complète. */
      shipmentReference = await seedShipment();

      const response = await api()
        .get(`/api/v1/admin/logistics/shipments/${shipmentReference}/couriers`)
        .set('Cookie', adminCookies)
        .expect(200);

      const found = (response.body as { id: string; suitable: boolean }[]).find(
        (courier) => courier.id === courierId,
      );
      expect(found, 'le livreur validé et disponible doit être proposé').toBeDefined();
      expect(found?.suitable).toBe(true);
    });

    it('disparaît des propositions dès qu’il se déclare indisponible', async () => {
      await api()
        .post('/api/v1/courier/availability')
        .set('Cookie', courierCookies)
        .send({ isAvailable: false })
        .expect(201);

      const response = await api()
        .get(`/api/v1/admin/logistics/shipments/${shipmentReference}/couriers`)
        .set('Cookie', adminCookies)
        .expect(200);

      /* On vérifie l'absence de CE livreur, pas le vide de la liste : la base
         de développement contient d'autres livreurs, et un test qui suppose
         une base vierge casse au premier usage réel. */
      const ids = (response.body as { id: string }[]).map((courier) => courier.id);
      expect(ids).not.toContain(courierId);
    });
  });

  describe('4 — gains', () => {
    it('rend un solde à zéro plutôt qu’une erreur', async () => {
      const response = await api()
        .get('/api/v1/courier/earnings')
        .set('Cookie', courierCookies)
        .expect(200);

      expect(response.body).toMatchObject({
        deliveryFeesCollectedXof: 0,
        scheduledXof: 0,
        readyXof: 0,
        paidXof: 0,
        deliveredCount: 0,
      });
      expect(response.body.items).toEqual([]);
    });
  });

  // ── Utilitaires ──

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
        firstName: 'Sekou',
        lastName: 'Traore',
        acceptedTermsVersion: '2026-01',
      })
      .expect(201);
    return cookiesOf(response);
  }

  async function signUpAdmin(): Promise<string[]> {
    await signUp('CUSTOMER', ADMIN_EMAIL, ADMIN_PHONE);
    await prisma.user.update({
      where: { email: ADMIN_EMAIL },
      data: { role: 'ADMIN', status: 'ACTIVE' },
    });
    // Le rôle vit dans le jeton : il faut une session neuve.
    const response = await api()
      .post('/api/v1/auth/login')
      .send({ identifier: ADMIN_EMAIL, password: PASSWORD })
      .expect(200);
    return cookiesOf(response);
  }

  /**
   * Expédition minimale, montée directement en base.
   *
   * Passer par tout le parcours d'achat pour tester un filtre de liste
   * rendrait ce test dépendant de la tarification, du stock et du paiement —
   * il échouerait pour des raisons sans rapport avec ce qu'il vérifie.
   */
  async function seedShipment(): Promise<string> {
    /* Toujours créer la sienne. Réutiliser une expédition existante ferait
       dépendre le test des données laissées par un autre. */
    const city = await prisma.city.findFirstOrThrow();
    const customer = await prisma.user.findFirstOrThrow({ where: { email: ADMIN_EMAIL } });
    const makerUser = await prisma.user.create({
      data: {
        role: 'MAKER',
        status: 'ACTIVE',
        email: 'atelier.livreur@oja.market',
        phone: '+2250793000003',
        passwordHash: 'x',
        firstName: 'Atelier',
        lastName: 'Test',
      },
    });
    const maker = await prisma.makerProfile.create({
      data: {
        userId: makerUser.id,
        shopName: 'Atelier du test livreur',
        slug: `atelier-test-livreur-${Date.now()}`,
        cityId: city.id,
        kycStatus: 'APPROVED',
      },
    });

    const order = await prisma.order.create({
      data: {
        reference: `CMD-TEST-${Date.now()}`,
        customerId: customer.id,
        status: 'IN_DELIVERY',
        shipFullName: 'Client Test',
        shipPhone: '+2250793000009',
        shipCityId: city.id,
        shipLine1: 'Adresse de test',
        itemsMakerTotalXof: 10_000,
        commissionTotalXof: 500,
        itemsFinalTotalXof: 10_500,
        deliveryTotalXof: 2_000,
        totalXof: 12_500,
      },
    });

    const subOrder = await prisma.subOrder.create({
      data: {
        reference: `${order.reference}-A`,
        orderId: order.id,
        makerId: maker.id,
        status: 'READY_FOR_PICKUP',
        itemsMakerSubtotalXof: 10_000,
        commissionSubtotalXof: 500,
        deliveryFeeXof: 2_000,
      },
    });

    const shipment = await prisma.shipment.create({
      data: {
        reference: `LIV-TEST-${Date.now()}`,
        orderId: order.id,
        subOrderId: subOrder.id,
        status: 'TO_PICK_UP',
        // Une moto ne conviendrait pas ; la camionnette du livreur, si.
        vehicle: 'TRICYCLE',
        distanceKm: 5,
        totalWeightG: 12_000,
        totalVolumeL: 40,
        feeXof: 2_000,
        pickupLine1: 'Atelier de test',
      },
    });

    return shipment.reference;
  }

  async function cleanUp(): Promise<void> {
    const emails = [COURIER_EMAIL, ADMIN_EMAIL, 'atelier.livreur@oja.market'];
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

    await prisma.shipmentEvent.deleteMany({ where: { shipment: { orderId: { in: orderIds } } } });
    await prisma.shipment.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.subOrder.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    await prisma.kycDocument.deleteMany({ where: { courier: { userId: { in: ids } } } });
    await prisma.courierProfile.deleteMany({ where: { userId: { in: ids } } });
    await prisma.makerProfile.deleteMany({ where: { userId: { in: ids } } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: ids } } });
    await prisma.session.deleteMany({ where: { userId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
  }
});
