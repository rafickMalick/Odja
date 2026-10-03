import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AppModule } from '../app.module';
import { DomainErrorFilter } from '../common/domain-error.filter';
import { ProblemFilter } from '../common/problem.filter';
import { PrismaService } from '../prisma/prisma.service';
import { resetTestData } from '../test/cleanup';

/**
 * Équipe d'administration, contre une vraie base : nommer et retirer un admin
 * depuis le site, avec les garde-fous qui empêchent de se retrouver sans
 * personne pour administrer.
 */

const PASSWORD = 'un-mot-de-passe-solide';

describe('Équipe d’administration (bout en bout)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    app.setGlobalPrefix('api/v1');
    app.use(cookieParser());
    app.useGlobalFilters(new ProblemFilter(), new DomainErrorFilter());
    await app.init();
    prisma = app.get(PrismaService);
  }, 60_000);

  afterAll(async () => {
    if (prisma) await resetTestData(prisma);
    await app?.close();
  });

  beforeEach(async () => {
    if (prisma) await resetTestData(prisma);
  });

  const api = () => request(app.getHttpServer());

  async function register(
    email: string,
    phone: string,
    role: 'CUSTOMER' | 'MAKER' = 'CUSTOMER',
  ): Promise<string[]> {
    const response = await api()
      .post('/api/v1/auth/register')
      .send({
        role,
        firstName: 'Awa',
        lastName: 'Koné',
        email,
        phone,
        password: PASSWORD,
        acceptedTermsVersion: '2026-08',
      })
      .expect(201);
    return cookiesOf(response);
  }

  async function login(email: string): Promise<string[]> {
    const response = await api()
      .post('/api/v1/auth/login')
      .send({ identifier: email, password: PASSWORD })
      .expect(200);
    return cookiesOf(response);
  }

  /** Un premier admin, comme le laisse ADMIN_BOOTSTRAP_EMAIL. */
  async function firstAdmin(): Promise<{ id: string; cookies: string[] }> {
    await register('admin1@oja.market', '+2290190000201');
    const user = await prisma.user.update({
      where: { email: 'admin1@oja.market' },
      data: { role: 'ADMIN', status: 'ACTIVE' },
    });
    return { id: user.id, cookies: await login('admin1@oja.market') };
  }

  it('nomme un client inscrit, qui accède à l’admin après reconnexion', async () => {
    const admin = await firstAdmin();
    const oldSession = await register('awa@oja.market', '+2290190000202');

    const granted = await api()
      .post('/api/v1/admin/team')
      .set('Cookie', admin.cookies)
      .send({ email: 'Awa@Oja.market' })
      .expect(201);
    expect(granted.body.email).toBe('awa@oja.market');

    // Sa session d'avant est fermée : elle portait le rôle CUSTOMER.
    await api().get('/api/v1/admin/team').set('Cookie', oldSession).expect(401);

    const fresh = await login('awa@oja.market');
    const team = await api().get('/api/v1/admin/team').set('Cookie', fresh).expect(200);
    expect(team.body).toHaveLength(2);

    // Ciblé sur ce compte : le journal d'audit n'est pas vidé entre deux suites.
    const awa = await prisma.user.findFirstOrThrow({ where: { email: 'awa@oja.market' } });
    const audit = await prisma.auditLog.findFirst({
      where: { action: 'user.admin.grant', targetId: awa.id },
    });
    expect(audit?.actorId).toBe(admin.id);

    // L'audit automatique trace aussi la requête elle-même, adresse masquée.
    const automatic = await prisma.auditLog.findFirst({
      where: { action: 'http.POST /admin/team', actorId: admin.id },
    });
    expect(automatic).toMatchObject({ actorRole: 'ADMIN', targetType: 'team' });
    expect(JSON.stringify(automatic?.after)).not.toContain('awa@oja.market');
  });

  it('refuse une adresse inconnue et un compte créateur', async () => {
    const admin = await firstAdmin();
    await register('atelier@oja.market', '+2290190000203', 'MAKER');

    await api()
      .post('/api/v1/admin/team')
      .set('Cookie', admin.cookies)
      .send({ email: 'personne@oja.market' })
      .expect(404);
    await api()
      .post('/api/v1/admin/team')
      .set('Cookie', admin.cookies)
      .send({ email: 'atelier@oja.market' })
      .expect(400);

    // Une action refusée n'a rien fait : rien n'est écrit au journal.
    expect(
      await prisma.auditLog.count({ where: { action: { startsWith: 'http.' }, actorId: admin.id } }),
    ).toBe(0);
  });

  it('retire un admin, avec effet immédiat sur sa session', async () => {
    const admin = await firstAdmin();
    await register('awa@oja.market', '+2290190000204');
    await api()
      .post('/api/v1/admin/team')
      .set('Cookie', admin.cookies)
      .send({ email: 'awa@oja.market' })
      .expect(201);
    const second = await login('awa@oja.market');
    const awa = await prisma.user.findFirstOrThrow({ where: { email: 'awa@oja.market' } });

    await api().delete(`/api/v1/admin/team/${awa.id}`).set('Cookie', admin.cookies).expect(200);

    await api().get('/api/v1/admin/team').set('Cookie', second).expect(401);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: awa.id } });
    expect(after.role).toBe('CUSTOMER');
  });

  it('interdit de se retirer soi-même et de retirer le dernier admin', async () => {
    const admin = await firstAdmin();

    await api().delete(`/api/v1/admin/team/${admin.id}`).set('Cookie', admin.cookies).expect(400);
    const still = await prisma.user.findUniqueOrThrow({ where: { id: admin.id } });
    expect(still.role).toBe('ADMIN');
  });

  it('reste fermé à un non-admin, sans même révéler la route', async () => {
    // 404 et non 403 : règle du § 2.1, un refus ne confirme pas l'existence.
    const customer = await register('client@oja.market', '+2290190000205');
    await api().get('/api/v1/admin/team').set('Cookie', customer).expect(404);
    await api()
      .post('/api/v1/admin/team')
      .set('Cookie', customer)
      .send({ email: 'client@oja.market' })
      .expect(404);
    const self = await prisma.user.findFirstOrThrow({ where: { email: 'client@oja.market' } });
    expect(self.role).toBe('CUSTOMER');
  });
});

function cookiesOf(response: request.Response): string[] {
  const raw = response.headers['set-cookie'] as unknown as string[] | string | undefined;
  if (!raw) return [];
  return (Array.isArray(raw) ? raw : [raw]).map((cookie) => cookie.split(';')[0]!);
}
