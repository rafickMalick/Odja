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
 * Parcours d'un apprenti (cahier des évolutions, phase 2) : choix du statut,
 * formation, justificatif, validation par l'administration, profil public
 * qui présente honnêtement son niveau.
 */

const APPRENTICE_EMAIL = 'apprenti.designer@oja.market';
const APPRENTICE_PHONE = '+2250790000201';
const ADMIN_EMAIL = 'apprenti.admin@oja.market';
const ADMIN_PHONE = '+2250790000202';
const PASSWORD = 'un-mot-de-passe-solide';

describe('Apprentis (bout en bout)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let apprenticeCookies: string[];
  let adminCookies: string[];
  let makerId: string;
  let cityId: string;

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

    apprenticeCookies = await signUp('MAKER', APPRENTICE_EMAIL, APPRENTICE_PHONE);
    await signUp('CUSTOMER', ADMIN_EMAIL, ADMIN_PHONE);
    await prisma.user.update({ where: { email: ADMIN_EMAIL }, data: { role: 'ADMIN', status: 'ACTIVE' } });
    adminCookies = cookiesOf(
      await api()
        .post('/api/v1/auth/login')
        .send({ identifier: ADMIN_EMAIL, password: PASSWORD })
        .expect(200),
    );
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
          firstName: 'Kossi',
          lastName: 'Apprenti',
          email,
          phone,
          password: PASSWORD,
          acceptedTermsVersion: '2026-08',
        })
        .expect(201),
    );
  }

  it('ouvre un profil d’apprenti designer, sans IFU ni RCCM', async () => {
    const response = await api()
      .post('/api/v1/maker/profile')
      .set('Cookie', apprenticeCookies)
      .send({
        shopName: 'Kossi Design',
        cityId,
        managerName: 'Kossi Agbo',
        contactPhone: '+22997000201',
        contactEmail: 'kossi@exemple.bj',
        postalAddress: 'Cotonou',
        pickupLine1: 'Chez mes parents, Fidjrossè',
        creatorKind: 'APPRENTICE_DESIGNER',
        trainingInstitution: 'École de design de Cotonou',
        trainingSpecialty: 'Design produit',
        trainingLevel: 'Deuxième année',
      })
      .expect(201);

    makerId = response.body.id;
    expect(response.body.creatorKind).toBe('APPRENTICE_DESIGNER');
    expect(response.body.plan.code).toBe('standard');
  });

  it('exige le justificatif de formation, et lui seul', async () => {
    const response = await api()
      .post('/api/v1/maker/kyc/submit')
      .set('Cookie', apprenticeCookies)
      .expect(400);

    const message = response.body.detail ?? response.body.message;
    expect(message).toContain('justificatif de formation');
    expect(message).not.toContain('IFU');
  });

  it('accepte le dossier une fois le justificatif déposé', async () => {
    /* L'envoi réel passe par le stockage ; on dépose la pièce en base, comme
       le ferait la route une fois le fichier vérifié. */
    await prisma.kycDocument.create({
      data: { makerId, type: 'justificatif_formation', fileKey: 'private/kyc-document/test/carte.pdf' },
    });

    await api().post('/api/v1/maker/kyc/submit').set('Cookie', apprenticeCookies).expect(201);

    const adminAlert = await prisma.notification.findFirst({
      where: { template: 'admin_notice', user: { email: ADMIN_EMAIL } },
    });
    expect(adminAlert).not.toBeNull();
  });

  it('range le dossier parmi les apprentis, à part des professionnels', async () => {
    const apprentices = await api()
      .get('/api/v1/admin/makers')
      .query({ status: 'PENDING', profile: 'apprentis' })
      .set('Cookie', adminCookies)
      .expect(200);
    expect(apprentices.body.map((maker: { id: string }) => maker.id)).toContain(makerId);

    const professionals = await api()
      .get('/api/v1/admin/makers')
      .query({ status: 'PENDING', profile: 'professionnels' })
      .set('Cookie', adminCookies)
      .expect(200);
    expect(professionals.body.map((maker: { id: string }) => maker.id)).not.toContain(makerId);
  });

  it('prévient l’apprenti quand une pièce complémentaire est demandée', async () => {
    await api()
      .post(`/api/v1/admin/makers/${makerId}/request-document`)
      .set('Cookie', adminCookies)
      .send({ message: 'Le certificat de scolarité de cette année.' })
      .expect(201);

    const notice = await prisma.notification.findFirst({
      where: { template: 'creator_notice', user: { email: APPRENTICE_EMAIL }, channel: 'inapp' },
      orderBy: { createdAt: 'desc' },
    });
    expect(JSON.stringify(notice?.payload)).toContain('certificat de scolarité');
  });

  it('présente honnêtement l’apprenti une fois validé, sans son justificatif', async () => {
    await api()
      .post(`/api/v1/admin/makers/${makerId}/review`)
      .set('Cookie', adminCookies)
      .send({ decision: 'APPROVE' })
      .expect(201);

    const response = await api().get('/api/v1/makers/kossi-design').expect(200);
    expect(response.body.creatorKind).toBe('APPRENTICE_DESIGNER');
    expect(response.body.training).toEqual({
      institution: 'École de design de Cotonou',
      specialty: 'Design produit',
      level: 'Deuxième année',
    });
    expect(JSON.stringify(response.body)).not.toContain('carte.pdf');
  });

  it('renvoie en validation un apprenti qui se déclare professionnel', async () => {
    const response = await api()
      .patch('/api/v1/maker/profile')
      .set('Cookie', apprenticeCookies)
      .send({ creatorKind: 'DESIGNER' })
      .expect(200);
    expect(response.body.kycStatus).toBe('PENDING');
  });
});

function cookiesOf(response: request.Response): string[] {
  const raw = response.headers['set-cookie'];
  if (!raw) return [];
  return Array.isArray(raw) ? raw : [raw];
}
