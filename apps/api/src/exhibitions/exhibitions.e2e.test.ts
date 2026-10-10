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
 * Expositions (cahier des évolutions, phase 3), contre une vraie base : un
 * créateur monte son dossier, l'administration l'instruit, le contrat est
 * signé, l'exposition est programmée puis visible du public. Un organisateur
 * externe, lui, expose sans pouvoir vendre.
 */

const MAKER_EMAIL = 'expo.createur@oja.market';
const MAKER_PHONE = '+2250790000301';
const OUTSIDER_EMAIL = 'expo.externe@oja.market';
const OUTSIDER_PHONE = '+2250790000302';
const ADMIN_EMAIL = 'expo.admin@oja.market';
const ADMIN_PHONE = '+2250790000303';
const PASSWORD = 'un-mot-de-passe-solide';

describe('Expositions (bout en bout)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let makerCookies: string[];
  let outsiderCookies: string[];
  let adminCookies: string[];
  let cityId: string;
  let standardPlanId: string;
  let productId: string;
  let exhibitionId: string;
  let slug: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    app.setGlobalPrefix('api/v1');
    app.use(cookieParser());
    app.useGlobalFilters(new ProblemFilter(), new DomainErrorFilter());
    await app.init();

    prisma = app.get(PrismaService);
    await resetTestData(prisma);
    cityId = (await prisma.city.findFirstOrThrow({ where: { country: { isActive: true } } })).id;
    standardPlanId = (await prisma.exhibitionPlan.findUniqueOrThrow({ where: { code: 'standard' } })).id;

    makerCookies = await signUp('MAKER', MAKER_EMAIL, MAKER_PHONE);
    outsiderCookies = await signUp('CUSTOMER', OUTSIDER_EMAIL, OUTSIDER_PHONE);
    await signUp('CUSTOMER', ADMIN_EMAIL, ADMIN_PHONE);
    await prisma.user.update({ where: { email: ADMIN_EMAIL }, data: { role: 'ADMIN', status: 'ACTIVE' } });
    adminCookies = cookiesOf(
      await api().post('/api/v1/auth/login').send({ identifier: ADMIN_EMAIL, password: PASSWORD }).expect(200),
    );

    /* Un atelier validé, avec une pièce publiée : c'est elle qui sera vendue
       pendant l'exposition. */
    const maker = await prisma.makerProfile.create({
      data: {
        user: { connect: { email: MAKER_EMAIL } },
        shopName: 'Atelier Terres du Sud',
        slug: 'atelier-terres-du-sud',
        city: { connect: { id: cityId } },
        kycStatus: 'APPROVED',
      },
    });
    const category = await prisma.category.findFirstOrThrow({ where: { slug: 'mobilier' } });
    productId = (
      await prisma.product.create({
        data: {
          makerId: maker.id,
          categoryId: category.id,
          slug: 'jarre-terre-cuite-expo',
          name: 'Jarre en terre cuite',
          description: 'Jarre tournée à la main et cuite au bois.',
          makerPriceXof: 80_000,
          quantityAvailable: 1,
          weightGrams: 6_000,
          lengthMm: 400,
          widthMm: 400,
          heightMm: 600,
          status: 'PUBLISHED',
        },
      })
    ).id;
  }, 90_000);

  afterAll(async () => {
    if (prisma) await resetTestData(prisma);
    await app?.close();
  });

  const api = () => request(app.getHttpServer());

  async function signUp(role: string, email: string, phone: string): Promise<string[]> {
    return cookiesOf(
      await api()
        .post('/api/v1/auth/register')
        .send({
          role,
          firstName: 'Test',
          lastName: 'Expo',
          email,
          phone,
          password: PASSWORD,
          acceptedTermsVersion: '2026-08',
        })
        .expect(201),
    );
  }

  const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();

  const dossier = {
    title: 'Terres du Sud',
    organizerName: 'Atelier Terres du Sud',
    summary: 'Céramiques contemporaines du sud du Bénin, entre tradition du tour et formes nouvelles.',
    cityId,
    format: 'ONLINE',
  };

  describe('1 — dossier de l’organisateur', () => {
    it('crée le dossier en brouillon, avec ce qui manque pour le soumettre', async () => {
      const response = await api()
        .post('/api/v1/my/exhibitions')
        .set('Cookie', makerCookies)
        .send({ ...dossier, cityId, startsAt: inDays(2), endsAt: inDays(20) })
        .expect(201);

      exhibitionId = response.body.id;
      slug = response.body.slug;
      expect(response.body.status).toBe('DRAFT');
      expect(response.body.canSellWorks).toBe(true);
      expect(response.body.blockers.join(' ')).toMatch(/œuvre/);
      expect(response.body.blockers.join(' ')).toMatch(/formule/);
    });

    it('ajoute une œuvre liée à une pièce du catalogue', async () => {
      const response = await api()
        .post(`/api/v1/my/exhibitions/${exhibitionId}/works`)
        .set('Cookie', makerCookies)
        .send({
          title: 'Jarre en terre cuite',
          artistName: 'Afi Mensah',
          description: 'Jarre tournée à la main, cuisson au bois.',
          productId,
        })
        .expect(201);
      expect(response.body.works[0].productName).toBe('Jarre en terre cuite');
    });

    it('refuse de soumettre sans formule', async () => {
      await api().post(`/api/v1/my/exhibitions/${exhibitionId}/submit`).set('Cookie', makerCookies).expect(400);
    });

    it('soumet le dossier complet et prévient l’administration', async () => {
      await api()
        .patch(`/api/v1/my/exhibitions/${exhibitionId}`)
        .set('Cookie', makerCookies)
        .send({ planId: standardPlanId })
        .expect(200);

      const response = await api()
        .post(`/api/v1/my/exhibitions/${exhibitionId}/submit`)
        .set('Cookie', makerCookies)
        .expect(201);
      expect(response.body.status).toBe('SUBMITTED');

      const alert = await prisma.notification.findFirst({
        where: { template: 'admin_notice', user: { email: ADMIN_EMAIL } },
      });
      expect(alert).not.toBeNull();
    });

    it('ne se modifie plus pendant l’instruction', async () => {
      await api()
        .patch(`/api/v1/my/exhibitions/${exhibitionId}`)
        .set('Cookie', makerCookies)
        .send({ title: 'Autre titre' })
        .expect(409);
    });

    it('reste invisible du public avant sa mise en ligne', async () => {
      await api().get(`/api/v1/exhibitions/${slug}`).expect(404);
    });
  });

  describe('2 — instruction', () => {
    it('exige un motif pour demander des modifications', async () => {
      await api()
        .post(`/api/v1/admin/exhibitions/${exhibitionId}/review`)
        .set('Cookie', adminCookies)
        .send({ decision: 'REQUEST_CHANGES' })
        .expect(400);
    });

    it('renvoie le dossier à l’organisateur, qui le corrige et le resoumet', async () => {
      await api()
        .post(`/api/v1/admin/exhibitions/${exhibitionId}/review`)
        .set('Cookie', adminCookies)
        .send({ decision: 'REQUEST_CHANGES', note: 'Précisez les horaires de visite en ligne.' })
        .expect(201);

      await api()
        .patch(`/api/v1/my/exhibitions/${exhibitionId}`)
        .set('Cookie', makerCookies)
        .send({ openingHours: 'En ligne à toute heure' })
        .expect(200);
      await api().post(`/api/v1/my/exhibitions/${exhibitionId}/submit`).set('Cookie', makerCookies).expect(201);
    });

    it('accepte le projet puis refuse de programmer sans contrat ni œuvre validée', async () => {
      await api()
        .post(`/api/v1/admin/exhibitions/${exhibitionId}/review`)
        .set('Cookie', adminCookies)
        .send({ decision: 'ACCEPT' })
        .expect(201);

      const refused = await api()
        .post(`/api/v1/admin/exhibitions/${exhibitionId}/schedule`)
        .set('Cookie', adminCookies)
        .send({ publishAt: inDays(1) })
        .expect(400);
      expect(refused.body.detail ?? refused.body.message).toMatch(/contrat/);
    });

    it('programme une fois le contrat signé et l’œuvre validée', async () => {
      const exhibition = await api()
        .get(`/api/v1/admin/exhibitions/${exhibitionId}`)
        .set('Cookie', adminCookies)
        .expect(200);

      await api()
        .post(`/api/v1/admin/exhibitions/${exhibitionId}/works/${exhibition.body.works[0].id}/review`)
        .set('Cookie', adminCookies)
        .send({ decision: 'APPROVE' })
        .expect(201);
      await api()
        .post(`/api/v1/admin/exhibitions/${exhibitionId}/contract`)
        .set('Cookie', adminCookies)
        .send({ contractReference: 'CTR-EXPO-1', sent: true, signed: true })
        .expect(201);

      /* Mise en ligne dans le passé : l'exposition doit apparaître sans que
         personne ne clique « publier ». */
      const scheduled = await api()
        .post(`/api/v1/admin/exhibitions/${exhibitionId}/schedule`)
        .set('Cookie', adminCookies)
        .send({ publishAt: new Date(Date.now() - 60_000).toISOString() })
        .expect(201);
      expect(scheduled.body.status).toBe('SCHEDULED');

      const actions = await prisma.auditLog.findMany({
        where: { targetType: 'Exhibition', targetId: exhibitionId },
        select: { action: true },
      });
      expect(actions.map((row) => row.action)).toEqual(
        expect.arrayContaining(['exhibition.accept', 'exhibition.contract', 'exhibition.schedule']),
      );
    });
  });

  describe('3 — page publique', () => {
    it('publie l’exposition arrivée à sa date, avec ses œuvres en vente', async () => {
      const response = await api().get(`/api/v1/exhibitions/${slug}`).expect(200);
      expect(response.body.unlocked).toBe(true);
      expect(response.body.works).toHaveLength(1);
      expect(response.body.works[0].product).toMatchObject({ slug: 'jarre-terre-cuite-expo', purchasable: true });
      expect(JSON.stringify(response.body)).not.toContain('CTR-EXPO-1');

      const stored = await prisma.exhibition.findUniqueOrThrow({ where: { id: exhibitionId } });
      expect(stored.status).toBe('PUBLISHED');
    });

    it('figure dans la rubrique des expositions à venir', async () => {
      const response = await api().get('/api/v1/exhibitions').query({ when: 'upcoming' }).expect(200);
      expect(response.body.map((card: { slug: string }) => card.slug)).toContain(slug);
    });

    it('disparaît du public une fois suspendue', async () => {
      await api()
        .post(`/api/v1/admin/exhibitions/${exhibitionId}/suspend`)
        .set('Cookie', adminCookies)
        .send({ reason: 'Œuvre signalée, vérification en cours.' })
        .expect(201);
      await api().get(`/api/v1/exhibitions/${slug}`).expect(404);
    });
  });

  describe('4 — organisateur externe', () => {
    it('monte un dossier avec un simple compte, sans pouvoir vendre', async () => {
      const created = await api()
        .post('/api/v1/my/exhibitions')
        .set('Cookie', outsiderCookies)
        .send({
          ...dossier,
          cityId,
          title: 'Regards croisés',
          organizerName: 'Collectif Regards',
          startsAt: inDays(10),
          endsAt: inDays(15),
        })
        .expect(201);
      expect(created.body.canSellWorks).toBe(false);

      await api()
        .post(`/api/v1/my/exhibitions/${created.body.id}/works`)
        .set('Cookie', outsiderCookies)
        .send({
          title: 'Portrait',
          artistName: 'K. Agbo',
          description: 'Huile sur toile, 2025.',
          productId,
        })
        .expect(400);
    });

    it('ne voit pas le dossier d’un autre organisateur', async () => {
      await api().get(`/api/v1/my/exhibitions/${exhibitionId}`).set('Cookie', outsiderCookies).expect(404);
    });
  });
});

function cookiesOf(response: request.Response): string[] {
  const raw = response.headers['set-cookie'];
  if (!raw) return [];
  return Array.isArray(raw) ? raw : [raw];
}
