import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../app.module';
import { DomainErrorFilter } from '../common/domain-error.filter';
import { ProblemFilter } from '../common/problem.filter';
import { PrismaService } from '../prisma/prisma.service';
import { resetTestData } from '../test/cleanup';

/**
 * Parcours d'achat complet, contre une vraie base.
 *
 * Le scénario central est celui qui a demandé un arbitrage : **un panier qui
 * réunit deux ateliers donne deux livraisons, deux frais, deux
 * sous-commandes.** Tout le reste en découle.
 */

const A_PHONE = '+2250780000001';
const B_PHONE = '+2250780000002';
const CUSTOMER_PHONE = '+2250780000003';
const ADMIN_PHONE = '+2250780000004';
const PASSWORD = 'un-mot-de-passe-solide';

/* Deux ateliers à des distances très différentes du client : c'est ce qui
   rend visible que les frais sont calculés séparément. */
const ABIDJAN = { latitude: 5.36, longitude: -4.0083 };
const COCODY = { latitude: 5.3599, longitude: -3.9855 };
const BOUAKE = { latitude: 7.6906, longitude: -5.03 };

describe('Parcours d’achat (bout en bout)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  let customerCookies: string[];
  let adminCookies: string[];
  let addressId: string;
  let productA: { id: string; slug: string };
  let productB: { id: string; slug: string };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    app.setGlobalPrefix('api/v1');
    app.use(cookieParser());
    app.useGlobalFilters(new ProblemFilter(), new DomainErrorFilter());
    await app.init();

    prisma = app.get(PrismaService);
    await cleanUp();

    const abidjan = await prisma.city.findFirstOrThrow({ where: { country: { isActive: true } } });
    const bouake = await prisma.city.findFirstOrThrow({ where: { name: 'Bouaké' } });
    const category = await prisma.category.findFirstOrThrow({ where: { slug: 'mobilier' } });

    adminCookies = await signUpAdmin();
    customerCookies = await signUp('CUSTOMER', 'acheteur@oja.market', CUSTOMER_PHONE);

    productA = await makerWithProduct({
      email: 'atelier.a@oja.market',
      phone: A_PHONE,
      shopName: 'Atelier Proche',
      cityId: abidjan.id,
      pickup: ABIDJAN,
      categoryId: category.id,
      name: 'Tabouret bas Odienné',
      makerPriceXof: 39_000,
      weightGrams: 6_000,
      lengthMm: 400,
    });

    productB = await makerWithProduct({
      email: 'atelier.b@oja.market',
      phone: B_PHONE,
      shopName: 'Atelier Lointain',
      cityId: bouake.id,
      pickup: BOUAKE,
      categoryId: category.id,
      name: 'Buffet Korhogo',
      makerPriceXof: 220_000,
      weightGrams: 45_000,
      lengthMm: 1_600,
    });

    const address = await api()
      .post('/api/v1/me/addresses')
      .set('Cookie', customerCookies)
      .send({
        fullName: 'Awa Koné',
        phone: '+2250700000000',
        cityId: abidjan.id,
        line1: 'Rue des Jardins, Cocody',
        landmark: 'En face de la pharmacie',
        latitude: COCODY.latitude,
        longitude: COCODY.longitude,
      })
      .expect(201);
    addressId = address.body.id;
  }, 120_000);

  afterAll(async () => {
    await cleanUp();
    await app?.close();
  });

  async function cleanUp(): Promise<void> {
    if (!prisma) return;
    await resetTestData(prisma);
  }

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
    await signUp('CUSTOMER', 'admin.checkout@oja.market', ADMIN_PHONE);
    await prisma.user.update({
      where: { phone: ADMIN_PHONE },
      data: { role: 'ADMIN', status: 'ACTIVE' },
    });
    const response = await api()
      .post('/api/v1/auth/login')
      .send({ identifier: 'admin.checkout@oja.market', password: PASSWORD })
      .expect(200);
    return cookiesOf(response);
  }

  /** Crée un atelier validé avec une pièce publiée, prête à être commandée. */
  async function makerWithProduct(spec: {
    email: string;
    phone: string;
    shopName: string;
    cityId: string;
    pickup: { latitude: number; longitude: number };
    categoryId: string;
    name: string;
    makerPriceXof: number;
    weightGrams: number;
    lengthMm: number;
  }): Promise<{ id: string; slug: string }> {
    const cookies = await signUp('MAKER', spec.email, spec.phone);

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
        pickupLatitude: spec.pickup.latitude,
        pickupLongitude: spec.pickup.longitude,
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
        isMadeToOrder: false,
        quantityAvailable: 5,
        weightGrams: spec.weightGrams,
        lengthMm: spec.lengthMm,
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

    return { id: product.body.id, slug: product.body.slug };
  }

  describe('1 — panier', () => {
    it('accepte un panier de visiteur non connecté', async () => {
      // Demander un compte avant d'avoir choisi quoi que ce soit fait perdre
      // le visiteur.
      const response = await api()
        .post('/api/v1/cart/items')
        .send({ productId: productA.id, quantity: 1 })
        .expect(201);

      expect(response.body.itemCount).toBe(1);
      expect(cookiesOf(response).join(';')).toContain('oja_cart=');
    });

    it('refuse une pièce non publiée sans dire si elle existe', async () => {
      const draft = await prisma.product.findFirstOrThrow({ where: { status: 'PUBLISHED' } });
      await prisma.product.update({ where: { id: draft.id }, data: { status: 'DRAFT' } });

      await api()
        .post('/api/v1/cart/items')
        .send({ productId: draft.id, quantity: 1 })
        .expect(404);

      await prisma.product.update({ where: { id: draft.id }, data: { status: 'PUBLISHED' } });
    });

    it('groupe le panier par atelier — un groupe, une livraison', async () => {
      await api()
        .post('/api/v1/cart/items')
        .set('Cookie', customerCookies)
        .send({ productId: productA.id, quantity: 2 })
        .expect(201);

      const response = await api()
        .post('/api/v1/cart/items')
        .set('Cookie', customerCookies)
        .send({ productId: productB.id, quantity: 1 })
        .expect(201);

      expect(response.body.groups).toHaveLength(2);
      expect(response.body.itemCount).toBe(3);

      const shops = response.body.groups.map((g: { shopName: string }) => g.shopName).sort();
      expect(shops).toEqual(['Atelier Lointain', 'Atelier Proche']);
    });

    it('affiche les trois lignes de prix sur chaque ligne', async () => {
      const response = await api().get('/api/v1/cart').set('Cookie', customerCookies).expect(200);

      const proche = response.body.groups.find(
        (g: { shopName: string }) => g.shopName === 'Atelier Proche',
      );
      const line = proche.lines[0];

      // Le client ne voit qu'un prix : celui qu'il paie, commission comprise.
      expect(line.finalPriceXof).toBe(40_950); // 39 000 + 5 %
      expect(line.lineTotalXof).toBe(81_900); // × 2
      expect(line.makerPriceXof).toBeUndefined();
      expect(line.commissionXof).toBeUndefined();
    });

    it('signale une ligne dont le stock ne suit plus', async () => {
      await prisma.product.update({
        where: { id: productA.id },
        data: { quantityAvailable: 1 },
      });

      const response = await api().get('/api/v1/cart').set('Cookie', customerCookies).expect(200);
      expect(response.body.hasIssues).toBe(true);

      const issues = JSON.stringify(response.body);
      expect(issues).toContain("Il n'en reste que 1");

      await prisma.product.update({
        where: { id: productA.id },
        data: { quantityAvailable: 5 },
      });
    });
  });

  describe('2 — chiffrage', () => {
    it('calcule une livraison par atelier, aux distances réelles', async () => {
      const response = await api()
        .post('/api/v1/checkout/quote')
        .set('Cookie', customerCookies)
        .send({ addressId })
        .expect(201);

      expect(response.body.deliveries).toHaveLength(2);

      const proche = response.body.deliveries.find(
        (d: { shopName: string }) => d.shopName === 'Atelier Proche',
      );
      const lointain = response.body.deliveries.find(
        (d: { shopName: string }) => d.shopName === 'Atelier Lointain',
      );

      // Abidjan → Cocody : quelques kilomètres. Bouaké → Cocody : ~280 km.
      expect(proche.distanceKm).toBeLessThan(10);
      expect(lointain.distanceKm).toBeGreaterThan(300); // avec le facteur 1,3

      // Deux frais distincts, et le lointain coûte plus cher.
      expect(lointain.feeXof).toBeGreaterThan(proche.feeXof);
      expect(response.body.deliveryTotalXof).toBe(proche.feeXof + lointain.feeXof);
    });

    it('choisit le véhicule selon la charge, pas selon la distance seule', async () => {
      const response = await api()
        .post('/api/v1/checkout/quote')
        .set('Cookie', customerCookies)
        .send({ addressId })
        .expect(201);

      const lointain = response.body.deliveries.find(
        (d: { shopName: string }) => d.shopName === 'Atelier Lointain',
      );
      // Un buffet de 45 kg et 1,60 m ne passe pas en moto.
      expect(lointain.vehicle).not.toBe('MOTO');
    });

    it('recompose le total exactement à partir de ses parts', async () => {
      const response = await api()
        .post('/api/v1/checkout/quote')
        .set('Cookie', customerCookies)
        .send({ addressId })
        .expect(201);

      const q = response.body;
      // Le chiffrage ne renvoie plus le détail part créateur / commission.
      expect(q.itemsMakerTotalXof).toBeUndefined();
      expect(q.commissionTotalXof).toBeUndefined();
      expect(q.totalXof).toBe(q.itemsFinalTotalXof + q.deliveryTotalXof + q.vatXof);
      expect(q.vatXof).toBe(0); // en sommeil tant que la décision fiscale n'est pas prise
      expect(q.blockers).toEqual([]);
    });

    it('refuse l’adresse d’un autre client', async () => {
      const other = await signUp('CUSTOMER', 'autre.client@oja.market', '+2250780000009');
      await api()
        .post('/api/v1/checkout/quote')
        .set('Cookie', other)
        .send({ addressId })
        .expect(404); // pas 403

    });
  });

  describe('3 — passage de commande', () => {
    let placed: { reference: string; totalXof: number };

    it('refuse un total qui ne correspond plus à l’affichage', async () => {
      // Le client confirme un montant, il ne le fixe pas.
      await api()
        .post('/api/v1/checkout')
        .set('Cookie', customerCookies)
        .send({ addressId, expectedTotalXof: 1_000 })
        .expect(409);
    });

    it('crée la commande, éclatée en deux sous-commandes', async () => {
      const quote = await api()
        .post('/api/v1/checkout/quote')
        .set('Cookie', customerCookies)
        .send({ addressId })
        .expect(201);

      const response = await api()
        .post('/api/v1/checkout')
        .set('Cookie', customerCookies)
        .send({ addressId, expectedTotalXof: quote.body.totalXof })
        .expect(201);

      const order = response.body;
      placed = { reference: order.reference, totalXof: order.totalXof };

      expect(order.reference).toMatch(/^CMD-\d{4}-\d{6}$/);
      expect(order.status).toBe('PENDING_PAYMENT');
      expect(order.statusLabel).toBe('En attente de paiement');

      // Un atelier, une sous-commande, une livraison.
      expect(order.subOrders).toHaveLength(2);
      expect(order.subOrders[0].reference).toBe(`${order.reference}-A`);
      expect(order.subOrders[1].reference).toBe(`${order.reference}-B`);
      expect(order.subOrders.every((s: { deliveryFeeXof: number }) => s.deliveryFeeXof > 0)).toBe(
        true,
      );

      // Les frais de livraison des sous-commandes recomposent le total.
      const sumFees = order.subOrders.reduce(
        (total: number, s: { deliveryFeeXof: number }) => total + s.deliveryFeeXof,
        0,
      );
      expect(sumFees).toBe(order.deliveryTotalXof);
    });

    it('fige l’adresse : la modifier ensuite ne change pas la commande', async () => {
      await api()
        .patch(`/api/v1/me/addresses/${addressId}`)
        .set('Cookie', customerCookies)
        .send({ line1: 'Une toute autre adresse' })
        .expect(200);

      const response = await api()
        .get(`/api/v1/orders/${placed.reference}`)
        .set('Cookie', customerCookies)
        .expect(200);

      expect(response.body.shipLine1).toBe('Rue des Jardins, Cocody');
      expect(response.body.shipLandmark).toBe('En face de la pharmacie');
    });

    it('fige les prix : les changer ensuite ne change pas la commande', async () => {
      const order = await prisma.order.findFirstOrThrow({
        where: { reference: placed.reference },
        include: { subOrders: { include: { lines: true } } },
      });

      const line = order.subOrders
        .flatMap((s) => s.lines)
        .find((l) => l.productName === 'Tabouret bas Odienné');

      expect(line?.makerPriceXof).toBe(39_000);
      expect(line?.commissionBps).toBe(500);
      expect(line?.finalPriceXof).toBe(40_950);
    });

    it('réserve le stock avant tout paiement', async () => {
      const product = await prisma.product.findUniqueOrThrow({ where: { id: productA.id } });
      // Deux tabourets commandés : ils ne doivent plus être vendables.
      expect(product.quantityReserved).toBe(2);
    });

    it('vide le panier', async () => {
      const response = await api().get('/api/v1/cart').set('Cookie', customerCookies).expect(200);
      expect(response.body.itemCount).toBe(0);
    });

    it('numérote sans trou', async () => {
      await api()
        .post('/api/v1/cart/items')
        .set('Cookie', customerCookies)
        .send({ productId: productA.id, quantity: 1 })
        .expect(201);

      const quote = await api()
        .post('/api/v1/checkout/quote')
        .set('Cookie', customerCookies)
        .send({ addressId })
        .expect(201);

      const second = await api()
        .post('/api/v1/checkout')
        .set('Cookie', customerCookies)
        .send({ addressId, expectedTotalXof: quote.body.totalXof })
        .expect(201);

      const first = Number(placed.reference.split('-')[2]);
      const next = Number(second.body.reference.split('-')[2]);
      expect(next).toBe(first + 1);
    });

    it('ne crée qu’une commande quand la même requête arrive deux fois', async () => {
      await api()
        .post('/api/v1/cart/items')
        .set('Cookie', customerCookies)
        .send({ productId: productA.id, quantity: 1 })
        .expect(201);
      const quote = await api()
        .post('/api/v1/checkout/quote')
        .set('Cookie', customerCookies)
        .send({ addressId })
        .expect(201);
      const body = { addressId, expectedTotalXof: quote.body.totalXof };
      const key = 'e2e-double-clic-0001';
      const mine = { customer: { email: 'acheteur@oja.market' } };
      const before = await prisma.order.count({ where: mine });
      const placeWithKey = () =>
        api()
          .post('/api/v1/checkout')
          .set('Cookie', customerCookies)
          .set('Idempotency-Key', key)
          .send(body);

      // Double clic : deux requêtes simultanées, même clé. L'une crée, l'autre
      // rejoue sa réponse ou attend son tour (409) — jamais deux créations.
      const [a, b] = await Promise.all([placeWithKey(), placeWithKey()]);
      expect([
        [201, 201],
        [201, 409],
      ]).toContainEqual([a.status, b.status].sort());

      // Réponse perdue, le client réessaie : la même commande revient.
      const retry = await placeWithKey().expect(201);
      expect(retry.headers['idempotent-replayed']).toBe('true');
      const created = [a, b].find((r) => r.status === 201)!;
      expect(retry.body.reference).toBe(created.body.reference);
      expect(await prisma.order.count({ where: mine })).toBe(before + 1);

      // La même clé ne peut pas servir à une autre commande.
      await api()
        .post('/api/v1/checkout')
        .set('Cookie', customerCookies)
        .set('Idempotency-Key', key)
        .send({ ...body, expectedTotalXof: body.expectedTotalXof + 1 })
        .expect(422);
    });

    it('ne montre pas la commande d’un autre client', async () => {
      const other = await signUp('CUSTOMER', 'curieux@oja.market', '+2250780000008');
      await api()
        .get(`/api/v1/orders/${placed.reference}`)
        .set('Cookie', other)
        .expect(404); // pas 403

    });
  });

  describe('4 — panier anonyme fusionné à la connexion', () => {
    it('additionne les quantités plutôt que de les écraser', async () => {
      const anonymous = await api()
        .post('/api/v1/cart/items')
        .send({ productId: productA.id, quantity: 2 })
        .expect(201);

      const cartCookie = cookiesOf(anonymous)
        .find((c) => c.startsWith('oja_cart='))
        ?.split(';')[0];
      expect(cartCookie).toBeDefined();

      const token = cartCookie!.split('=')[1]!;
      const user = await prisma.user.findFirstOrThrow({ where: { phone: CUSTOMER_PHONE } });

      const { CartService } = await import('../cart/cart.service');
      const carts = app.get(CartService);

      // Le client avait déjà une pièce en attente dans son panier connecté.
      const { id } = await carts.resolve(user.id, null);
      await prisma.cartItem.deleteMany({ where: { cartId: id } });
      await prisma.cartItem.create({
        data: { cartId: id, productId: productA.id, quantity: 1 },
      });

      await carts.merge(user.id, token);

      const merged = await carts.view(id);
      // 1 déjà présent + 2 anonymes = 3, et non 2.
      expect(merged.groups[0]?.lines[0]?.quantity).toBe(3);
    });
  });

  describe('5 — avis clients', () => {
    it('n’ouvre l’avis qu’après la réception validée, une fois, et le publie après modération', async () => {
      // La première commande du client, passée plus haut dans ce fichier.
      const orders = await api().get('/api/v1/orders').set('Cookie', customerCookies).expect(200);
      const reference: string = orders.body.items.at(-1).reference;
      const order = await api()
        .get(`/api/v1/orders/${reference}`)
        .set('Cookie', customerCookies)
        .expect(200);
      const subOrder = order.body.subOrders[0];
      const line = subOrder.lines[0];
      expect(line).toMatchObject({ canReview: false, review: null });

      // Pas encore reçue : on ne note pas une pièce qu'on n'a pas eue en main.
      await api()
        .post(`/api/v1/order-lines/${line.id}/review`)
        .set('Cookie', customerCookies)
        .send({ rating: 4 })
        .expect(400);

      await prisma.subOrder.update({
        where: { reference: subOrder.reference },
        data: { status: 'VALIDATED' },
      });
      const validated = await api()
        .get(`/api/v1/orders/${reference}`)
        .set('Cookie', customerCookies)
        .expect(200);
      expect(validated.body.subOrders[0].lines[0].canReview).toBe(true);

      // La ligne d'un autre client n'existe pas pour lui.
      const stranger = await signUp('CUSTOMER', 'avis.autre@oja.market', '+2250780000031');
      await api()
        .post(`/api/v1/order-lines/${line.id}/review`)
        .set('Cookie', stranger)
        .send({ rating: 1 })
        .expect(404);

      const created = await api()
        .post(`/api/v1/order-lines/${line.id}/review`)
        .set('Cookie', customerCookies)
        .send({ rating: 4, body: '  Belle finition, livrée à temps.  ' })
        .expect(201);
      expect(created.body).toEqual({ rating: 4, status: 'PENDING', rejectReason: null });

      // Un seul avis par ligne.
      await api()
        .post(`/api/v1/order-lines/${line.id}/review`)
        .set('Cookie', customerCookies)
        .send({ rating: 5 })
        .expect(409);

      // En modération : rien de public encore.
      const before = await api()
        .get(`/api/v1/catalog/products/${line.productSlug}/reviews`)
        .expect(200);
      expect(before.body.items).toHaveLength(0);

      const queue = await api().get('/api/v1/admin/reviews').set('Cookie', adminCookies).expect(200);
      const pending = queue.body.find(
        (review: { body: string }) => review.body === 'Belle finition, livrée à temps.',
      );
      expect(pending).toMatchObject({ rating: 4, status: 'PENDING', authorName: 'Test U.' });

      // Un refus exige son motif : il est montré à l'auteur.
      await api()
        .post(`/api/v1/admin/reviews/${pending.id}/moderate`)
        .set('Cookie', adminCookies)
        .send({ decision: 'REJECT' })
        .expect(400);
      await api()
        .post(`/api/v1/admin/reviews/${pending.id}/moderate`)
        .set('Cookie', adminCookies)
        .send({ decision: 'PUBLISH' })
        .expect(200);

      const after = await api()
        .get(`/api/v1/catalog/products/${line.productSlug}/reviews`)
        .expect(200);
      expect(after.body).toMatchObject({ ratingAvg: 4, ratingCount: 1 });
      expect(after.body.items[0]).toMatchObject({ rating: 4, authorName: 'Test U.' });

      // La note de l'atelier suit celle de ses pièces.
      const product = await prisma.product.findUniqueOrThrow({
        where: { slug: line.productSlug },
        include: { maker: true },
      });
      expect(product.maker).toMatchObject({ ratingAvg: 4, ratingCount: 1 });

      // Retirer l'avis remet les moyennes à zéro, sans dérive.
      await api()
        .post(`/api/v1/admin/reviews/${pending.id}/moderate`)
        .set('Cookie', adminCookies)
        .send({ decision: 'REJECT', reason: 'Hors sujet' })
        .expect(200);
      const withdrawn = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
      expect(withdrawn).toMatchObject({ ratingAvg: 0, ratingCount: 0 });

      const mine = await api()
        .get(`/api/v1/orders/${reference}`)
        .set('Cookie', customerCookies)
        .expect(200);
      expect(mine.body.subOrders[0].lines[0]).toMatchObject({
        canReview: false,
        review: { rating: 4, status: 'REJECTED', rejectReason: 'Hors sujet' },
      });
    });
  });
});

function cookiesOf(response: request.Response): string[] {
  const raw = response.headers['set-cookie'];
  if (!raw) return [];
  return Array.isArray(raw) ? raw : [raw];
}
