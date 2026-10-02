/**
 * Jeu de départ — données de référence, pas des données de démonstration.
 *
 * Tout ce qui est ici est nécessaire au fonctionnement de l'application :
 * pays, villes, catégories du cahier client, grilles tarifaires des véhicules
 * et moyens de paiement. Le seed est **idempotent** : on peut le rejouer
 * autant de fois qu'on veut sans dupliquer une ligne.
 */

import { PrismaClient, type VehicleType } from '../generated/client';

const prisma = new PrismaClient();

/* ── Pays de la zone UEMOA ────────────────────────────────────────────
   Seul le Bénin est actif pour le moment — c'est le pays sur lequel porte le
   lancement. Les sept autres restent structurellement prêts (villes, grilles
   tarifaires) et s'ouvrent en basculant `isActive`, sans déploiement de code
   (cahier § 13). La TVA reste à 0 tant que la décision fiscale n'est pas prise. */
const COUNTRIES = [
  { iso2: 'CI', name: "Côte d'Ivoire", callingCode: '+225', isActive: false },
  { iso2: 'BJ', name: 'Bénin', callingCode: '+229', isActive: true },
  { iso2: 'SN', name: 'Sénégal', callingCode: '+221', isActive: false },
  { iso2: 'TG', name: 'Togo', callingCode: '+228', isActive: false },
  { iso2: 'BF', name: 'Burkina Faso', callingCode: '+226', isActive: false },
  { iso2: 'ML', name: 'Mali', callingCode: '+223', isActive: false },
  { iso2: 'NE', name: 'Niger', callingCode: '+227', isActive: false },
  { iso2: 'GW', name: 'Guinée-Bissau', callingCode: '+245', isActive: false },
];

/* Coordonnées des chefs-lieux : elles servent de repli au calcul de distance
   quand un client n'a pas posé de point GPS précis. */
const CITIES: Record<string, { name: string; lat: number; lng: number }[]> = {
  CI: [
    { name: 'Abidjan', lat: 5.36, lng: -4.0083 },
    { name: 'Bouaké', lat: 7.6906, lng: -5.03 },
    { name: 'Yamoussoukro', lat: 6.8276, lng: -5.2893 },
    { name: 'Korhogo', lat: 9.4578, lng: -5.6294 },
    { name: 'San-Pédro', lat: 4.7485, lng: -6.6363 },
    { name: 'Daloa', lat: 6.877, lng: -6.4502 },
  ],
  BJ: [
    { name: 'Cotonou', lat: 6.3703, lng: 2.3912 },
    { name: 'Porto-Novo', lat: 6.4969, lng: 2.6289 },
    { name: 'Abomey-Calavi', lat: 6.4489, lng: 2.3556 },
    { name: 'Parakou', lat: 9.3372, lng: 2.6303 },
    { name: 'Bohicon', lat: 7.1781, lng: 2.0667 },
    { name: 'Abomey', lat: 7.1826, lng: 1.9911 },
  ],
  SN: [
    { name: 'Dakar', lat: 14.7167, lng: -17.4677 },
    { name: 'Thiès', lat: 14.7886, lng: -16.9246 },
  ],
  TG: [
    { name: 'Lomé', lat: 6.1319, lng: 1.2228 },
    { name: 'Kpalimé', lat: 6.9, lng: 0.6333 },
  ],
  BF: [
    { name: 'Ouagadougou', lat: 12.3714, lng: -1.5197 },
    { name: 'Bobo-Dioulasso', lat: 11.1771, lng: -4.2979 },
  ],
  ML: [{ name: 'Bamako', lat: 12.6392, lng: -8.0029 }],
  NE: [{ name: 'Niamey', lat: 13.5116, lng: 2.1254 }],
  GW: [{ name: 'Bissau', lat: 11.8817, lng: -15.6178 }],
};

/* Les catégories nommées par le cahier client. */
const CATEGORIES = [
  { slug: 'mobilier', name: 'Mobilier' },
  { slug: 'luminaires', name: 'Luminaires' },
  { slug: 'decoration', name: 'Décoration' },
  { slug: 'objets-art', name: "Objets d'art" },
  { slug: 'tableaux', name: 'Tableaux' },
  { slug: 'ceramique', name: 'Céramique' },
  { slug: 'textile', name: 'Textile' },
  { slug: 'cuisine', name: 'Cuisine' },
];

/* Grille tarifaire et capacités des trois véhicules du cahier client.
   Ces valeurs sont des points de départ plausibles : elles devront être
   recalées sur les premières courses réelles. */
const VEHICLE_RATES: {
  vehicle: VehicleType;
  baseFeeXof: number;
  perKmXof: number;
  minFeeXof: number;
  maxWeightKg: number;
  maxVolumeL: number;
  maxLengthCm: number;
}[] = [
  {
    vehicle: 'MOTO',
    baseFeeXof: 1_000,
    perKmXof: 150,
    minFeeXof: 1_000,
    maxWeightKg: 30,
    maxVolumeL: 80,
    maxLengthCm: 80,
  },
  {
    vehicle: 'TRICYCLE',
    baseFeeXof: 2_500,
    perKmXof: 120,
    minFeeXof: 2_500,
    maxWeightKg: 250,
    maxVolumeL: 900,
    maxLengthCm: 200,
  },
  {
    vehicle: 'CAMIONNETTE',
    baseFeeXof: 6_000,
    perKmXof: 250,
    minFeeXof: 6_000,
    maxWeightKg: 1_200,
    maxVolumeL: 6_000,
    maxLengthCm: 320,
  },
];

/* Moyens de paiement par pays. Le virement bancaire n'est pas ouvert en
   Phase 1 : il n'est pas confirmable en temps réel (SPEC-ALIGNEMENT § 9-E). */
const PAYMENT_METHODS: Record<
  string,
  { channel: 'MOBILE_MONEY' | 'CARD'; operator: string; label: string; feeBps: number }[]
> = {
  CI: [
    { channel: 'MOBILE_MONEY', operator: 'wave', label: 'Wave', feeBps: 230 },
    { channel: 'MOBILE_MONEY', operator: 'orange', label: 'Orange Money', feeBps: 230 },
    { channel: 'MOBILE_MONEY', operator: 'mtn', label: 'MTN MoMo', feeBps: 230 },
    { channel: 'MOBILE_MONEY', operator: 'moov', label: 'Moov Money', feeBps: 230 },
    // Chaîne vide, jamais null : voir le commentaire du champ dans le schéma.
    { channel: 'CARD', operator: '', label: 'Carte bancaire', feeBps: 450 },
  ],
  /* Les deux opérateurs Mobile Money réellement présents au Bénin — ni
     Wave ni Orange n'y opèrent, contrairement à la Côte d'Ivoire. */
  BJ: [
    { channel: 'MOBILE_MONEY', operator: 'mtn', label: 'MTN MoMo', feeBps: 230 },
    { channel: 'MOBILE_MONEY', operator: 'moov', label: 'Moov Money', feeBps: 230 },
    { channel: 'CARD', operator: '', label: 'Carte bancaire', feeBps: 450 },
  ],
};

/* Comptes du grand livre qui n'appartiennent à personne : ils existent dès le
   premier encaissement, autant les créer maintenant. */
const PLATFORM_ACCOUNTS = ['PLATFORM_CASH', 'PLATFORM_REVENUE', 'PSP_FEE', 'VAT_PAYABLE'] as const;

async function main() {
  /* `--if-empty` : mode du démarrage en production (docker-entrypoint.sh).
     Le seed remet `isActive` et les grilles aux valeurs du fichier ; rejoué à
     chaque démarrage, il refermerait un pays que l'admin vient d'ouvrir. Il
     ne remplit donc qu'une base qui n'a encore aucun pays. */
  if (process.argv.includes('--if-empty')) {
    const countries = await prisma.country.count();
    if (countries > 0) {
      console.log(`Données de référence déjà présentes (${countries} pays) : seed ignoré.`);
      return;
    }
    console.log('Base vide : chargement des données de référence.');
  }

  console.log('→ Pays et villes');
  for (const country of COUNTRIES) {
    /* `isActive` doit être mis à jour au même titre que le reste : c'est le
       seul terrain qui permet d'ouvrir ou de fermer un pays sans déploiement
       (cahier § 13). L'oublier ici viderait ce principe de son sens — rejouer
       le seed ne ferait jamais basculer un pays déjà présent. */
    const saved = await prisma.country.upsert({
      where: { iso2: country.iso2 },
      update: {
        name: country.name,
        callingCode: country.callingCode,
        isActive: country.isActive,
      },
      create: country,
    });

    for (const city of CITIES[country.iso2] ?? []) {
      await prisma.city.upsert({
        where: { countryId_name: { countryId: saved.id, name: city.name } },
        update: { latitude: city.lat, longitude: city.lng },
        create: {
          countryId: saved.id,
          name: city.name,
          latitude: city.lat,
          longitude: city.lng,
        },
      });
    }

    console.log('→ Grilles tarifaires', country.iso2);
    for (const rate of VEHICLE_RATES) {
      await prisma.vehicleRate.upsert({
        where: { countryId_vehicle: { countryId: saved.id, vehicle: rate.vehicle } },
        update: rate,
        create: { countryId: saved.id, ...rate },
      });
    }

    for (const method of PAYMENT_METHODS[country.iso2] ?? []) {
      await prisma.paymentMethodConfig.upsert({
        where: {
          countryId_channel_operator: {
            countryId: saved.id,
            channel: method.channel,
            operator: method.operator,
          },
        },
        update: { label: method.label, feeBps: method.feeBps },
        create: {
          countryId: saved.id,
          channel: method.channel,
          operator: method.operator,
          label: method.label,
          feeBps: method.feeBps,
        },
      });
    }
  }

  console.log('→ Catégories');
  for (const [index, category] of CATEGORIES.entries()) {
    await prisma.category.upsert({
      where: { slug: category.slug },
      update: { name: category.name, position: index },
      create: { ...category, position: index },
    });
  }

  console.log('→ Comptes du grand livre');
  for (const type of PLATFORM_ACCOUNTS) {
    const existing = await prisma.ledgerAccount.findFirst({ where: { type, ownerId: null } });
    if (!existing) {
      await prisma.ledgerAccount.create({ data: { type } });
    }
  }

  const counts = {
    pays: await prisma.country.count(),
    villes: await prisma.city.count(),
    catégories: await prisma.category.count(),
    tarifs: await prisma.vehicleRate.count(),
    'moyens de paiement': await prisma.paymentMethodConfig.count(),
    'comptes du grand livre': await prisma.ledgerAccount.count(),
  };
  console.table(counts);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
