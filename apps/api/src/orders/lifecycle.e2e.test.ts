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
 * Cycle de vie complet d'une commande, encaissement compris — avec le
 * fournisseur de paiement **simulé**.
 *
 * C'est la démonstration que le parcours entier tient sans agrégateur : le
 * même chemin de code, les mêmes contrôles, les mêmes écritures comptables.
 * Brancher Kadev Pay au dernier lot ne changera que l'implémentation du
 * fournisseur.
 */

const STOCK_MAKER = '+2250770000001';
const CRAFT_MAKER = '+2250770000002';
const CUSTOMER = '+2250770000003';
const ADMIN = '+2250770000004';
const PASSWORD = 'un-mot-de-passe-solide';

const ABIDJAN = { latitude: 5.36, longitude: -4.0083 };
const COCODY = { latitude: 5.3599, longitude: -3.9855 };

describe('Cycle de vie d’une commande (bout en bout)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ledger: LedgerService;

  let customerCookies: string[];
  let adminCookies: string[];
  let stockCookies: string[];
  let craftCookies: string[];
  let addressId: string;
  let stockProductId: string;
  let craftProductId: string;
  let stockMakerUserId: string;

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
    customerCookies = await signUp('CUSTOMER', 'client.cycle@oja.market', CUSTOMER);

    const stock = await makerWithProduct({
      email: 'atelier.stock@oja.market',
      phone: STOCK_MAKER,
      shopName: 'Atelier Stock',
      cityId: abidjan.id,
      categoryId: category.id,
      name: 'Tabouret en stock',
      makerPriceXof: 40_000,
      isMadeToOrder: false,
    });
    stockCookies = stock.cookies;
    stockProductId = stock.productId;
    stockMakerUserId = stock.userId;

    const craft = await makerWithProduct({
      email: 'atelier.craft@oja.market',
      phone: CRAFT_MAKER,
      shopName: 'Atelier Sur Commande',
      cityId: abidjan.id,
      categoryId: category.id,
      name: 'Buffet sur mesure',
      makerPriceXof: 200_000,
      isMadeToOrder: true,
      leadTimeDays: 21,
    });
    craftCookies = craft.cookies;
    craftProductId = craft.productId;

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
    await signUp('CUSTOMER', 'admin.cycle@oja.market', ADMIN);
    await prisma.user.update({
      where: { phone: ADMIN },
      data: { role: 'ADMIN', status: 'ACTIVE' },
    });
    const response = await api()
      .post('/api/v1/auth/login')
      .send({ identifier: 'admin.cycle@oja.market', password: PASSWORD })
      .expect(200);
    return cookiesOf(response);
  }

  async function makerWithProduct(spec: {
    email: string;
    phone: string;
    shopName: string;
    cityId: string;
    categoryId: string;
    name: string;
    makerPriceXof: number;
    isMadeToOrder: boolean;
    leadTimeDays?: number;
  }): Promise<{ cookies: string[]; productId: string; userId: string }> {
    const cookies = await signUp('MAKER', spec.email, spec.phone);
    const user = await prisma.user.findFirstOrThrow({ where: { phone: spec.phone } });

    const profile = await api()
      .post('/api/v1/maker/profile')
      .set('Cookie', cookies)
      .send({
        shopName: spec.shopName,
        cityId: spec.cityId,
        managerName: 'Responsable',
        contactPhone: '+2250799887766',
        contactEmail: spec.email,
        postalAddress: 'Adresse postale',
        ifuNumber: 'IFU-TEST',
        pickupLine1: "Adresse de l'atelier",
        pickupLatitude: ABIDJAN.latitude,
        pickupLongitude: ABIDJAN.longitude,
      })
      .expect(201);

    await api().post('/api/v1/maker/kyc/submit').set('Cookie', cookies).expect(201);
    await api()
      .post(`/api/v1/admin/makers/${profile.body.id}/review`)
      .set('Cookie', adminCookies)
      .send({ decision: 'APPROVE' })
      .expect(201);

    const product = await api()
      .post('/api/v1/maker/products')
      .set('Cookie', cookies)
      .send({
        name: spec.name,
        categoryId: spec.categoryId,
        description: 'Pièce façonnée à la main dans un atelier partenaire d’Ojà.',
        makerPriceXof: spec.makerPriceXof,
        isMadeToOrder: spec.isMadeToOrder,
        quantityAvailable: spec.isMadeToOrder ? 0 : 10,
        ...(spec.leadTimeDays ? { leadTimeDays: spec.leadTimeDays } : {}),
        weightGrams: 8_000,
        lengthMm: 500,
        widthMm: 400,
        heightMm: 450,
      })
      .expect(201);

    await prisma.productImage.createMany({
      data: [0, 1, 2].map((position) => ({
        productId: product.body.id,
        fileKey: `demo/${position}.jpg`,
        position,
      })),
    });
    await api()
      .post(`/api/v1/maker/products/${product.body.id}/submit`)
      .set('Cookie', cookies)
      .expect(201);
    await api()
      .post(`/api/v1/admin/catalog/products/${product.body.id}/review`)
      .set('Cookie', adminCookies)
      .send({ decision: 'PUBLISH' })
      .expect(201);

    return { cookies, productId: product.body.id, userId: user.id };
  }

  async function placeOrder(items: { productId: string; quantity: number }[]): Promise<string> {
    await api().delete('/api/v1/cart').set('Cookie', customerCookies).expect(204);

    for (const item of items) {
      await api().post('/api/v1/cart/items').set('Cookie', customerCookies).send(item).expect(201);
    }

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

    return order.body.reference;
  }

  describe('1 — encaissement simulé', () => {
    let reference: string;

    it('laisse la commande en attente de paiement', async () => {
      reference = await placeOrder([
        { productId: stockProductId, quantity: 1 },
        { productId: craftProductId, quantity: 1 },
      ]);

      const order = await api()
        .get(`/api/v1/orders/${reference}`)
        .set('Cookie', customerCookies)
        .expect(200);

      expect(order.body.status).toBe('PENDING_PAYMENT');
      expect(order.body.subOrders).toHaveLength(2);
      expect(order.body.subOrders.every((s: { status: string }) => s.status === 'RECEIVED')).toBe(
        true,
      );
    });

    it('confirme la commande à l’encaissement', async () => {
      await api()
        .post(`/api/v1/admin/payments/simulate/${reference}`)
        .set('Cookie', adminCookies)
        .expect(201);

      const order = await api()
        .get(`/api/v1/orders/${reference}`)
        .set('Cookie', customerCookies)
        .expect(200);

      expect(order.body.status).toBe('CONFIRMED');
      expect(order.body.statusLabel).toBe('Commande confirmée');
      expect(
        order.body.subOrders.every((s: { status: string }) => s.status === 'PAYMENT_CONFIRMED'),
      ).toBe(true);
    });

    it('transforme la réservation en sortie de stock', async () => {
      const product = await prisma.product.findUniqueOrThrow({ where: { id: stockProductId } });
      expect(product.quantityAvailable).toBe(9); // 10 − 1 vendu
      expect(product.quantityReserved).toBe(0); // la réservation est consommée
    });

    it('écrit une transaction équilibrée au grand livre', async () => {
      const order = await prisma.order.findFirstOrThrow({ where: { reference } });

      const transactions = await prisma.ledgerTransaction.findMany({
        where: { refType: 'order', refId: order.id },
        include: { entries: true },
      });
      expect(transactions).toHaveLength(1);

      const sum = transactions[0]!.entries.reduce((total, e) => total + e.amountXof, 0);
      expect(sum).toBe(0);

      // La caisse reçoit exactement ce que le client a payé.
      const cash = transactions[0]!.entries.find((e) => e.amountXof > 0);
      expect(cash?.amountXof).toBe(order.totalXof);
    });

    it('doit au créateur son prix, en entier', async () => {
      // La commission s'ajoute au prix du créateur : il touche ce qu'il a fixé.
      const balance = await ledger.balanceOf('MAKER_PAYABLE', stockMakerUserId);
      expect(balance).toBe(-40_000); // crédit = dette envers lui
    });

    it('impute les frais d’agrégateur à Ojà, jamais au créateur', async () => {
      const order = await prisma.order.findFirstOrThrow({ where: { reference } });
      const payment = await prisma.payment.findFirstOrThrow({ where: { orderId: order.id } });

      /* On lit l'écriture de CETTE commande, pas le solde du compte : `PSP_FEE`
         est un compte de plateforme, il cumule toutes les commandes. */
      const transaction = await prisma.ledgerTransaction.findFirstOrThrow({
        where: { kind: 'psp_fee', refType: 'payment', refId: payment.id },
        include: { entries: { include: { account: true } } },
      });

      const fee = transaction.entries.find((e) => e.account.type === 'PSP_FEE');
      // 2,3 % du total encaissé, arrondi à l'inférieur.
      expect(fee?.amountXof).toBe(Math.floor((order.totalXof * 230) / 10_000));

      // Les frais sortent de la caisse d'Ojà : la dette du créateur est intacte.
      const cash = transaction.entries.find((e) => e.account.type === 'PLATFORM_CASH');
      expect(cash?.amountXof).toBe(-(fee?.amountXof ?? 0));
    });

    it('rejoue une confirmation sans rien réécrire', async () => {
      const before = await prisma.ledgerEntry.count();
      await api()
        .post(`/api/v1/admin/payments/simulate/${reference}`)
        .set('Cookie', adminCookies)
        .expect(404); // plus aucun paiement en attente
      expect(await prisma.ledgerEntry.count()).toBe(before);
    });

    it('respecte les invariants du grand livre', async () => {
      const result = await ledger.checkInvariants();
      expect(result.problems).toEqual([]);
      expect(result.ok).toBe(true);
    });
  });

  describe('2 — l’atelier prend la main', () => {
    let reference: string;

    beforeAll(async () => {
      reference = await placeOrder([{ productId: craftProductId, quantity: 1 }]);
      await api()
        .post(`/api/v1/admin/payments/simulate/${reference}`)
        .set('Cookie', adminCookies)
        .expect(201);
    });

    it('montre au créateur ce qu’il touchera, pas ce que le client a payé', async () => {
      const response = await api()
        .get('/api/v1/maker/orders')
        .set('Cookie', craftCookies)
        .expect(200);

      const current = response.body.find(
        (s: { orderReference: string }) => s.orderReference === reference,
      );
      expect(current.itemsMakerSubtotalXof).toBe(200_000);
      expect(current.statusLabel).toBe('Paiement confirmé');
      expect(current.respondByAt).not.toBeNull();
    });

    it('ouvre le compte à rebours du délai annoncé à l’acceptation', async () => {
      const subOrder = `${reference}-A`;
      const response = await api()
        .post(`/api/v1/maker/orders/${subOrder}/accept`)
        .set('Cookie', craftCookies)
        .expect(201);

      // Le délai vient de la fiche produit : 21 jours annoncés, 21 jours comptés.
      expect(response.body.status).toBe('IN_PRODUCTION');
      const due = new Date(response.body.dueReadyAt);
      const days = Math.round((due.getTime() - Date.now()) / 86_400_000);
      expect(days).toBe(21);
    });

    it('fait suivre le statut de la commande côté client', async () => {
      const order = await api()
        .get(`/api/v1/orders/${reference}`)
        .set('Cookie', customerCookies)
        .expect(200);
      expect(order.body.status).toBe('IN_PRODUCTION');
      expect(order.body.statusLabel).toBe('En fabrication');
    });

    it('interdit de déclarer prêt ce qui n’a pas été accepté', async () => {
      // Transition gardée : on ne saute pas d'étape. 409, pas 500 — l'atelier
      // doit lire ce qui lui est possible de faire.
      const other = await placeOrder([{ productId: craftProductId, quantity: 1 }]);
      const refus = await api()
        .post(`/api/v1/maker/orders/${other}-A/ready`)
        .set('Cookie', craftCookies)
        .expect(409);
      expect(refus.body.detail).toContain('transition interdite');

      await api()
        .post(`/api/v1/admin/payments/simulate/${other}`)
        .set('Cookie', adminCookies)
        .expect(201);
    });

    it('passe en préparation quand tout est prêt', async () => {
      await api()
        .post(`/api/v1/maker/orders/${reference}-A/ready`)
        .set('Cookie', craftCookies)
        .expect(201);

      const order = await api()
        .get(`/api/v1/orders/${reference}`)
        .set('Cookie', customerCookies)
        .expect(200);
      expect(order.body.status).toBe('PREPARING');
      expect(order.body.statusLabel).toBe('En préparation');
    });

    it('empêche un créateur de toucher la commande d’un confrère', async () => {
      await api()
        .post(`/api/v1/maker/orders/${reference}-A/accept`)
        .set('Cookie', stockCookies)
        .expect(404); // pas 403
    });
  });

  describe('3 — une pièce en stock ne passe pas par la fabrication', () => {
    it('devient prête à récupérer dès l’acceptation', async () => {
      const reference = await placeOrder([{ productId: stockProductId, quantity: 1 }]);
      await api()
        .post(`/api/v1/admin/payments/simulate/${reference}`)
        .set('Cookie', adminCookies)
        .expect(201);

      const response = await api()
        .post(`/api/v1/maker/orders/${reference}-A/accept`)
        .set('Cookie', stockCookies)
        .expect(201);

      // Faire cliquer deux fois l'atelier pour un tabouret posé sur son
      // étagère n'a aucun sens.
      expect(response.body.status).toBe('READY_FOR_PICKUP');
      expect(response.body.dueReadyAt).toBeNull();
    });
  });

  describe('4 — refus d’un atelier', () => {
    let reference: string;

    beforeAll(async () => {
      reference = await placeOrder([
        { productId: stockProductId, quantity: 2 },
        { productId: craftProductId, quantity: 1 },
      ]);
      await api()
        .post(`/api/v1/admin/payments/simulate/${reference}`)
        .set('Cookie', adminCookies)
        .expect(201);
    });

    it('exige un motif', async () => {
      await api()
        .post(`/api/v1/maker/orders/${reference}-A/reject`)
        .set('Cookie', stockCookies)
        .send({ reason: '' })
        .expect(400);
    });

    it('rend le stock et éteint la dette', async () => {
      const before = await prisma.product.findUniqueOrThrow({ where: { id: stockProductId } });
      const owed = await ledger.balanceOf('MAKER_PAYABLE', stockMakerUserId);

      await api()
        .post(`/api/v1/maker/orders/${reference}-A/reject`)
        .set('Cookie', stockCookies)
        .send({ reason: 'Rupture de matière première.' })
        .expect(201);

      const after = await prisma.product.findUniqueOrThrow({ where: { id: stockProductId } });
      expect(after.quantityAvailable).toBe(before.quantityAvailable + 2);

      // La dette diminue de ce qui n'est plus dû.
      const owedAfter = await ledger.balanceOf('MAKER_PAYABLE', stockMakerUserId);
      expect(owedAfter).toBe(owed + 80_000);
    });

    it('laisse les autres ateliers continuer', async () => {
      // Un refus n'annule pas ce que les autres ont accepté.
      const order = await api()
        .get(`/api/v1/orders/${reference}`)
        .set('Cookie', customerCookies)
        .expect(200);
      expect(order.body.status).not.toBe('CANCELLED');
    });

    it('annule la commande quand plus aucun atelier ne suit', async () => {
      await api()
        .post(`/api/v1/maker/orders/${reference}-B/reject`)
        .set('Cookie', craftCookies)
        .send({ reason: 'Atelier fermé pour la saison.' })
        .expect(201);

      const order = await api()
        .get(`/api/v1/orders/${reference}`)
        .set('Cookie', customerCookies)
        .expect(200);
      expect(order.body.status).toBe('CANCELLED');
    });

    it('garde le grand livre équilibré après annulations', async () => {
      const result = await ledger.checkInvariants();
      expect(result.problems).toEqual([]);
    });
  });

  describe('5 — le silence vaut refus', () => {
    it('refuse automatiquement une sous-commande restée sans réponse', async () => {
      const reference = await placeOrder([{ productId: stockProductId, quantity: 1 }]);
      await api()
        .post(`/api/v1/admin/payments/simulate/${reference}`)
        .set('Cookie', adminCookies)
        .expect(201);

      // On fait comme si les 48 heures étaient écoulées.
      await prisma.subOrder.updateMany({
        where: { reference: `${reference}-A` },
        data: { respondByAt: new Date(Date.now() - 1_000) },
      });

      const response = await api()
        .post('/api/v1/admin/orders/expire-unanswered')
        .set('Cookie', adminCookies)
        .expect(201);
      expect(response.body.rejected).toBeGreaterThanOrEqual(1);

      const order = await api()
        .get(`/api/v1/orders/${reference}`)
        .set('Cookie', customerCookies)
        .expect(200);
      // Sans cette règle, la commande resterait bloquée indéfiniment sur un
      // atelier injoignable, l'argent du client immobilisé.
      expect(order.body.status).toBe('CANCELLED');
    });
  });

  describe('6 — expiration du paiement', () => {
    it('relâche le stock d’une commande jamais payée', async () => {
      const before = await prisma.product.findUniqueOrThrow({ where: { id: stockProductId } });
      const reference = await placeOrder([{ productId: stockProductId, quantity: 2 }]);

      const reserved = await prisma.product.findUniqueOrThrow({ where: { id: stockProductId } });
      expect(reserved.quantityReserved).toBe(2);

      await prisma.payment.updateMany({
        where: { order: { reference } },
        data: { expiresAt: new Date(Date.now() - 1_000) },
      });

      await api()
        .post('/api/v1/admin/payments/expire-stale')
        .set('Cookie', adminCookies)
        .expect(201);

      const after = await prisma.product.findUniqueOrThrow({ where: { id: stockProductId } });
      // Une pièce unique ne doit pas rester invendable après un abandon.
      expect(after.quantityReserved).toBe(0);
      expect(after.quantityAvailable).toBe(before.quantityAvailable);
    });
  });
});

function cookiesOf(response: request.Response): string[] {
  const raw = response.headers['set-cookie'];
  if (!raw) return [];
  return Array.isArray(raw) ? raw : [raw];
}
