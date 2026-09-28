import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
 * Téléversement de fichiers, contre un vrai MinIO.
 *
 * Le parcours réel en trois temps : l'API signe une autorisation, le fichier
 * part **directement** au stockage, puis la clé est rattachée à une fiche.
 * On l'exécute en entier — un test qui simulerait le stockage ne dirait rien
 * de ce que la signature autorise réellement.
 */

const MAKER = '+2250740000001';
const CUSTOMER = '+2250740000002';
const ADMIN = '+2250740000003';
const PASSWORD = 'un-mot-de-passe-solide';

/** Un PNG minimal valide — 1 pixel, quelques dizaines d'octets. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

describe('Téléversement (bout en bout)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  let makerCookies: string[];
  let customerCookies: string[];
  let adminCookies: string[];
  let productId: string;
  let makerId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    app.setGlobalPrefix('api/v1');
    app.use(cookieParser());
    app.useGlobalFilters(new ProblemFilter(), new DomainErrorFilter());
    await app.init();

    prisma = app.get(PrismaService);
    await resetTestData(prisma);

    const abidjan = await prisma.city.findFirstOrThrow({ where: { country: { isActive: true } } });
    const category = await prisma.category.findFirstOrThrow({ where: { slug: 'mobilier' } });

    adminCookies = await signUpAdmin();
    customerCookies = await signUp('CUSTOMER', 'client.upload@oja.market', CUSTOMER);
    makerCookies = await signUp('MAKER', 'atelier.upload@oja.market', MAKER);

    const profile = await api()
      .post('/api/v1/maker/profile')
      .set('Cookie', makerCookies)
      .send({
        shopName: 'Atelier Photo',
        cityId: abidjan.id,
        managerName: 'Responsable',
        contactPhone: '+2250799887766',
        contactEmail: 'atelier.upload@oja.market',
        postalAddress: 'Adresse postale',
        ifuNumber: 'IFU-TEST',
        pickupLine1: "Adresse de l'atelier",
        pickupLatitude: 5.36,
        pickupLongitude: -4.0083,
      })
      .expect(201);
    makerId = profile.body.id;

    await api().post('/api/v1/maker/kyc/submit').set('Cookie', makerCookies).expect(201);
    await api()
      .post(`/api/v1/admin/makers/${makerId}/review`)
      .set('Cookie', adminCookies)
      .send({ decision: 'APPROVE' })
      .expect(201);

    const product = await api()
      .post('/api/v1/maker/products')
      .set('Cookie', makerCookies)
      .send({
        name: 'Console Bassam',
        categoryId: category.id,
        description: 'Console en bois de teck, façonnée à la main dans notre atelier.',
        makerPriceXof: 95_000,
        isMadeToOrder: false,
        quantityAvailable: 3,
        weightGrams: 9_000,
        lengthMm: 1_100,
        widthMm: 350,
        heightMm: 800,
      })
      .expect(201);
    productId = product.body.id;
  }, 120_000);

  afterAll(async () => {
    await resetTestData(prisma);
    await app?.close();
  });

  const api = () => request(app.getHttpServer());

  async function signUp(role: string, email: string, phone: string): Promise<string[]> {
    /* L'inscription ouvre le compte ET la session : plus de code à saisir.
       La vérification par SMS reste disponible derrière REQUIRE_PHONE_VERIFICATION. */
    const response = await api()
      .post('/api/v1/auth/register')
      .send({
        role,
        firstName: 'Test',
        lastName: 'Utilisateur',
        email,
        phone,
        password: PASSWORD,
        acceptedTermsVersion: '2026-08',
      })
      .expect(201);

    return cookiesOf(response);
  }

  async function signUpAdmin(): Promise<string[]> {
    await signUp('CUSTOMER', 'admin.upload@oja.market', ADMIN);
    await prisma.user.update({
      where: { phone: ADMIN },
      data: { role: 'ADMIN', status: 'ACTIVE' },
    });
    const response = await api()
      .post('/api/v1/auth/login')
      .send({ identifier: 'admin.upload@oja.market', password: PASSWORD })
      .expect(200);
    return cookiesOf(response);
  }

  /** Le parcours réel : demander un ticket, puis envoyer au stockage. */
  async function upload(
    cookies: string[],
    purpose: string,
    body: Buffer = PNG,
    contentType = 'image/png',
  ): Promise<string> {
    const ticket = await api()
      .post('/api/v1/uploads/ticket')
      .set('Cookie', cookies)
      .send({ purpose, contentType, sizeBytes: body.length })
      .expect(201);

    const put = await fetch(ticket.body.uploadUrl, {
      method: 'PUT',
      headers: ticket.body.headers,
      body: new Uint8Array(body),
    });
    expect(put.ok).toBe(true);

    return ticket.body.fileKey;
  }

  describe('1 — autorisation d’envoi', () => {
    it('signe une URL et range la photo produit dans l’espace public', async () => {
      const response = await api()
        .post('/api/v1/uploads/ticket')
        .set('Cookie', makerCookies)
        .send({ purpose: 'product-image', contentType: 'image/png', sizeBytes: PNG.length })
        .expect(201);

      expect(response.body.uploadUrl).toContain('X-Amz-Signature');
      expect(response.body.fileKey).toMatch(/^public\/product-image\//);
      expect(response.body.publicUrl).not.toBeNull();
    });

    it('range une pièce d’identité dans l’espace privé, sans URL publique', async () => {
      const response = await api()
        .post('/api/v1/uploads/ticket')
        .set('Cookie', makerCookies)
        .send({ purpose: 'kyc-document', contentType: 'image/png', sizeBytes: PNG.length })
        .expect(201);

      expect(response.body.fileKey).toMatch(/^private\/kyc-document\//);
      // Une pièce d'identité derrière une adresse devinable, c'est une fuite
      // qui ne laisse aucune trace.
      expect(response.body.publicUrl).toBeNull();
    });

    it('refuse un format non prévu', async () => {
      const response = await api()
        .post('/api/v1/uploads/ticket')
        .set('Cookie', makerCookies)
        .send({ purpose: 'product-image', contentType: 'application/zip', sizeBytes: 1_000 })
        .expect(400);
      expect(response.body.detail).toContain('Format non accepté');
    });

    it('refuse un fichier trop lourd', async () => {
      const response = await api()
        .post('/api/v1/uploads/ticket')
        .set('Cookie', makerCookies)
        .send({ purpose: 'product-image', contentType: 'image/png', sizeBytes: 40 * 1024 * 1024 })
        .expect(400);
      expect(response.body.detail).toContain('trop lourd');
    });

    it('refuse à un client l’écriture dans l’espace des photos produit', async () => {
      // 404 et non 403 : on ne confirme pas l'existence d'une capacité à qui
      // n'y a pas droit.
      await api()
        .post('/api/v1/uploads/ticket')
        .set('Cookie', customerCookies)
        .send({ purpose: 'product-image', contentType: 'image/png', sizeBytes: 100 })
        .expect(404);
    });

    it('refuse une demande sans session', async () => {
      await api()
        .post('/api/v1/uploads/ticket')
        .send({ purpose: 'product-image', contentType: 'image/png', sizeBytes: 100 })
        .expect(401);
    });
  });

  describe('2 — photos de fiche produit', () => {
    it('refuse une clé qui ne correspond à aucun fichier reçu', async () => {
      // Sans ce contrôle, la fiche partirait en validation avec des images
      // fantômes.
      const response = await api()
        .post(`/api/v1/maker/products/${productId}/images`)
        .set('Cookie', makerCookies)
        .send({ fileKey: 'public/product-image/2026-01-01/inconnu/aaaa.png' })
        .expect(400);
      expect(response.body.detail).toContain("n'a pas été reçu");
    });

    it('rattache une photo réellement envoyée', async () => {
      const fileKey = await upload(makerCookies, 'product-image');

      const response = await api()
        .post(`/api/v1/maker/products/${productId}/images`)
        .set('Cookie', makerCookies)
        .send({ fileKey, alt: 'Console vue de face' })
        .expect(201);

      expect(response.body).toHaveLength(1);
      expect(response.body[0].url).toContain('oja-dev-public');
      expect(response.body[0].position).toBe(0);
    });

    it('la rend réellement lisible depuis le stockage', async () => {
      const images = await api()
        .get(`/api/v1/maker/products/${productId}/images`)
        .set('Cookie', makerCookies)
        .expect(200);

      const response = await fetch(images.body[0].url);
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('image/png');
    });

    it('bloque la mise en vente tant que les 3 photos ne sont pas là', async () => {
      const response = await api()
        .post(`/api/v1/maker/products/${productId}/submit`)
        .set('Cookie', makerCookies)
        .expect(400);
      expect(JSON.stringify(response.body.errors)).toContain('3 photos');
    });

    it('accepte le dépôt une fois les 3 photos en place', async () => {
      for (let index = 0; index < 2; index++) {
        const fileKey = await upload(makerCookies, 'product-image');
        await api()
          .post(`/api/v1/maker/products/${productId}/images`)
          .set('Cookie', makerCookies)
          .send({ fileKey })
          .expect(201);
      }

      const response = await api()
        .post(`/api/v1/maker/products/${productId}/submit`)
        .set('Cookie', makerCookies)
        .expect(201);
      expect(response.body.status).toBe('PENDING_REVIEW');
    });

    it('refuse une sixième photo au moment de l’ajout', async () => {
      // Refuser au moment de la mise en vente ferait perdre à l'artisan le
      // travail de téléversement.
      for (let index = 0; index < 2; index++) {
        const fileKey = await upload(makerCookies, 'product-image');
        await api()
          .post(`/api/v1/maker/products/${productId}/images`)
          .set('Cookie', makerCookies)
          .send({ fileKey })
          .expect(201);
      }

      const extra = await upload(makerCookies, 'product-image');
      const response = await api()
        .post(`/api/v1/maker/products/${productId}/images`)
        .set('Cookie', makerCookies)
        .send({ fileKey: extra })
        .expect(400);
      expect(response.body.detail).toContain('Cinq photos au maximum');
    });

    it('réorganise les photos', async () => {
      const before = await api()
        .get(`/api/v1/maker/products/${productId}/images`)
        .set('Cookie', makerCookies)
        .expect(200);

      const reversed = [...before.body].reverse().map((image: { id: string }) => image.id);

      const after = await api()
        .patch(`/api/v1/maker/products/${productId}/images/order`)
        .set('Cookie', makerCookies)
        .send({ imageIds: reversed })
        .expect(200);

      expect(after.body[0].id).toBe(reversed[0]);
      expect(after.body.map((i: { position: number }) => i.position)).toEqual([0, 1, 2, 3, 4]);
    });

    it('refuse une réorganisation partielle', async () => {
      const images = await api()
        .get(`/api/v1/maker/products/${productId}/images`)
        .set('Cookie', makerCookies)
        .expect(200);

      // Une liste partielle laisserait des photos sans position définie, et la
      // vignette deviendrait arbitraire.
      await api()
        .patch(`/api/v1/maker/products/${productId}/images/order`)
        .set('Cookie', makerCookies)
        .send({ imageIds: [images.body[0].id] })
        .expect(400);
    });

    it('resserre les positions à la suppression', async () => {
      const images = await api()
        .get(`/api/v1/maker/products/${productId}/images`)
        .set('Cookie', makerCookies)
        .expect(200);

      const response = await api()
        .delete(`/api/v1/maker/products/${productId}/images/${images.body[1].id}`)
        .set('Cookie', makerCookies)
        .expect(200);

      // Pas de trou : 0, 1, 2, 3 et non 0, 2, 3, 4.
      expect(response.body.map((i: { position: number }) => i.position)).toEqual([0, 1, 2, 3]);
    });

    it('empêche un créateur de toucher les photos d’un confrère', async () => {
      const other = await signUp('MAKER', 'autre.upload@oja.market', '+2250740000009');
      await api()
        .get(`/api/v1/maker/products/${productId}/images`)
        .set('Cookie', other)
        .expect(404); // pas 403
    });
  });

  describe('3 — pièces justificatives', () => {
    it('accepte une pièce déposée dans l’espace privé', async () => {
      const fileKey = await upload(makerCookies, 'kyc-document');

      const response = await api()
        .post('/api/v1/maker/kyc/documents')
        .set('Cookie', makerCookies)
        .send({ fileKey, type: 'cni_recto' })
        .expect(201);

      expect(response.body).toHaveLength(1);
      expect(response.body[0].type).toBe('cni_recto');
      // Le déposant ne relit pas ses pièces : il sait ce qu'il a envoyé.
      expect(response.body[0].url).toBeUndefined();
    });

    it('refuse une pièce envoyée dans l’espace public', async () => {
      const fileKey = await upload(makerCookies, 'product-image');

      const response = await api()
        .post('/api/v1/maker/kyc/documents')
        .set('Cookie', makerCookies)
        .send({ fileKey, type: 'rccm' })
        .expect(400);
      expect(response.body.detail).toContain('mauvais espace');
    });

    it('remplace une pièce du même type plutôt que d’empiler', async () => {
      const fileKey = await upload(makerCookies, 'kyc-document');
      const response = await api()
        .post('/api/v1/maker/kyc/documents')
        .set('Cookie', makerCookies)
        .send({ fileKey, type: 'cni_recto' })
        .expect(201);

      // On ne veut pas trois CNI recto.
      expect(response.body.filter((d: { type: string }) => d.type === 'cni_recto')).toHaveLength(1);
    });

    it('délivre à l’administration une URL de lecture qui fonctionne', async () => {
      const response = await api()
        .get(`/api/v1/admin/makers/${makerId}/documents`)
        .set('Cookie', adminCookies)
        .expect(200);

      expect(response.body[0].url).toContain('X-Amz-Signature');

      const file = await fetch(response.body[0].url);
      expect(file.status).toBe(200);
    });

    it('ne délivre cette URL à personne d’autre', async () => {
      await api()
        .get(`/api/v1/admin/makers/${makerId}/documents`)
        .set('Cookie', makerCookies)
        .expect(404); // pas 403
    });

    it('rend le fichier privé illisible sans signature', async () => {
      const documents = await prisma.kycDocument.findMany({ where: { makerId } });
      const key = documents[0]?.fileKey;
      expect(key).toBeDefined();

      /* En dur sur les valeurs du dev local (docker-compose.yml), ce test
         échouait toujours en CI : S3_ENDPOINT et S3_BUCKET-private y valent
         autre chose (localhost:9000, oja-ci-private). On relit la config
         réellement chargée plutôt qu'un couple hôte/compartiment figé. */
      const config = app.get(ConfigService);
      const endpoint = config.getOrThrow<string>('S3_ENDPOINT');
      const privateBucket = `${config.getOrThrow<string>('S3_BUCKET')}-private`;
      const direct = await fetch(`${endpoint}/${privateBucket}/${key}`);
      // Le seau privé n'autorise aucune lecture anonyme.
      expect(direct.status).toBeGreaterThanOrEqual(400);
    });
  });
});

function cookiesOf(response: request.Response): string[] {
  const raw = response.headers['set-cookie'];
  if (!raw) return [];
  return Array.isArray(raw) ? raw : [raw];
}
