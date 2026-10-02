/**
 * Jeu de démonstration.
 *
 * Contrairement au seed — qui charge des données de référence indispensables —
 * ceci crée un atelier validé et quelques pièces publiées, de quoi voir
 * tourner la vitrine. À ne jamais exécuter en production : le garde-fou est en
 * tête de fichier.
 */

import { PrismaClient } from '../generated/client';

const prisma = new PrismaClient();

if (process.env['NODE_ENV'] === 'production') {
  console.error('Le jeu de démonstration est refusé en production.');
  process.exit(1);
}

/* Les visuels existants du dépôt : les fiches ont de vraies photos plutôt que
   des rectangles gris. */
const PIECES = [
  {
    slug: 'fauteuil-galbe-lagune',
    name: 'Fauteuil galbé Lagune',
    category: 'mobilier',
    material: 'Iroko sculpté',
    description:
      "Fauteuil sculpté à la main dans un bloc d'iroko massif, finition à l'huile de lin. Chaque pièce présente de légères variations qui font son unicité.",
    makerPriceXof: 168_000,
    images: ['/images/bundle-1.png', '/images/listing-thumb-1.png', '/images/listing-thumb-2.png'],
    weightGrams: 18_000,
    lengthMm: 900,
    widthMm: 750,
    heightMm: 800,
    quantityAvailable: 4,
  },
  {
    slug: 'lampe-globe-sahel',
    name: 'Lampe globe Sahel',
    category: 'luminaires',
    material: 'Laiton recyclé',
    description:
      'Globe lumineux monté sur pied de laiton recyclé, patiné à la main. Diffuse une lumière chaude et rasante.',
    makerPriceXof: 52_000,
    images: ['/images/bundle-2.png', '/images/listing-thumb-3.png', '/images/bundle-3.png'],
    weightGrams: 3_200,
    lengthMm: 280,
    widthMm: 280,
    heightMm: 400,
    quantityAvailable: 9,
  },
  {
    slug: 'nappe-tissee-korhogo',
    name: 'Nappe tissée de Korhogo',
    category: 'textile',
    material: 'Lin tissé main',
    description:
      "Nappe tissée au métier traditionnel, en lin écru. Les motifs sont repris d'un répertoire transmis depuis trois générations.",
    makerPriceXof: 28_000,
    images: ['/images/order-item-2.png', '/images/home-thumb-1.png', '/images/home-hero-fabric.png'],
    weightGrams: 900,
    lengthMm: 400,
    widthMm: 300,
    heightMm: 80,
    quantityAvailable: 15,
    isMadeToOrder: true,
    leadTimeDays: 12,
  },
  {
    slug: 'tapis-jute-natte',
    name: 'Tapis en jute natté',
    category: 'decoration',
    material: 'Jute tressé',
    description:
      'Tapis de jute natté à la main, tressage serré. Robuste, il se patine sans se déformer.',
    makerPriceXof: 45_000,
    images: ['/images/order-item-3.png', '/images/listing-thumb-4.png', '/images/home-thumb-2.png'],
    weightGrams: 7_500,
    lengthMm: 1_600,
    widthMm: 300,
    heightMm: 300,
    quantityAvailable: 6,
  },
];

async function main() {
  // Cotonou : le seul pays actif pour le moment est le Bénin, la démo doit
  // rester dans ce périmètre pour qu'on la voie effectivement depuis le site.
  const cotonou = await prisma.city.findFirstOrThrow({ where: { name: 'Cotonou' } });

  const user = await prisma.user.upsert({
    where: { email: 'demo.atelier@oja.market' },
    update: {},
    create: {
      role: 'MAKER',
      status: 'ACTIVE',
      email: 'demo.atelier@oja.market',
      phone: '+2290100000001',
      // Mot de passe : « demonstration-oja » — jeu de démonstration uniquement.
      passwordHash:
        '$argon2id$v=19$m=65536,t=3,p=4$ZGVtb25zdHJhdGlvbg$8Z0lPWQ1v5rJmDqXqYQ8xZ1lPmYQ',
      firstName: 'Awa',
      lastName: 'Koné',
      phoneVerifiedAt: new Date(),
    },
  });

  const maker = await prisma.makerProfile.upsert({
    where: { userId: user.id },
    update: { kycStatus: 'APPROVED' },
    create: {
      userId: user.id,
      shopName: 'Atelier Sènou',
      slug: 'atelier-senou',
      description:
        'Menuiserie fine et tissage, à Akpakpa. Trois générations de savoir-faire, des matières locales et des finitions patientes.',
      cityId: cotonou.id,
      managerName: 'Awa Koné',
      contactPhone: '+2290199887766',
      contactEmail: 'contact@ateliersenou.bj',
      postalAddress: 'Rue des Artisans, Akpakpa',
      ifuNumber: 'IFU-DEMO-001',
      rccmNumber: 'BJ-COT-2026-B-0001',
      pickupLine1: 'Atelier, 12 rue des Menuisiers, Akpakpa',
      pickupLandmark: 'En face de la pharmacie',
      pickupLatitude: 6.37,
      pickupLongitude: 2.42,
      kycStatus: 'APPROVED',
      kycSubmittedAt: new Date(),
      kycReviewedAt: new Date(),
    },
  });

  for (const piece of PIECES) {
    const category = await prisma.category.findFirstOrThrow({
      where: { slug: piece.category },
    });

    const product = await prisma.product.upsert({
      where: { slug: piece.slug },
      update: { status: 'PUBLISHED', hiddenAt: null, deletedAt: null },
      create: {
        slug: piece.slug,
        makerId: maker.id,
        categoryId: category.id,
        name: piece.name,
        description: piece.description,
        material: piece.material,
        makerPriceXof: piece.makerPriceXof,
        quantityAvailable: piece.quantityAvailable,
        isMadeToOrder: piece.isMadeToOrder ?? false,
        leadTimeDays: piece.leadTimeDays ?? null,
        weightGrams: piece.weightGrams,
        lengthMm: piece.lengthMm,
        widthMm: piece.widthMm,
        heightMm: piece.heightMm,
        status: 'PUBLISHED',
        reviewedAt: new Date(),
      },
    });

    /* Trois photos au minimum, comme l'exige la mise en vente (L1) : une
       démo publiée avec une seule photo contredirait la règle qu'elle montre.
       On complète les fiches existantes sans dupliquer ce qui y est déjà. */
    const existing = await prisma.productImage.count({ where: { productId: product.id } });
    if (existing < piece.images.length) {
      await prisma.productImage.createMany({
        data: piece.images.slice(existing).map((url, index) => ({
          productId: product.id,
          fileKey: url,
          position: existing + index,
        })),
      });
    }
  }

  console.table({
    atelier: maker.shopName,
    pièces: await prisma.product.count({ where: { makerId: maker.id, status: 'PUBLISHED' } }),
  });
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
