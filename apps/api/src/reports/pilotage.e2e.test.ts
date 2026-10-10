import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../app.module';
import { DomainErrorFilter } from '../common/domain-error.filter';
import { ProblemFilter } from '../common/problem.filter';
import { VisibilityService } from '../makers/visibility.service';
import { PrismaService } from '../prisma/prisma.service';
import { resetTestData } from '../test/cleanup';

/**
 * Pilotage (cahier des évolutions, phase 5) : signalement d'un contenu et
 * masquage, suspension d'un profil, rappels d'échéance des formules, tableau
 * de bord de l'administration.
 */

const MAKER_EMAIL = 'pilotage.createur@oja.market';
const MAKER_PHONE = '+2250790000501';
const ADMIN_EMAIL = 'pilotage.admin@oja.market';
const ADMIN_PHONE = '+2250790000502';
const PASSWORD = 'un-mot-de-passe-solide';

describe('Pilotage et signalements (bout en bout)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminCookies: string[];
  let makerId: string;
  let productId: string;
  let reportId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    app.setGlobalPrefix('api/v1');
    app.use(cookieParser());
    app.useGlobalFilters(new ProblemFilter(), new DomainErrorFilter());
    await app.init();

    prisma = app.get(PrismaService);
    await resetTestData(prisma);

    await signUp('MAKER', MAKER_EMAIL, MAKER_PHONE);
    await signUp('CUSTOMER', ADMIN_EMAIL, ADMIN_PHONE);
    await prisma.user.update({ where: { email: ADMIN_EMAIL }, data: { role: 'ADMIN', status: 'ACTIVE' } });
    adminCookies = cookiesOf(
      await api().post('/api/v1/auth/login').send({ identifier: ADMIN_EMAIL, password: PASSWORD }).expect(200),
    );

    const city = await prisma.city.findFirstOrThrow({ where: { country: { isActive: true } } });
    const maker = await prisma.makerProfile.create({
      data: {
        user: { connect: { email: MAKER_EMAIL } },
        shopName: 'Atelier Pilote',
        slug: 'atelier-pilote',
        city: { connect: { id: city.id } },
        kycStatus: 'APPROVED',
      },
    });
    makerId = maker.id;
    const category = await prisma.category.findFirstOrThrow({ where: { slug: 'mobilier' } });
    productId = (
      await prisma.product.create({
        data: {
          makerId,
          categoryId: category.id,
          slug: 'banc-pilote',
          name: 'Banc pilote',
          description: 'Banc en iroko, assemblage à tenons.',
          makerPriceXof: 50_000,
          quantityAvailable: 2,
          weightGrams: 9_000,
          lengthMm: 1200,
          widthMm: 350,
          heightMm: 450,
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
          lastName: 'Pilotage',
          email,
          phone,
          password: PASSWORD,
          acceptedTermsVersion: '2026-08',
        })
        .expect(201),
    );
  }

  describe('1 — signalement', () => {
    it('demande une adresse à un visiteur anonyme', async () => {
      await api()
        .post('/api/v1/reports')
        .send({ targetType: 'PRODUCT', targetId: productId, reason: 'UNAUTHORIZED_USE', details: 'Cette photo est la mienne.' })
        .expect(400);
    });

    it('enregistre le signalement et prévient l’administration', async () => {
      const response = await api()
        .post('/api/v1/reports')
        .send({
          targetType: 'PRODUCT',
          targetId: productId,
          reason: 'UNAUTHORIZED_USE',
          details: 'Cette photo vient de mon portfolio, publiée sans mon accord.',
          email: 'photographe@oja.market',
        })
        .expect(201);
      expect(response.body.reference).toMatch(/^SIG-\d{4}-\d{6}$/);

      const list = await api().get('/api/v1/admin/reports').query({ status: 'OPEN' }).set('Cookie', adminCookies).expect(200);
      reportId = list.body[0].id;
      expect(list.body[0].targetLabel).toContain('Banc pilote');
    });

    it('masque la fiche quand l’administration retient le signalement', async () => {
      await api()
        .post(`/api/v1/admin/reports/${reportId}/resolve`)
        .set('Cookie', adminCookies)
        .send({ decision: 'RESOLVED', note: 'Photo retirée, l’atelier est prévenu.', hideContent: true })
        .expect(201);

      await api().get('/api/v1/catalog/products/banc-pilote').expect(404);
      const audit = await prisma.auditLog.findFirst({ where: { action: 'report.resolved', targetId: reportId } });
      expect(audit).not.toBeNull();
    });

    it('ne traite pas deux fois le même signalement', async () => {
      await api()
        .post(`/api/v1/admin/reports/${reportId}/resolve`)
        .set('Cookie', adminCookies)
        .send({ decision: 'DISMISSED', note: 'Doublon.' })
        .expect(409);
    });
  });

  describe('2 — suspension d’un profil', () => {
    it('retire le profil du public, puis le rend', async () => {
      await api().get('/api/v1/makers/atelier-pilote').expect(200);

      const suspended = await api()
        .post(`/api/v1/admin/makers/${makerId}/suspend`)
        .set('Cookie', adminCookies)
        .send({ reason: 'Vérification d’un signalement en cours.' })
        .expect(201);
      expect(suspended.body.suspendedAt).not.toBeNull();
      await api().get('/api/v1/makers/atelier-pilote').expect(404);

      await api().post(`/api/v1/admin/makers/${makerId}/reinstate`).set('Cookie', adminCookies).expect(201);
      await api().get('/api/v1/makers/atelier-pilote').expect(200);
    });
  });

  describe('3 — rappels de formule', () => {
    it('prévient une seule fois une semaine avant l’échéance', async () => {
      const premium = await prisma.visibilityPlan.findUniqueOrThrow({ where: { code: 'premium' } });
      await prisma.makerSubscription.create({
        data: {
          makerId,
          planId: premium.id,
          startsAt: new Date(Date.now() - 27 * 86_400_000),
          endsAt: new Date(Date.now() + 3 * 86_400_000),
        },
      });

      const visibility = app.get(VisibilityService);
      expect(await visibility.notifyRenewals()).toBe(1);
      expect(await visibility.notifyRenewals()).toBe(0);

      const notice = await prisma.notification.findFirst({
        where: { template: 'creator_notice', user: { email: MAKER_EMAIL }, channel: 'inapp' },
        orderBy: { createdAt: 'desc' },
      });
      expect(JSON.stringify(notice?.payload)).toContain('arrive à échéance');
    });
  });

  describe('4 — tableau de bord', () => {
    it('compte ce qui attend l’administration', async () => {
      const response = await api().get('/api/v1/admin/creative-overview').set('Cookie', adminCookies).expect(200);
      expect(response.body).toMatchObject({ premiumActive: expect.any(Number), reportsOpen: 0 });
      expect(response.body.premiumActive).toBeGreaterThanOrEqual(1);
    });
  });
});

function cookiesOf(response: request.Response): string[] {
  const raw = response.headers['set-cookie'];
  if (!raw) return [];
  return Array.isArray(raw) ? raw : [raw];
}
