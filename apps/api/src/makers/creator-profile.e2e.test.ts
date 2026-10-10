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
 * Profils créatifs et formules de visibilité (cahier des évolutions, phase 1),
 * contre une vraie base : un atelier complète son profil, publie une pièce à
 * vendre et une réalisation de portfolio, atteint son quota Standard, puis
 * l'administration lui accorde le Premium.
 */

const MAKER_EMAIL = 'profil.createur@oja.market';
const MAKER_PHONE = '+2250790000101';
const ADMIN_EMAIL = 'profil.admin@oja.market';
const ADMIN_PHONE = '+2250790000102';
const PASSWORD = 'un-mot-de-passe-solide';

describe('Profils créatifs et visibilité (bout en bout)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  let makerCookies: string[];
  let adminCookies: string[];
  let makerId: string;
  let cityId: string;
  let categoryId: string;
  let standardMax: number | null;
  let premiumPlanId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    app.setGlobalPrefix('api/v1');
    app.use(cookieParser());
    app.useGlobalFilters(new ProblemFilter(), new DomainErrorFilter());
    await app.init();

    prisma = app.get(PrismaService);
    await resetTestData(prisma);

    const city = await prisma.city.findFirstOrThrow({ where: { country: { isActive: true } } });
    cityId = city.id;
    categoryId = (await prisma.category.findFirstOrThrow({ where: { slug: 'mobilier' } })).id;

    const standard = await prisma.visibilityPlan.findFirstOrThrow({ where: { isDefault: true } });
    standardMax = standard.maxPublications;
    premiumPlanId = (await prisma.visibilityPlan.findUniqueOrThrow({ where: { code: 'premium' } }))
      .id;

    makerCookies = await signUp('MAKER', MAKER_EMAIL, MAKER_PHONE);
    adminCookies = await signUpAdmin();
  }, 90_000);

  afterAll(async () => {
    if (prisma) {
      /* Les formules sont partagées par toute la base : on rend au Standard
         le quota qu'il avait avant le test. */
      await prisma.visibilityPlan.updateMany({
        where: { isDefault: true },
        data: { maxPublications: standardMax },
      });
      await resetTestData(prisma);
    }
    await app?.close();
  });

  const api = () => request(app.getHttpServer());

  async function signUp(role: string, email: string, phone: string): Promise<string[]> {
    const response = await api()
      .post('/api/v1/auth/register')
      .send({
        role,
        firstName: 'Test',
        lastName: 'Profil',
        email,
        phone,
        password: PASSWORD,
        acceptedTermsVersion: '2026-08',
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
    const response = await api()
      .post('/api/v1/auth/login')
      .send({ identifier: ADMIN_EMAIL, password: PASSWORD })
      .expect(200);
    return cookiesOf(response);
  }

  const profilePayload = {
    shopName: 'Studio Hounkpè',
    description: 'Mobilier contemporain en bois massif, dessiné et fabriqué à Cotonou.',
    managerName: 'Rachida Hounkpè',
    contactPhone: '+2250799000111',
    contactEmail: 'studio@hounkpe.bj',
    postalAddress: 'Quartier Haie Vive',
    ifuNumber: 'IFU-2026-777',
    pickupLine1: 'Atelier, rue 12.045',
    creatorKind: 'STUDIO',
    activityField: 'Mobilier',
    specialties: ['Assises', 'Tables basses', 'Assises'],
    techniques: ['Iroko', 'Tressage'],
    services: 'Pièces sur mesure et restauration.',
    region: 'Littoral',
    publicArea: 'Haie Vive',
  };

  const forSale = {
    name: 'Tabouret Lagune',
    description: 'Tabouret tripode en iroko, assise creusée à la gouge.',
    makerPriceXof: 45_000,
    quantityAvailable: 2,
    weightGrams: 4_000,
    lengthMm: 400,
    widthMm: 400,
    heightMm: 450,
  };

  const portfolio = {
    name: 'Comptoir de l’hôtel Azalaï',
    description: 'Comptoir d’accueil réalisé sur commande pour un hôtel en 2024.',
    isForSale: false,
  };

  describe('1 — profil créatif', () => {
    it('refuse un numéro de téléphone dans la présentation publique', async () => {
      const response = await api()
        .post('/api/v1/maker/profile')
        .set('Cookie', makerCookies)
        .send({ ...profilePayload, cityId, description: 'Commandes au 97 12 34 56.' })
        .expect(400);

      expect(response.body.errors[0].field).toBe('description');
    });

    it('refuse un statut inconnu', async () => {
      await api()
        .post('/api/v1/maker/profile')
        .set('Cookie', makerCookies)
        .send({ ...profilePayload, cityId, creatorKind: 'MAITRE_ARTISAN' })
        .expect(400);
    });

    it('crée le profil avec ses spécialités, sans doublon', async () => {
      const response = await api()
        .post('/api/v1/maker/profile')
        .set('Cookie', makerCookies)
        .send({ ...profilePayload, cityId })
        .expect(201);

      makerId = response.body.id;
      expect(response.body.creatorKind).toBe('STUDIO');
      expect(response.body.specialties).toEqual(['Assises', 'Tables basses']);
      expect(response.body.plan.code).toBe('standard');
    });

    it('refuse une adresse e-mail glissée dans les services', async () => {
      await api()
        .patch('/api/v1/maker/profile')
        .set('Cookie', makerCookies)
        .send({ services: 'Devis : studio@hounkpe.bj' })
        .expect(400);
    });

    it('refuse de rattacher en vitrine un fichier qui n’est pas une image de boutique', async () => {
      await api()
        .post('/api/v1/maker/profile/images')
        .set('Cookie', makerCookies)
        .send({ slot: 'logo', fileKey: 'private/kyc-document/2026-10-10/autre/x.png' })
        .expect(400);
    });

    it('expose le profil créatif au public une fois l’atelier validé', async () => {
      await api()
        .post(`/api/v1/admin/makers/${makerId}/review`)
        .set('Cookie', adminCookies)
        .send({ decision: 'APPROVE' })
        .expect(201);

      const response = await api().get('/api/v1/makers/studio-hounkpe').expect(200);
      expect(response.body).toMatchObject({
        creatorKind: 'STUDIO',
        activityField: 'Mobilier',
        region: 'Littoral',
        publicArea: 'Haie Vive',
        badge: null,
      });
      expect(JSON.stringify(response.body)).not.toContain('rue 12.045');
    });
  });

  describe('2 — réalisations et quota', () => {
    it('accepte une réalisation de portfolio sans prix ni colis', async () => {
      const response = await api()
        .post('/api/v1/maker/products')
        .set('Cookie', makerCookies)
        .send({ ...portfolio, categoryId })
        .expect(201);
      expect(response.body.isForSale).toBe(false);
    });

    it('exige toujours un prix pour une pièce à vendre', async () => {
      const { makerPriceXof: _price, ...withoutPrice } = forSale;
      const response = await api()
        .post('/api/v1/maker/products')
        .set('Cookie', makerCookies)
        .send({ ...withoutPrice, categoryId })
        .expect(400);
      expect(JSON.stringify(response.body.errors)).toContain('makerPriceXof');
    });

    it('bloque la fiche de trop au plafond de la formule Standard', async () => {
      await prisma.visibilityPlan.updateMany({
        where: { isDefault: true },
        data: { maxPublications: 2 },
      });

      await api()
        .post('/api/v1/maker/products')
        .set('Cookie', makerCookies)
        .send({ ...forSale, categoryId })
        .expect(201);

      const refused = await api()
        .post('/api/v1/maker/products')
        .set('Cookie', makerCookies)
        .send({ ...forSale, name: 'Tabouret Lagune bis', categoryId })
        .expect(400);
      expect(refused.body.detail ?? refused.body.message).toMatch(/Standard/);

      const visibility = await api()
        .get('/api/v1/maker/visibility')
        .set('Cookie', makerCookies)
        .expect(200);
      expect(visibility.body.current.code).toBe('standard');
      expect(visibility.body.activeCount).toBe(2);
    });
  });

  describe('3 — galerie publique', () => {
    it('montre portfolio et pièces vendues dans la galerie, pas au catalogue', async () => {
      await prisma.product.updateMany({
        where: { makerId },
        data: { status: 'PUBLISHED' },
      });
      await prisma.product.updateMany({
        where: { makerId, isForSale: true },
        data: { availability: 'SOLD' },
      });

      const works = await api().get('/api/v1/makers/studio-hounkpe/works').expect(200);
      const states = works.body.map((work: { availability: string }) => work.availability).sort();
      expect(states).toEqual(['PORTFOLIO', 'SOLD']);
      const shown = works.body.find((work: { availability: string }) => work.availability === 'PORTFOLIO');
      expect(shown.finalPriceXof).toBeNull();

      const catalog = await api()
        .get('/api/v1/catalog/products')
        .query({ maker: 'studio-hounkpe' })
        .expect(200);
      expect(catalog.body.items).toHaveLength(0);
    });

    it('refuse au panier une réalisation qui n’est pas à vendre', async () => {
      const piece = await prisma.product.findFirstOrThrow({ where: { makerId, isForSale: false } });
      await api().post('/api/v1/cart/items').send({ productId: piece.id, quantity: 1 }).expect(404);
    });
  });

  describe('4 — formule Premium', () => {
    it('n’est accordée que par l’administration', async () => {
      await api()
        .post(`/api/v1/admin/makers/${makerId}/subscriptions`)
        .set('Cookie', makerCookies)
        .send({ planId: premiumPlanId })
        .expect(404);
    });

    it('active le Premium, son badge et son quota', async () => {
      const history = await api()
        .post(`/api/v1/admin/makers/${makerId}/subscriptions`)
        .set('Cookie', adminCookies)
        .send({ planId: premiumPlanId, amountXof: 15_000, paymentReference: 'MOMO-TEST-1' })
        .expect(201);
      expect(history.body[0]).toMatchObject({ active: true, plan: { code: 'premium' } });

      const profile = await api().get('/api/v1/makers/studio-hounkpe').expect(200);
      expect(profile.body.badge).toEqual({ code: 'premium', name: 'Premium' });

      await api()
        .post('/api/v1/maker/products')
        .set('Cookie', makerCookies)
        .send({ ...forSale, name: 'Tabouret Lagune ter', categoryId })
        .expect(201);

      const audit = await prisma.auditLog.findFirst({
        where: { action: 'maker.subscription.grant', targetId: makerId },
      });
      expect(audit).not.toBeNull();
    });

    it('place l’atelier Premium dans l’annuaire, avec son badge', async () => {
      const response = await api()
        .get('/api/v1/makers')
        .query({ kind: 'STUDIO' })
        .expect(200);
      const card = response.body.items.find((item: { slug: string }) => item.slug === 'studio-hounkpe');
      expect(card.badge?.code).toBe('premium');
    });

    it('retire le badge à la résiliation', async () => {
      const [current] = (
        await api()
          .get(`/api/v1/admin/makers/${makerId}/subscriptions`)
          .set('Cookie', adminCookies)
          .expect(200)
      ).body;

      await api()
        .post(`/api/v1/admin/makers/${makerId}/subscriptions/${current.id}/cancel`)
        .set('Cookie', adminCookies)
        .expect(201);

      const profile = await api().get('/api/v1/makers/studio-hounkpe').expect(200);
      expect(profile.body.badge).toBeNull();
    });
  });
});

function cookiesOf(response: request.Response): string[] {
  const raw = response.headers['set-cookie'];
  if (!raw) return [];
  return Array.isArray(raw) ? raw : [raw];
}
