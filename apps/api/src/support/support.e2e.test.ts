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
 * Service client, contre une vraie base.
 *
 * Ce qui ne doit jamais casser : chacun ne voit que ses demandes, et une note
 * interne ne sort jamais vers le client.
 */

const PASSWORD = 'un-mot-de-passe-solide';

describe('Service client (bout en bout)', () => {
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
    role: 'CUSTOMER' | 'MAKER' | 'COURIER' = 'CUSTOMER',
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

  async function admin(): Promise<string[]> {
    await register('support.admin@oja.market', '+2290190000300');
    await prisma.user.update({
      where: { email: 'support.admin@oja.market' },
      data: { role: 'ADMIN', status: 'ACTIVE' },
    });
    const response = await api()
      .post('/api/v1/auth/login')
      .send({ identifier: 'support.admin@oja.market', password: PASSWORD })
      .expect(200);
    return cookiesOf(response);
  }

  const openTicket = (cookies: string[], over: Record<string, unknown> = {}) =>
    api()
      .post('/api/v1/support/tickets')
      .set('Cookie', cookies)
      .send({
        category: 'livraison',
        subject: 'Colis en retard',
        message: 'Ma commande devait arriver hier, je n’ai aucune nouvelle.',
        ...over,
      });

  it('ouvre une demande avec une référence, visible dans « Mes demandes »', async () => {
    const buyer = await register('acheteur@oja.market', '+2290190000301');

    const created = await openTicket(buyer).expect(201);
    expect(created.body.reference).toMatch(/^SUP-\d{4}-\d{6}$/);
    expect(created.body.status).toBe('OPEN');
    expect(created.body.categoryLabel).toBe('Livraison');
    expect(created.body.messages).toHaveLength(1);

    const list = await api().get('/api/v1/support/tickets').set('Cookie', buyer).expect(200);
    expect(list.body.map((t: { reference: string }) => t.reference)).toEqual([
      created.body.reference,
    ]);

    const filtered = await api()
      .get('/api/v1/support/tickets?status=RESOLVED')
      .set('Cookie', buyer)
      .expect(200);
    expect(filtered.body).toHaveLength(0);
  });

  it('propose des types de problème propres à chaque espace', async () => {
    const buyer = await register('acheteur@oja.market', '+2290190000302');
    const maker = await register('createur@oja.market', '+2290190000303', 'MAKER');

    const buyerTypes = await api()
      .get('/api/v1/support/tickets/categories')
      .set('Cookie', buyer)
      .expect(200);
    const makerTypes = await api()
      .get('/api/v1/support/tickets/categories')
      .set('Cookie', maker)
      .expect(200);
    expect(Object.keys(buyerTypes.body)).toContain('remboursement');
    expect(Object.keys(makerTypes.body)).toContain('paiements_retraits');

    // Un type d'acheteur est refusé à un créateur.
    await openTicket(maker, { category: 'remboursement' }).expect(400);
    await openTicket(maker, { category: 'paiements_retraits' }).expect(201);
  });

  it('ne montre jamais la demande d’un autre', async () => {
    const awa = await register('acheteur@oja.market', '+2290190000304');
    const other = await register('autre@oja.market', '+2290190000305');
    const { body } = await openTicket(awa).expect(201);

    // 404 et non 403 : un refus confirmerait que la référence existe.
    await api().get(`/api/v1/support/tickets/${body.reference}`).set('Cookie', other).expect(404);
    await api()
      .post(`/api/v1/support/tickets/${body.reference}/messages`)
      .set('Cookie', other)
      .send({ body: 'Je m’invite' })
      .expect(404);
    const list = await api().get('/api/v1/support/tickets').set('Cookie', other).expect(200);
    expect(list.body).toHaveLength(0);
  });

  it('refuse de rattacher la commande d’un autre', async () => {
    const buyer = await register('acheteur@oja.market', '+2290190000306');
    await openTicket(buyer, { orderReference: 'CMD-2026-999999' }).expect(400);
  });

  it('déroule un échange : réponse, attente, relance, résolution', async () => {
    const buyer = await register('acheteur@oja.market', '+2290190000307');
    const staff = await admin();
    const { body: ticket } = await openTicket(buyer).expect(201);
    const ref = ticket.reference as string;

    // Note interne : invisible du client, sans effet sur le statut.
    await api()
      .post(`/api/v1/admin/support/tickets/${ref}/messages`)
      .set('Cookie', staff)
      .send({ body: 'Vérifier avec le livreur avant de répondre.', internal: true })
      .expect(201);

    // Réponse publique : la balle passe au client.
    const replied = await api()
      .post(`/api/v1/admin/support/tickets/${ref}/messages`)
      .set('Cookie', staff)
      .send({ body: 'Votre colis part demain matin. Pouvez-vous confirmer l’adresse ?' })
      .expect(201);
    expect(replied.body.status).toBe('WAITING_CUSTOMER');
    expect(replied.body.messages).toHaveLength(3);

    const seen = await api().get(`/api/v1/support/tickets/${ref}`).set('Cookie', buyer).expect(200);
    expect(seen.body.status).toBe('WAITING_CUSTOMER');
    expect(seen.body.messages).toHaveLength(2);
    expect(JSON.stringify(seen.body)).not.toContain('Vérifier avec le livreur');

    // Le client répond : la demande revient à l'équipe.
    const answered = await api()
      .post(`/api/v1/support/tickets/${ref}/messages`)
      .set('Cookie', buyer)
      .send({ body: 'Oui, même adresse.' })
      .expect(201);
    expect(answered.body.status).toBe('OPEN');

    // Résolution, puis fermeture : plus de réponse possible.
    await api()
      .patch(`/api/v1/admin/support/tickets/${ref}`)
      .set('Cookie', staff)
      .send({ status: 'CLOSED', priority: 'HIGH' })
      .expect(200);
    await api()
      .post(`/api/v1/support/tickets/${ref}/messages`)
      .set('Cookie', buyer)
      .send({ body: 'Encore une chose' })
      .expect(400);

    // Avis in-app au client : réponse puis changement de statut.
    await waitFor(async () => {
      const notes = await prisma.notification.findMany({
        where: { user: { email: 'acheteur@oja.market' }, channel: 'inapp' },
        select: { template: true },
      });
      const templates = notes.map((note) => note.template);
      return templates.includes('support_reply') && templates.includes('support_status_changed');
    });
  });

  it('filtre et recherche dans la file du service client', async () => {
    const buyer = await register('acheteur@oja.market', '+2290190000308');
    const maker = await register('createur@oja.market', '+2290190000309', 'MAKER');
    const staff = await admin();
    await openTicket(buyer, { subject: 'Remboursement attendu', category: 'remboursement' });
    await openTicket(maker, { subject: 'Retrait bloqué', category: 'paiements_retraits' });

    const all = await api().get('/api/v1/admin/support/tickets').set('Cookie', staff).expect(200);
    expect(all.body).toHaveLength(2);

    const makers = await api()
      .get('/api/v1/admin/support/tickets?role=MAKER')
      .set('Cookie', staff)
      .expect(200);
    expect(makers.body.map((t: { subject: string }) => t.subject)).toEqual(['Retrait bloqué']);

    const search = await api()
      .get('/api/v1/admin/support/tickets?q=rembours')
      .set('Cookie', staff)
      .expect(200);
    expect(search.body).toHaveLength(1);

    const pending = await api()
      .get('/api/v1/admin/support/tickets/pending-count')
      .set('Cookie', staff)
      .expect(200);
    expect(pending.body.count).toBe(2);
  });

  describe('pièces jointes', () => {
    it('refuse de joindre le fichier d’un autre compte, ou d’un autre usage', async () => {
      const buyer = await register('acheteur@oja.market', '+2290190000313');
      const someoneElse = 'private/support-attachment/2026-10-02/autre-compte/abcdef.png';
      const kycOfMine = 'private/kyc-document/2026-10-02/moi/abcdef.png';

      await openTicket(buyer, { fileKeys: [someoneElse] }).expect(400);
      await openTicket(buyer, { fileKeys: [kycOfMine] }).expect(400);
      await openTicket(buyer, { fileKeys: ['../../etc/passwd'] }).expect(400);
    });

    it('ne donne pas de lien pour une pièce absente de ma demande', async () => {
      const buyer = await register('acheteur@oja.market', '+2290190000314');
      const { body } = await openTicket(buyer).expect(201);

      await api()
        .get(
          `/api/v1/support/tickets/${body.reference}/attachment?key=${encodeURIComponent(
            'private/kyc-document/2026-10-02/x/piece-identite.png',
          )}`,
        )
        .set('Cookie', buyer)
        .expect(404);
    });
  });

  describe('formulaire de contact public', () => {
    const contact = (over: Record<string, unknown> = {}) =>
      api()
        .post('/api/v1/contact')
        .send({
          name: 'Jean Dossou',
          email: 'visiteur@oja.market',
          category: 'partenariat',
          message: 'Je représente une coopérative de potiers, comment vous rejoindre ?',
          website: '',
          ...over,
        });

    it('crée une demande « visiteur » dans la file, avec une référence', async () => {
      const staff = await admin();

      const sent = await contact().expect(201);
      expect(sent.body.reference).toMatch(/^SUP-\d{4}-\d{6}$/);

      const queue = await api()
        .get('/api/v1/admin/support/tickets?role=GUEST')
        .set('Cookie', staff)
        .expect(200);
      expect(queue.body).toHaveLength(1);
      expect(queue.body[0]).toMatchObject({
        reference: sent.body.reference,
        channel: 'CONTACT_FORM',
        isGuest: true,
        authorName: 'Jean Dossou',
        authorEmail: 'visiteur@oja.market',
        categoryLabel: 'Partenariat',
      });
    });

    it('rattache la demande au compte dont l’adresse correspond', async () => {
      const buyer = await register('acheteur@oja.market', '+2290190000312');

      await contact({ email: 'Acheteur@Oja.market' }).expect(201);

      const mine = await api().get('/api/v1/support/tickets').set('Cookie', buyer).expect(200);
      expect(mine.body).toHaveLength(1);
      expect(mine.body[0].categoryLabel).toBe('Partenariat');
    });

    it('ignore en silence un robot pris au piège', async () => {
      const sent = await contact({ website: 'https://spam.example' }).expect(201);
      expect(sent.body.reference).toBeNull();
      const count = await prisma.supportTicket.count({
        where: { guestEmail: 'visiteur@oja.market' },
      });
      expect(count).toBe(0);
    });

    it('refuse un sujet hors liste et un message vide', async () => {
      const refused = await contact({ category: 'livraison', message: '' }).expect(400);
      const fields = refused.body.errors.map((e: { field: string }) => e.field);
      expect(fields).toEqual(expect.arrayContaining(['category', 'message']));
    });
  });

  it('reste fermé aux autres rôles', async () => {
    const courier = await register('livreur@oja.market', '+2290190000310', 'COURIER');
    const buyer = await register('acheteur@oja.market', '+2290190000311');

    await api().get('/api/v1/support/tickets').set('Cookie', courier).expect(404);
    await api().get('/api/v1/admin/support/tickets').set('Cookie', buyer).expect(404);
  });
});

function cookiesOf(response: request.Response): string[] {
  const raw = response.headers['set-cookie'] as unknown as string[] | string | undefined;
  if (!raw) return [];
  return (Array.isArray(raw) ? raw : [raw]).map((cookie) => cookie.split(';')[0]!);
}

/** Les avis partent sans être attendus : on patiente un peu avant de lire.
    15 s : dans la suite complète, la base est chargée par les autres fichiers. */
async function waitFor(check: () => Promise<boolean>, timeoutMs = 15_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Condition non atteinte dans le délai');
}
