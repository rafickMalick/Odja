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
import { MfaPolicy } from './mfa-policy';
import { stepAt, totpForStep } from './totp';

/**
 * Double authentification, contre une vraie base (cahier L0-22, L7-16).
 *
 * Ce qui ne doit jamais casser : un mot de passe d'admin seul n'ouvre pas
 * l'espace admin, un code ne sert qu'une fois, et le second facteur survit
 * au rafraîchissement de la session.
 *
 * `vitest.config.ts` coupe l'obligation pour les autres tests
 * (`ADMIN_MFA_REQUIRED=false`) ; ici, elle est imposée.
 */

const PASSWORD = 'un-mot-de-passe-solide';
const ADMIN = { email: 'admin.mfa@oja.market', phone: '+2250700000301' };
const COLLEAGUE = { email: 'collegue.mfa@oja.market', phone: '+2250700000302' };
const CUSTOMER = { email: 'client.mfa@oja.market', phone: '+2250700000303' };

describe('Double authentification (bout en bout)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MfaPolicy)
      .useValue({ adminRequired: true, isRequiredFor: (role: string) => role === 'ADMIN' })
      .compile();
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

  async function register(account: { email: string; phone: string }, admin = false) {
    await api()
      .post('/api/v1/auth/register')
      .send({
        role: 'CUSTOMER',
        firstName: 'Awa',
        lastName: 'Koné',
        email: account.email,
        phone: account.phone,
        password: PASSWORD,
        acceptedTermsVersion: '2026-08',
      })
      .expect(201);
    if (admin) {
      await prisma.user.update({
        where: { email: account.email },
        data: { role: 'ADMIN', status: 'ACTIVE' },
      });
    }
  }

  const login = (email: string) =>
    api().post('/api/v1/auth/login').send({ identifier: email, password: PASSWORD }).expect(200);

  /** Active le TOTP et renvoie le secret, les codes de secours et la session. */
  async function enrol(cookies: string[]) {
    const setup = await api().post('/api/v1/auth/mfa/setup').set('Cookie', cookies).expect(200);
    const secret: string = setup.body.secret;
    const enabled = await api()
      .post('/api/v1/auth/mfa/enable')
      .set('Cookie', cookies)
      .send({ code: totpForStep(secret, stepAt(Date.now())) })
      .expect(200);
    return { secret, recoveryCodes: enabled.body.recoveryCodes as string[] };
  }

  it('ferme l’espace admin tant que la double authentification n’est pas activée', async () => {
    await register(ADMIN, true);
    const cookies = cookiesOf(await login(ADMIN.email));

    const refused = await api().get('/api/v1/admin/team').set('Cookie', cookies).expect(403);
    expect(refused.body.title).toBe('Double authentification requise');

    const status = await api().get('/api/v1/auth/mfa').set('Cookie', cookies).expect(200);
    expect(status.body).toMatchObject({ enabled: false, required: true, sessionVerified: false });
  });

  it('l’activation ouvre l’espace admin sans se reconnecter, et donne 10 codes de secours', async () => {
    await register(ADMIN, true);
    const cookies = cookiesOf(await login(ADMIN.email));

    // Un mauvais premier code n'active rien.
    await api().post('/api/v1/auth/mfa/setup').set('Cookie', cookies).expect(200);
    await api()
      .post('/api/v1/auth/mfa/enable')
      .set('Cookie', cookies)
      .send({ code: '000000' })
      .expect(400);

    const { recoveryCodes } = await enrol(cookies);
    expect(recoveryCodes).toHaveLength(10);
    await api().get('/api/v1/admin/team').set('Cookie', cookies).expect(200);

    const stored = await prisma.user.findUniqueOrThrow({ where: { email: ADMIN.email } });
    // Le secret n'est jamais en clair, les codes de secours non plus.
    expect(stored.mfaSecret).toMatch(/^v1:/);
    const codes = await prisma.mfaRecoveryCode.findMany({ where: { userId: stored.id } });
    expect(codes.map((c) => c.codeHash)).not.toContain(recoveryCodes[0]);
  });

  it('le mot de passe seul ne suffit plus : la connexion demande le code', async () => {
    await register(ADMIN, true);
    const { secret } = await enrol(cookiesOf(await login(ADMIN.email)));

    const first = await login(ADMIN.email);
    expect(first.body).toEqual({ mfaRequired: true, challenge: expect.any(String) });
    expect(cookiesOf(first)).toHaveLength(0);

    await api()
      .post('/api/v1/auth/login/mfa')
      .send({ challenge: first.body.challenge, code: '000000' })
      .expect(401);

    // Le code de l'activation est déjà consommé : on prend le pas suivant,
    // dans la fenêtre de dérive tolérée.
    const code = totpForStep(secret, stepAt(Date.now()) + 1);
    const second = await api()
      .post('/api/v1/auth/login/mfa')
      .send({ challenge: first.body.challenge, code })
      .expect(200);
    const cookies = cookiesOf(second);
    expect(second.body.user.mfaEnabled).toBe(true);
    await api().get('/api/v1/admin/team').set('Cookie', cookies).expect(200);

    // Le même code ne sert pas deux fois.
    const replay = await login(ADMIN.email);
    await api()
      .post('/api/v1/auth/login/mfa')
      .send({ challenge: replay.body.challenge, code })
      .expect(401);

    // Le second facteur survit au rafraîchissement de la session.
    const refreshed = await api()
      .post('/api/v1/auth/refresh')
      .set('Cookie', cookies.filter((c) => c.startsWith('oja_refresh=')))
      .expect(200);
    await api().get('/api/v1/admin/team').set('Cookie', cookiesOf(refreshed)).expect(200);
  });

  it('un code de secours ouvre la session une seule fois', async () => {
    await register(ADMIN, true);
    const { recoveryCodes } = await enrol(cookiesOf(await login(ADMIN.email)));

    const challenge = async () => (await login(ADMIN.email)).body.challenge as string;
    await api()
      .post('/api/v1/auth/login/mfa')
      .send({ challenge: await challenge(), code: recoveryCodes[0]!.toLowerCase() })
      .expect(200);
    await api()
      .post('/api/v1/auth/login/mfa')
      .send({ challenge: await challenge(), code: recoveryCodes[0] })
      .expect(401);
  });

  it('un défi forgé ou expiré est refusé', async () => {
    await api()
      .post('/api/v1/auth/login/mfa')
      .send({ challenge: 'eyJhbGciOiJIUzI1NiJ9.faux.defi-invente', code: '123456' })
      .expect(401);
  });

  it('un admin ne peut pas la désactiver ; un collègue peut la réinitialiser', async () => {
    await register(ADMIN, true);
    await register(COLLEAGUE, true);
    const adminCookies = cookiesOf(await login(ADMIN.email));
    const { secret } = await enrol(adminCookies);

    await api()
      .post('/api/v1/auth/mfa/disable')
      .set('Cookie', adminCookies)
      .send({ code: totpForStep(secret, stepAt(Date.now()) + 1) })
      .expect(403);

    const colleagueCookies = cookiesOf(await login(COLLEAGUE.email));
    await enrol(colleagueCookies);
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: ADMIN.email } });

    // Jamais sur soi-même : un mot de passe volé suffirait sinon.
    const colleague = await prisma.user.findUniqueOrThrow({ where: { email: COLLEAGUE.email } });
    await api()
      .post(`/api/v1/admin/team/${colleague.id}/mfa/reset`)
      .set('Cookie', colleagueCookies)
      .expect(400);

    await api()
      .post(`/api/v1/admin/team/${admin.id}/mfa/reset`)
      .set('Cookie', colleagueCookies)
      .expect(200);

    // Sessions fermées, second facteur effacé, geste écrit au journal.
    await api().get('/api/v1/auth/mfa').set('Cookie', adminCookies).expect(401);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: admin.id } });
    expect(after.mfaEnabledAt).toBeNull();
    expect(
      await prisma.auditLog.count({ where: { action: 'user.mfa.reset', targetId: admin.id } }),
    ).toBe(1);
  });

  it('reste facultative pour un client, qui peut l’activer puis la retirer', async () => {
    await register(CUSTOMER);
    const cookies = cookiesOf(await login(CUSTOMER.email));

    const status = await api().get('/api/v1/auth/mfa').set('Cookie', cookies).expect(200);
    expect(status.body).toMatchObject({ enabled: false, required: false });

    const { secret } = await enrol(cookies);
    await api()
      .post('/api/v1/auth/mfa/disable')
      .set('Cookie', cookies)
      .send({ code: totpForStep(secret, stepAt(Date.now()) + 1) })
      .expect(204);

    // Désactivée : la connexion redevient directe.
    const direct = await login(CUSTOMER.email);
    expect(direct.body.user.mfaEnabled).toBe(false);
  });
});

function cookiesOf(response: request.Response): string[] {
  const raw = response.headers['set-cookie'] as unknown as string[] | string | undefined;
  if (!raw) return [];
  return (Array.isArray(raw) ? raw : [raw]).map((cookie) => cookie.split(';')[0]!);
}
