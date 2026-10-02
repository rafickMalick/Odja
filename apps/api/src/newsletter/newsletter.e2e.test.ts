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
 * Inscription à la newsletter, contre une vraie base.
 *
 * Ce qui ne doit jamais casser : une adresse n'est enregistrée qu'une fois,
 * et la réponse ne dit pas si elle l'était déjà.
 */

describe('Newsletter (bout en bout)', () => {
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

  const subscribe = (over: Record<string, unknown> = {}) =>
    request(app.getHttpServer())
      .post('/api/v1/newsletter')
      .send({ email: 'lectrice@oja.market', website: '', ...over });

  it('enregistre l’adresse une seule fois, sans dire si elle l’était déjà', async () => {
    const first = await subscribe({ email: 'Lectrice@Oja.market' }).expect(201);
    const second = await subscribe().expect(201);
    expect(second.body).toEqual(first.body);

    const rows = await prisma.newsletterSubscriber.findMany({
      where: { email: 'lectrice@oja.market' },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ source: 'footer', unsubscribedAt: null });
  });

  it('réinscrit une adresse désinscrite', async () => {
    await subscribe().expect(201);
    await prisma.newsletterSubscriber.update({
      where: { email: 'lectrice@oja.market' },
      data: { unsubscribedAt: new Date() },
    });

    await subscribe().expect(201);

    const row = await prisma.newsletterSubscriber.findUniqueOrThrow({
      where: { email: 'lectrice@oja.market' },
    });
    expect(row.unsubscribedAt).toBeNull();
  });

  it('ignore en silence un robot pris au piège', async () => {
    await subscribe({ website: 'https://spam.example' }).expect(201);
    const count = await prisma.newsletterSubscriber.count({
      where: { email: 'lectrice@oja.market' },
    });
    expect(count).toBe(0);
  });

  it('refuse une adresse invalide', async () => {
    const refused = await subscribe({ email: 'pas-une-adresse' }).expect(400);
    const fields = refused.body.errors.map((e: { field: string }) => e.field);
    expect(fields).toContain('email');
  });
});
