import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PRIVATE_MAKER_FIELDS } from '../makers/maker.mapper';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../app.module';
import { DomainErrorFilter } from '../common/domain-error.filter';
import { ProblemFilter } from '../common/problem.filter';
import { PrismaService } from '../prisma/prisma.service';
import { resetTestData } from '../test/cleanup';

/**
 * Parcours complet du catalogue, contre une vraie base : un créateur ouvre sa
 * boutique, dépose son dossier, l'administration le valide, il publie une
 * pièce, un visiteur la trouve.
 */

const MAKER_PHONE = '+2250790000001';
const MAKER_EMAIL = 'atelier.test@oja.market';
const CUSTOMER_PHONE = '+2250790000002';
const CUSTOMER_EMAIL = 'client.test@oja.market';
const ADMIN_EMAIL = 'admin.test@oja.market';
const ADMIN_PHONE = '+2250790000003';
const PASSWORD = 'un-mot-de-passe-solide';

describe('Catalogue (bout en bout)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  let makerCookies: string[];
  let customerCookies: string[];
  let adminCookies: string[];
  let makerId: string;
  let cityId: string;
  let cityName: string;
  let categoryId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    app.setGlobalPrefix('api/v1');
    app.use(cookieParser());
    app.useGlobalFilters(new ProblemFilter(), new DomainErrorFilter());
    await app.init();

    prisma = app.get(PrismaService);
    await cleanUp();

    /* Un pays précis n'est jamais codé en dur : la suite doit continuer à
       passer quel que soit le pays ouvert par le seed (cahier § 13). */
    const city = await prisma.city.findFirstOrThrow({ where: { country: { isActive: true } } });
    cityId = city.id;
    cityName = city.name;
    const category = await prisma.category.findFirstOrThrow({ where: { slug: 'mobilier' } });
    categoryId = category.id;

    makerCookies = await signUp('MAKER', MAKER_EMAIL, MAKER_PHONE);
    customerCookies = await signUp('CUSTOMER', CUSTOMER_EMAIL, CUSTOMER_PHONE);
    adminCookies = await signUpAdmin();
  }, 90_000);

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

  /** Un administrateur ne se crée pas par l'inscription : on l'élève en base. */
  async function signUpAdmin(): Promise<string[]> {
    const cookies = await signUp('CUSTOMER', ADMIN_EMAIL, ADMIN_PHONE);
    await prisma.user.update({
      where: { email: ADMIN_EMAIL },
      data: { role: 'ADMIN', status: 'ACTIVE' },
    });
    // Le rôle vit dans le jeton : il faut une session neuve pour qu'il compte.
    const response = await api()
      .post('/api/v1/auth/login')
      .send({ identifier: ADMIN_EMAIL, password: PASSWORD })
      .expect(200);
    void cookies;
    return cookiesOf(response);
  }

  const profilePayload = {
    shopName: 'Atelier Sènou',
    description: 'Menuiserie fine depuis trois générations.',
    managerName: 'Awa Koné',
    contactPhone: '+2250799887766',
    contactEmail: 'contact@ateliersenou.ci',
    postalAddress: 'Rue des Artisans, Treichville',
    ifuNumber: 'IFU-2026-001',
    rccmNumber: 'CI-ABJ-2026-B-1234',
    pickupLine1: "Atelier, 12 rue des Menuisiers",
    pickupLandmark: 'En face de la pharmacie',
  };

  const productPayload = {
    name: 'Fauteuil galbé Lagune',
    description:
      "Fauteuil sculpté à la main dans un bloc d'iroko massif, finition à l'huile de lin.",
    material: 'Iroko sculpté',
    makerPriceXof: 168_000,
    isMadeToOrder: false,
    quantityAvailable: 3,
    weightGrams: 18_000,
    lengthMm: 900,
    widthMm: 750,
    heightMm: 800,
  };

  describe('1 — ouverture de la boutique', () => {
    it('refuse la création de boutique à un client', async () => {
      // Un rôle non autorisé reçoit 404, jamais 403 : un 403 confirmerait
      // que la route existe.
      await api()
        .post('/api/v1/maker/profile')
        .set('Cookie', customerCookies)
        .send({ ...profilePayload, cityId })
        .expect(404);
    });

    it('crée la boutique du créateur', async () => {
      const response = await api()
        .post('/api/v1/maker/profile')
        .set('Cookie', makerCookies)
        .send({ ...profilePayload, cityId })
        .expect(201);

      expect(response.body.shopName).toBe('Atelier Sènou');
      expect(response.body.slug).toBe('atelier-senou');
      expect(response.body.kycStatus).toBe('NOT_SUBMITTED');
      makerId = response.body.id;
    });

    it('rend au créateur les valeurs brutes de son propre formulaire', async () => {
      /* La vue administrateur ne donne que des libellés — « Abidjan », pas
         l'identifiant — et tait l'adresse d'enlèvement : de quoi lister des
         dossiers, pas de quoi rééditer le sien. */
      const response = await api()
        .get('/api/v1/maker/profile')
        .set('Cookie', makerCookies)
        .expect(200);

      expect(response.body.cityId).toBe(cityId);
      expect(response.body.pickupLine1).toBe(profilePayload.pickupLine1);
    });

    it('refuse une seconde boutique pour le même compte', async () => {
      await api()
        .post('/api/v1/maker/profile')
        .set('Cookie', makerCookies)
        .send({ ...profilePayload, cityId })
        .expect(409);
    });
  });

  describe('2 — validation du dossier', () => {
    it('dépose le dossier', async () => {
      const response = await api()
        .post('/api/v1/maker/kyc/submit')
        .set('Cookie', makerCookies)
        .expect(201);
      expect(response.body.status).toBe('PENDING');
    });

    it('n’est pas encore visible du public', async () => {
      await api().get('/api/v1/makers/atelier-senou').expect(404);
    });

    it('exige un motif pour refuser', async () => {
      await api()
        .post(`/api/v1/admin/makers/${makerId}/review`)
        .set('Cookie', adminCookies)
        .send({ decision: 'REJECT' })
        .expect(400);
    });

    it('valide le dossier', async () => {
      const response = await api()
        .post(`/api/v1/admin/makers/${makerId}/review`)
        .set('Cookie', adminCookies)
        .send({ decision: 'APPROVE' })
        .expect(201);

      expect(response.body.kycStatus).toBe('APPROVED');
    });

    it('rend l’atelier visible, sans jamais exposer ses données privées', async () => {
      const response = await api().get('/api/v1/makers/atelier-senou').expect(200);

      expect(response.body.shopName).toBe('Atelier Sènou');
      expect(response.body.city).toBe(cityName);

      /* Règle métier du cahier client : « Le client ne voit que les
         informations publiques. » On vérifie mécaniquement qu'aucun champ
         privé ne traverse — plus fiable qu'une relecture. */
      const payload = JSON.stringify(response.body);
      for (const field of PRIVATE_MAKER_FIELDS) {
        expect(response.body).not.toHaveProperty(field);
      }
      expect(payload).not.toContain('Awa Koné');
      expect(payload).not.toContain('+2250799887766');
      expect(payload).not.toContain('IFU-2026-001');
      expect(payload).not.toContain('Treichville');
    });
  });

  describe('3 — publication d’une pièce', () => {
    let productId: string;

    it('crée une fiche en brouillon', async () => {
      const response = await api()
        .post('/api/v1/maker/products')
        .set('Cookie', makerCookies)
        .send({ ...productPayload, categoryId })
        .expect(201);

      expect(response.body.status).toBe('DRAFT');
      productId = response.body.id;
    });

    it('exige poids et dimensions — le calcul de livraison en dépend', async () => {
      const { weightGrams: _w, ...withoutWeight } = productPayload;
      const response = await api()
        .post('/api/v1/maker/products')
        .set('Cookie', makerCookies)
        .send({ ...withoutWeight, categoryId })
        .expect(400);

      expect(JSON.stringify(response.body.errors)).toContain('weightGrams');
    });

    it('rend la fiche complète au créateur, avec ce qui lui manque', async () => {
      const response = await api()
        .get(`/api/v1/maker/products/${productId}`)
        .set('Cookie', makerCookies)
        .expect(200);

      // Les valeurs brutes dont le formulaire d'édition a besoin.
      expect(response.body.categoryId).toBe(categoryId);
      expect(response.body.weightGrams).toBe(productPayload.weightGrams);
      expect(response.body.commissionBps).toBe(500);

      // Et les manques, tous à la fois plutôt qu'un par tentative d'envoi.
      expect(response.body.blockers.join(' ')).toContain('3 photos');
    });

    it('renvoie 404, jamais 403, sur la fiche d’un confrère', async () => {
      // Un 403 confirmerait l'existence de la fiche : de quoi énumérer le
      // catalogue non publié de la concurrence.
      await api()
        .get(`/api/v1/maker/products/${productId}`)
        .set('Cookie', customerCookies)
        .expect(404);
    });

    it('refuse la mise en vente sans les 3 photos du cahier client', async () => {
      const response = await api()
        .post(`/api/v1/maker/products/${productId}/submit`)
        .set('Cookie', makerCookies)
        .expect(400);

      expect(JSON.stringify(response.body.errors)).toContain('3 photos');
    });

    it('accepte le dépôt une fois les photos ajoutées', async () => {
      await prisma.productImage.createMany({
        data: [0, 1, 2].map((position) => ({
          productId,
          fileKey: `demo/photo-${position}.jpg`,
          position,
        })),
      });

      const response = await api()
        .post(`/api/v1/maker/products/${productId}/submit`)
        .set('Cookie', makerCookies)
        .expect(201);

      expect(response.body.status).toBe('PENDING_REVIEW');
    });

    it('n’apparaît pas au catalogue avant la modération', async () => {
      const response = await api().get('/api/v1/catalog/products').expect(200);
      expect(response.body.items).toHaveLength(0);
    });

    it('publie la fiche après modération', async () => {
      const pending = await api()
        .get('/api/v1/admin/catalog/products/pending')
        .set('Cookie', adminCookies)
        .expect(200);
      expect(pending.body).toHaveLength(1);

      /* La file porte de quoi décider : sans photos ni dimensions, on valide
         un nom et un prix — ce qui ne modère rien. */
      expect(pending.body[0].images).toHaveLength(3);
      expect(pending.body[0].description).toBe(productPayload.description);
      expect(pending.body[0].dimensions.weightGrams).toBe(productPayload.weightGrams);

      await api()
        .post(`/api/v1/admin/catalog/products/${productId}/review`)
        .set('Cookie', adminCookies)
        .send({ decision: 'PUBLISH' })
        .expect(201);
    });

    it("n'expose au client qu'un prix : commission Ojà comprise, sans le détail", async () => {
      const response = await api()
        .get('/api/v1/catalog/products/fauteuil-galbe-lagune')
        .expect(200);

      // 168 000 + 5 % de commission, réunis en un seul prix affiché.
      expect(response.body.finalPriceXof).toBe(176_400);
      expect(response.body.inStock).toBe(true);

      // La part créateur et la marge d'Ojà ne quittent pas le back-office.
      expect(response.body.makerPriceXof).toBeUndefined();
      expect(response.body.commissionXof).toBeUndefined();
    });

    it('renvoie une fiche modifiée en validation', async () => {
      await api()
        .patch(`/api/v1/maker/products/${productId}`)
        .set('Cookie', makerCookies)
        .send({ makerPriceXof: 150_000 })
        .expect(200);

      const product = await prisma.product.findFirstOrThrow({ where: { id: productId } });
      expect(product.status).toBe('PENDING_REVIEW');

      // Republication pour la suite des tests.
      await api()
        .post(`/api/v1/admin/catalog/products/${productId}/review`)
        .set('Cookie', adminCookies)
        .send({ decision: 'PUBLISH' })
        .expect(201);
    });

    it('empêche un créateur de toucher la fiche d’un confrère', async () => {
      const other = await signUp('MAKER', 'autre@oja.market', '+2250790000009');
      await api()
        .patch(`/api/v1/maker/products/${productId}`)
        .set('Cookie', other)
        .send({ makerPriceXof: 1 })
        .expect(404); // pas 403 : on ne confirme pas que la fiche existe

    });

    it('refuse de descendre le stock sous les pièces déjà réservées', async () => {
      await prisma.product.update({
        where: { id: productId },
        data: { quantityReserved: 2 },
      });

      const response = await api()
        .patch(`/api/v1/maker/products/${productId}/stock`)
        .set('Cookie', makerCookies)
        .send({ quantityAvailable: 1 })
        .expect(400);

      expect(response.body.detail).toContain('réservées');
      await prisma.product.update({ where: { id: productId }, data: { quantityReserved: 0 } });
    });
  });

  describe('4 — recherche et navigation', () => {
    it('trouve la pièce par son nom', async () => {
      const response = await api().get('/api/v1/catalog/products?q=fauteuil').expect(200);
      expect(response.body.items).toHaveLength(1);
      expect(response.body.items[0].name).toBe('Fauteuil galbé Lagune');
    });

    it('ignore les accents, comme le front', async () => {
      // « Sènou » et « Senou » doivent ramener la même chose, sinon les
      // résultats dépendent de la façon dont on tape.
      const response = await api().get('/api/v1/catalog/products?q=galbe').expect(200);
      expect(response.body.items).toHaveLength(1);
    });

    it('ne tombe pas sur une apostrophe ou un opérateur', async () => {
      // websearch_to_tsquery accepte ce qu'un humain tape réellement.
      await api().get("/api/v1/catalog/products?q=l'iroko \"massif\" -plastique").expect(200);
    });

    it('filtre par catégorie', async () => {
      const found = await api().get('/api/v1/catalog/products?category=mobilier').expect(200);
      expect(found.body.items).toHaveLength(1);

      const empty = await api().get('/api/v1/catalog/products?category=ceramique').expect(200);
      expect(empty.body.items).toHaveLength(0);
    });

    it('filtre par prix', async () => {
      const inRange = await api()
        .get('/api/v1/catalog/products?minPrice=100000&maxPrice=200000')
        .expect(200);
      expect(inRange.body.items).toHaveLength(1);

      const outOfRange = await api()
        .get('/api/v1/catalog/products?minPrice=500000')
        .expect(200);
      expect(outOfRange.body.items).toHaveLength(0);
    });

    it('remonte les facettes avec leurs effectifs', async () => {
      const response = await api().get('/api/v1/catalog/facets').expect(200);

      const mobilier = response.body.categories.find(
        (c: { slug: string }) => c.slug === 'mobilier',
      );
      expect(mobilier.count).toBe(1);
      expect(response.body.cities).toContainEqual({ name: cityName, count: 1 });
      expect(response.body.priceRange).toEqual({ min: 150_000, max: 150_000 });
    });

    it('donne l’arbre des catégories avec le nombre de pièces', async () => {
      const response = await api().get('/api/v1/catalog/categories').expect(200);
      expect(response.body).toHaveLength(8); // les 8 catégories du cahier client
      const mobilier = response.body.find((c: { slug: string }) => c.slug === 'mobilier');
      expect(mobilier.productCount).toBe(1);
    });

    it('retire la pièce du catalogue quand un admin la masque', async () => {
      const product = await prisma.product.findFirstOrThrow({
        where: { slug: 'fauteuil-galbe-lagune' },
      });

      await api()
        .post(`/api/v1/admin/catalog/products/${product.id}/hide`)
        .set('Cookie', adminCookies)
        .expect(204);

      const response = await api().get('/api/v1/catalog/products').expect(200);
      expect(response.body.items).toHaveLength(0);
      await api().get('/api/v1/catalog/products/fauteuil-galbe-lagune').expect(404);

      await api()
        .post(`/api/v1/admin/catalog/products/${product.id}/unhide`)
        .set('Cookie', adminCookies)
        .expect(204);
    });
  });

  describe('5 — retrait de l’agrément', () => {
    it('sort du catalogue les fiches d’un atelier refusé', async () => {
      // C'est tout l'intérêt de la validation : elle doit pouvoir se retirer.
      await api()
        .post(`/api/v1/admin/makers/${makerId}/review`)
        .set('Cookie', adminCookies)
        .send({ decision: 'REJECT', reason: 'Pièces justificatives illisibles.' })
        .expect(201);

      const response = await api().get('/api/v1/catalog/products').expect(200);
      expect(response.body.items).toHaveLength(0);
      await api().get('/api/v1/makers/atelier-senou').expect(404);
    });
  });
});

function cookiesOf(response: request.Response): string[] {
  const raw = response.headers['set-cookie'];
  if (!raw) return [];
  return Array.isArray(raw) ? raw : [raw];
}
