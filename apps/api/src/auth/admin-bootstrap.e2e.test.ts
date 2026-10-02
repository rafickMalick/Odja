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
 * Premier administrateur, contre une vraie base : l'inscription avec
 * l'adresse désignée ouvre une session déjà ADMIN, et la suivante non.
 */

const BOOTSTRAP_EMAIL = 'premier.admin@oja.market';

describe('Premier administrateur (bout en bout)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const previous = process.env['ADMIN_BOOTSTRAP_EMAIL'];

  beforeAll(async () => {
    process.env['ADMIN_BOOTSTRAP_EMAIL'] = BOOTSTRAP_EMAIL;
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
    if (previous === undefined) delete process.env['ADMIN_BOOTSTRAP_EMAIL'];
    else process.env['ADMIN_BOOTSTRAP_EMAIL'] = previous;
  });

  beforeEach(async () => {
    if (prisma) await resetTestData(prisma);
  });

  const register = (email: string, phone: string) =>
    request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        role: 'CUSTOMER',
        firstName: 'Awa',
        lastName: 'Koné',
        email,
        phone,
        password: 'un-mot-de-passe-solide',
        acceptedTermsVersion: '2026-08',
      })
      .expect(201);

  it('fait de l’adresse désignée le premier admin, dès l’inscription', async () => {
    const response = await register(BOOTSTRAP_EMAIL, '+2290190000101');

    expect(response.body.user.role).toBe('ADMIN');
    const user = await prisma.user.findFirstOrThrow({ where: { email: BOOTSTRAP_EMAIL } });
    expect(user.role).toBe('ADMIN');
    expect(user.status).toBe('ACTIVE');

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'user.admin.bootstrap', targetId: user.id },
    });
    expect(audit).not.toBeNull();
  });

  it('laisse les autres inscriptions telles quelles', async () => {
    const response = await register('client@oja.market', '+2290190000102');
    expect(response.body.user.role).toBe('CUSTOMER');
  });

  it('ne promeut plus personne dès qu’un admin existe', async () => {
    await prisma.user.create({
      data: {
        role: 'ADMIN',
        status: 'ACTIVE',
        email: 'admin.existant@oja.market',
        phone: '+2290190000103',
        firstName: 'Admin',
        lastName: 'Existant',
      },
    });

    const response = await register(BOOTSTRAP_EMAIL, '+2290190000104');
    expect(response.body.user.role).toBe('CUSTOMER');
  });
});
