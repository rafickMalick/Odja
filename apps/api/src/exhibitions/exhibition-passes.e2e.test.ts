import { createHash } from 'node:crypto';

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
 * Billetterie et achat d'œuvres (cahier des évolutions, phase 4) : billet
 * payé, inscription gratuite, invitation par code ; la galerie ne s'ouvre
 * qu'au détenteur d'un droit d'accès confirmé.
 */

const ORGANIZER_EMAIL = 'billet.organisateur@oja.market';
const ORGANIZER_PHONE = '+2250790000401';
const VISITOR_EMAIL = 'billet.visiteur@oja.market';
const VISITOR_PHONE = '+2250790000402';
const ADMIN_EMAIL = 'billet.admin@oja.market';
const ADMIN_PHONE = '+2250790000403';
const PASSWORD = 'un-mot-de-passe-solide';

describe('Billetterie des expositions (bout en bout)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let visitorCookies: string[];
  let adminCookies: string[];
  let paidId: string;
  let ticketReference: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    app.setGlobalPrefix('api/v1');
    app.use(cookieParser());
    app.useGlobalFilters(new ProblemFilter(), new DomainErrorFilter());
    await app.init();

    prisma = app.get(PrismaService);
    await resetTestData(prisma);

    await signUp('CUSTOMER', ORGANIZER_EMAIL, ORGANIZER_PHONE);
    visitorCookies = await signUp('CUSTOMER', VISITOR_EMAIL, VISITOR_PHONE);
    await signUp('CUSTOMER', ADMIN_EMAIL, ADMIN_PHONE);
    await prisma.user.update({ where: { email: ADMIN_EMAIL }, data: { role: 'ADMIN', status: 'ACTIVE' } });
    adminCookies = cookiesOf(
      await api().post('/api/v1/auth/login').send({ identifier: ADMIN_EMAIL, password: PASSWORD }).expect(200),
    );

    const organizer = await prisma.user.findUniqueOrThrow({ where: { email: ORGANIZER_EMAIL } });
    const city = await prisma.city.findFirstOrThrow({ where: { country: { isActive: true } } });
    const base = {
      organizerId: organizer.id,
      organizerName: 'Collectif Lumière',
      summary: 'Photographies de la côte béninoise.',
      cityId: city.id,
      startsAt: new Date(Date.now() - 86_400_000),
      endsAt: new Date(Date.now() + 10 * 86_400_000),
      format: 'HYBRID' as const,
      venueName: 'Galerie du Port',
      venueAddress: 'Boulevard de la Marina',
      status: 'PUBLISHED' as const,
      publishedAt: new Date(),
      works: {
        create: [
          {
            title: 'Pêcheurs à l’aube',
            artistName: 'S. Dossou',
            description: 'Tirage argentique.',
            reviewStatus: 'APPROVED' as const,
          },
        ],
      },
    };

    paidId = (
      await prisma.exhibition.create({
        data: { ...base, slug: 'lumiere-payante', title: 'Lumière payante', accessMode: 'PAID', ticketPriceXof: 2_000 },
      })
    ).id;
    await prisma.exhibition.create({
      data: { ...base, slug: 'lumiere-inscription', title: 'Lumière sur inscription', requiresRegistration: true },
    });
    const restricted = await prisma.exhibition.create({
      data: { ...base, slug: 'lumiere-privee', title: 'Lumière privée', accessMode: 'RESTRICTED' },
    });
    await prisma.exhibition.update({
      where: { id: restricted.id },
      data: {
        accessCodeHash: createHash('sha256').update(`${restricted.id}:sesame`).digest('hex'),
      },
    });
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
          lastName: 'Billet',
          email,
          phone,
          password: PASSWORD,
          acceptedTermsVersion: '2026-08',
        })
        .expect(201),
    );
  }

  describe('1 — billet payant', () => {
    it('garde la galerie fermée sans billet', async () => {
      const response = await api().get('/api/v1/exhibitions/lumiere-payante').set('Cookie', visitorCookies).expect(200);
      expect(response.body.requirement).toBe('TICKET');
      expect(response.body.unlocked).toBe(false);
      expect(response.body.works).toBeNull();
    });

    it('émet un billet en attente au prix affiché', async () => {
      const response = await api()
        .post('/api/v1/exhibitions/lumiere-payante/tickets')
        .set('Cookie', visitorCookies)
        .send({ format: 'ONLINE' })
        .expect(201);

      ticketReference = response.body.pass.reference;
      expect(ticketReference).toMatch(/^BIL-\d{4}-\d{6}$/);
      expect(response.body.pass.status).toBe('PENDING_PAYMENT');
      expect(response.body.checkout.amountXof).toBe(2_000);
    });

    it('ne confirme rien tant que le fournisseur n’a pas encaissé', async () => {
      const response = await api()
        .post(`/api/v1/exhibitions/passes/${ticketReference}/verify`)
        .set('Cookie', visitorCookies)
        .expect(201);
      expect(response.body.status).toBe('PENDING_PAYMENT');
    });

    it('confirme le billet une fois payé, et ouvre la galerie', async () => {
      const paid = await api()
        .post(`/api/v1/exhibitions/passes/${ticketReference}/simulate-payment`)
        .set('Cookie', visitorCookies)
        .expect(201);
      expect(paid.body.status).toBe('CONFIRMED');

      const response = await api().get('/api/v1/exhibitions/lumiere-payante').set('Cookie', visitorCookies).expect(200);
      expect(response.body.unlocked).toBe(true);
      expect(response.body.works).toHaveLength(1);

      const notice = await prisma.notification.findFirst({
        where: { template: 'visitor_notice', user: { email: VISITOR_EMAIL }, channel: 'inapp' },
      });
      expect(JSON.stringify(notice?.payload)).toContain(ticketReference);
    });

    it('refuse un second billet pour le même format', async () => {
      await api()
        .post('/api/v1/exhibitions/lumiere-payante/tickets')
        .set('Cookie', visitorCookies)
        .send({ format: 'ONLINE' })
        .expect(409);
    });

    it('n’ouvre pas la galerie au visiteur anonyme', async () => {
      const response = await api().get('/api/v1/exhibitions/lumiere-payante').expect(200);
      expect(response.body.unlocked).toBe(false);
    });
  });

  describe('2 — inscription et invitation', () => {
    it('inscrit gratuitement le visiteur et lui ouvre la galerie', async () => {
      await api()
        .post('/api/v1/exhibitions/lumiere-inscription/register')
        .set('Cookie', visitorCookies)
        .send({ format: 'ONSITE' })
        .expect(201);

      const response = await api()
        .get('/api/v1/exhibitions/lumiere-inscription')
        .set('Cookie', visitorCookies)
        .expect(200);
      expect(response.body.unlocked).toBe(true);
    });

    it('refuse un mauvais code, accepte le bon', async () => {
      await api()
        .post('/api/v1/exhibitions/lumiere-privee/code')
        .set('Cookie', visitorCookies)
        .send({ code: 'mauvais' })
        .expect(400);

      await api()
        .post('/api/v1/exhibitions/lumiere-privee/code')
        .set('Cookie', visitorCookies)
        .send({ code: 'SESAME' })
        .expect(201);
    });

    it('liste les accès du visiteur', async () => {
      const response = await api().get('/api/v1/exhibitions/passes/mine').set('Cookie', visitorCookies).expect(200);
      expect(response.body.map((pass: { kind: string }) => pass.kind).sort()).toEqual([
        'INVITATION',
        'REGISTRATION',
        'TICKET',
      ]);
    });
  });

  describe('3 — chiffres pour l’administration', () => {
    it('compte billets, recettes et visites', async () => {
      const response = await api()
        .get(`/api/v1/admin/exhibitions/${paidId}/stats`)
        .set('Cookie', adminCookies)
        .expect(200);
      expect(response.body).toMatchObject({ ticketsConfirmed: 1, ticketRevenueXof: 2_000 });
      expect(response.body.views).toBeGreaterThan(0);

      const passes = await api()
        .get(`/api/v1/admin/exhibitions/${paidId}/passes`)
        .set('Cookie', adminCookies)
        .expect(200);
      expect(passes.body[0].holderEmail).toBe(VISITOR_EMAIL);
    });
  });
});

function cookiesOf(response: request.Response): string[] {
  const raw = response.headers['set-cookie'];
  if (!raw) return [];
  return Array.isArray(raw) ? raw : [raw];
}
