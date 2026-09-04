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
 * Authentification, contre une **vraie** base PostgreSQL.
 *
 * Le compte s'ouvre à l'e-mail. La vérification du téléphone par SMS est mise
 * de côté — toute la machinerie OTP reste en place derrière
 * `REQUIRE_PHONE_VERIFICATION`, et reviendra à la première commande, là où le
 * numéro prend une valeur opérationnelle.
 */

const PHONE = '+2250700000001';
const EMAIL = 'test.auth@oja.market';
const PASSWORD = 'un-mot-de-passe-solide';

describe('Authentification (bout en bout)', () => {
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
    await cleanUp();
    await app?.close();
  });

  beforeEach(cleanUp);

  async function cleanUp(): Promise<void> {
    if (!prisma) return;
    await resetTestData(prisma);
  }

  const api = () => request(app.getHttpServer());

  const payload = (over: Record<string, unknown> = {}) => ({
    role: 'CUSTOMER',
    firstName: 'Awa',
    lastName: 'Koné',
    email: EMAIL,
    phone: PHONE,
    password: PASSWORD,
    acceptedTermsVersion: '2026-08',
    ...over,
  });

  async function register(over: Record<string, unknown> = {}): Promise<string[]> {
    const response = await api().post('/api/v1/auth/register').send(payload(over)).expect(201);
    return cookiesOf(response);
  }

  describe('inscription', () => {
    it('ouvre le compte et la session dans le même geste', async () => {
      const cookies = await register();

      const user = await prisma.user.findFirstOrThrow({ where: { phone: PHONE } });
      // Un client est actif tout de suite : il peut parcourir et commander.
      expect(user.status).toBe('ACTIVE');
      expect(user.passwordHash.startsWith('$argon2id$')).toBe(true);
      expect(user.passwordHash).not.toContain(PASSWORD);

      // La session est posée : pas de détour par la boîte aux lettres.
      const joined = cookies.join(';');
      expect(joined).toContain('oja_access=');
      expect(cookies.every((cookie) => cookie.includes('HttpOnly'))).toBe(true);

      await api().get('/api/v1/auth/me').set('Cookie', cookies).expect(200);
    });

    it('envoie un lien de confirmation sans bloquer l’accès', async () => {
      await register();

      const user = await prisma.user.findFirstOrThrow({ where: { phone: PHONE } });
      const token = await prisma.verificationToken.findFirstOrThrow({
        where: { userId: user.id, purpose: 'EMAIL_VERIFICATION', consumedAt: null },
      });

      // Un lien, pas un code : rien à recopier, donc un jeton long.
      expect(token.codeHash).toHaveLength(64);
      expect(user.emailVerifiedAt).toBeNull();
    });

    it('laisse un créateur en attente de validation administrative', async () => {
      await register({ role: 'MAKER' });

      const user = await prisma.user.findFirstOrThrow({ where: { phone: PHONE } });
      expect(user.status).toBe('PENDING');
    });

    it('n’envoie aucun SMS — la vérification téléphone est mise de côté', async () => {
      await register();

      const user = await prisma.user.findFirstOrThrow({ where: { phone: PHONE } });
      const codes = await prisma.verificationToken.count({
        where: { userId: user.id, purpose: 'PHONE_VERIFICATION' },
      });
      expect(codes).toBe(0);
      expect(user.phoneVerifiedAt).toBeNull();
    });

    it('normalise le numéro écrit avec des espaces', async () => {
      await register({ phone: '+225 07 00 00 00 01' });
      // Une seule identité, quelle que soit l'écriture du numéro.
      expect(await prisma.user.count({ where: { phone: PHONE } })).toBe(1);
    });

    it('refuse franchement une adresse déjà prise', async () => {
      await register();

      /* Arbitrage assumé : répondre « regardez vos e-mails » quoi qu'il
         arrive protégerait mieux contre l'énumération, mais obligerait tout
         nouveau visiteur à quitter le site avant de pouvoir s'en servir. */
      const second = await api().post('/api/v1/auth/register').send(payload()).expect(409);
      expect(second.body.detail).toContain('existe déjà');
      expect(await prisma.user.count({ where: { email: EMAIL } })).toBe(1);
    });

    it('refuse un mot de passe trop court, champ par champ', async () => {
      const response = await api()
        .post('/api/v1/auth/register')
        .send(payload({ password: 'court' }))
        .expect(400);

      expect(response.body.errors).toContainEqual(
        expect.objectContaining({ field: 'password' }),
      );
    });

    it("n'ouvre pas de compte administrateur", async () => {
      await api().post('/api/v1/auth/register').send(payload({ role: 'ADMIN' })).expect(400);
    });
  });

  describe('confirmation d’adresse', () => {
    /** Le lien contient un jeton opaque : on le remplace par une valeur connue. */
    async function knownToken(): Promise<string> {
      const user = await prisma.user.findFirstOrThrow({ where: { phone: PHONE } });
      const record = await prisma.verificationToken.findFirstOrThrow({
        where: { userId: user.id, purpose: 'EMAIL_VERIFICATION', consumedAt: null },
      });
      const { createHash } = await import('node:crypto');
      const token = 'jeton-de-test-suffisamment-long-pour-passer';
      await prisma.verificationToken.update({
        where: { id: record.id },
        data: { codeHash: createHash('sha256').update(token).digest('hex') },
      });
      return token;
    }

    it('confirme l’adresse', async () => {
      await register();
      const token = await knownToken();

      await api().post('/api/v1/auth/verify-email').send({ token }).expect(200);

      const user = await prisma.user.findFirstOrThrow({ where: { phone: PHONE } });
      expect(user.emailVerifiedAt).not.toBeNull();
    });

    it('ne sert qu’une fois', async () => {
      await register();
      const token = await knownToken();

      await api().post('/api/v1/auth/verify-email').send({ token }).expect(200);
      await api().post('/api/v1/auth/verify-email').send({ token }).expect(400);
    });

    it('refuse un lien expiré comme un lien inconnu', async () => {
      await register();
      const token = await knownToken();

      await prisma.verificationToken.updateMany({
        where: { purpose: 'EMAIL_VERIFICATION' },
        data: { expiresAt: new Date(Date.now() - 1_000) },
      });

      const expired = await api().post('/api/v1/auth/verify-email').send({ token }).expect(400);
      const unknown = await api()
        .post('/api/v1/auth/verify-email')
        .send({ token: 'un-jeton-totalement-invente-mais-assez-long' })
        .expect(400);

      // La distinction n'aiderait que quelqu'un qui essaie des jetons au hasard.
      expect(expired.body.detail).toBe(unknown.body.detail);
    });

    it('ne dit pas si une adresse attend une confirmation', async () => {
      const known = await api()
        .post('/api/v1/auth/resend-email')
        .send({ email: EMAIL })
        .expect(202);
      const unknown = await api()
        .post('/api/v1/auth/resend-email')
        .send({ email: 'personne@oja.market' })
        .expect(202);

      expect(known.body).toEqual(unknown.body);
    });
  });

  describe('connexion', () => {
    it('accepte l’e-mail comme le téléphone, sans exiger de vérification', async () => {
      await register();

      await api()
        .post('/api/v1/auth/login')
        .send({ identifier: EMAIL, password: PASSWORD })
        .expect(200);

      await api()
        .post('/api/v1/auth/login')
        .send({ identifier: PHONE, password: PASSWORD })
        .expect(200);
    });

    it('refuse un mauvais mot de passe sans dire lequel des deux est faux', async () => {
      await register();

      const wrongPassword = await api()
        .post('/api/v1/auth/login')
        .send({ identifier: EMAIL, password: 'mauvais-mot-de-passe' })
        .expect(401);

      const unknownAccount = await api()
        .post('/api/v1/auth/login')
        .send({ identifier: 'inconnu@oja.market', password: PASSWORD })
        .expect(401);

      expect(wrongPassword.body.detail).toBe(unknownAccount.body.detail);
    });

    it('refuse un compte suspendu', async () => {
      await register();
      await prisma.user.update({ where: { email: EMAIL }, data: { status: 'SUSPENDED' } });

      const response = await api()
        .post('/api/v1/auth/login')
        .send({ identifier: EMAIL, password: PASSWORD })
        .expect(401);
      expect(response.body.detail).toContain('suspendu');
    });
  });

  describe('sessions', () => {
    it('refuse /me sans jeton', async () => {
      await api().get('/api/v1/auth/me').expect(401);
    });

    it('renvoie le profil courant, jamais le hash du mot de passe', async () => {
      const cookies = await register();

      const response = await api().get('/api/v1/auth/me').set('Cookie', cookies).expect(200);

      expect(response.body.email).toBe(EMAIL);
      expect(response.body).not.toHaveProperty('passwordHash');
      expect(JSON.stringify(response.body)).not.toContain('argon2');
    });

    it('invalide le jeton d’accès dès la déconnexion', async () => {
      const cookies = await register();

      await api().get('/api/v1/auth/me').set('Cookie', cookies).expect(200);
      await api().post('/api/v1/auth/logout').set('Cookie', cookies).expect(204);

      // Le JWT est toujours signé et non expiré — mais la session est fermée.
      await api().get('/api/v1/auth/me').set('Cookie', cookies).expect(401);
    });

    it('fait tourner le jeton de rafraîchissement', async () => {
      const cookies = await register();

      const refreshed = await api()
        .post('/api/v1/auth/refresh')
        .set('Cookie', cookies)
        .expect(200);

      expect(refreshToken(cookiesOf(refreshed))).not.toBe(refreshToken(cookies));
    });

    it('ferme TOUTES les sessions si un jeton déjà consommé est rejoué', async () => {
      const cookies = await register();

      const first = await api().post('/api/v1/auth/refresh').set('Cookie', cookies).expect(200);
      const rotated = cookiesOf(first);

      // On ne sait pas si c'est le porteur légitime ou un voleur : on coupe tout.
      await api().post('/api/v1/auth/refresh').set('Cookie', cookies).expect(401);
      await api().post('/api/v1/auth/refresh').set('Cookie', rotated).expect(401);
    });
  });

  describe('réinitialisation de mot de passe', () => {
    it('ne dit pas si le compte existe', async () => {
      const known = await api()
        .post('/api/v1/auth/forgot-password')
        .send({ identifier: EMAIL })
        .expect(202);

      const unknown = await api()
        .post('/api/v1/auth/forgot-password')
        .send({ identifier: 'personne@oja.market' })
        .expect(202);

      expect(known.body).toEqual(unknown.body);
    });

    it('envoie le code par e-mail et ferme les sessions ouvertes', async () => {
      const cookies = await register();
      await api().get('/api/v1/auth/me').set('Cookie', cookies).expect(200);

      await api().post('/api/v1/auth/forgot-password').send({ identifier: EMAIL }).expect(202);

      const user = await prisma.user.findFirstOrThrow({ where: { phone: PHONE } });
      const token = await prisma.verificationToken.findFirstOrThrow({
        where: { userId: user.id, purpose: 'PASSWORD_RESET', consumedAt: null },
      });
      const { createHash } = await import('node:crypto');
      await prisma.verificationToken.update({
        where: { id: token.id },
        data: { codeHash: createHash('sha256').update('654321').digest('hex') },
      });

      await api()
        .post('/api/v1/auth/reset-password')
        .send({ identifier: EMAIL, code: '654321', password: 'un-tout-nouveau-secret' })
        .expect(200);

      // Un mot de passe change parce qu'on le croit compromis.
      await api().get('/api/v1/auth/me').set('Cookie', cookies).expect(401);

      await api()
        .post('/api/v1/auth/login')
        .send({ identifier: EMAIL, password: 'un-tout-nouveau-secret' })
        .expect(200);
    });
  });
});

function cookiesOf(response: request.Response): string[] {
  const raw = response.headers['set-cookie'];
  if (!raw) return [];
  return Array.isArray(raw) ? raw : [raw];
}

function refreshToken(cookies: string[]): string | undefined {
  return cookies.find((cookie) => cookie.startsWith('oja_refresh='))?.split(';')[0];
}
