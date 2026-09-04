import type { PrismaService } from '../prisma/prisma.service';

/**
 * Remise à zéro des données de test.
 *
 * Écrit une fois et partagé, parce que l'ordre de suppression n'est pas
 * anodin : la base **refuse** d'effacer un utilisateur qui a passé commande.
 * Ce n'est pas un obstacle à contourner, c'est la contrainte qui protège les
 * pièces comptables — une commande doit survivre à la fermeture d'un compte.
 * En production on désactive un compte (`deletedAt`), on ne le supprime pas.
 *
 * Les tests, eux, veulent une base propre : ils démontent donc dans l'ordre
 * inverse des dépendances.
 */
export async function resetTestData(prisma: PrismaService): Promise<void> {
  // Tous les comptes de test partagent ce domaine.
  const users = await prisma.user.findMany({
    where: { email: { endsWith: '@oja.market' } },
    select: { id: true },
  });
  if (users.length === 0) return;

  const userIds = users.map((user) => user.id);

  const orders = await prisma.order.findMany({
    where: { customerId: { in: userIds } },
    select: { id: true },
  });
  const orderIds = orders.map((order) => order.id);

  if (orderIds.length > 0) {
    // Les lignes, sous-commandes et paiements tombent en cascade avec la
    // commande ; les expéditions et litiges aussi.
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
  }

  // Les produits sont référencés par les lignes de commande, désormais parties.
  const makers = await prisma.makerProfile.findMany({
    where: { userId: { in: userIds } },
    select: { id: true },
  });
  if (makers.length > 0) {
    await prisma.product.deleteMany({
      where: { makerId: { in: makers.map((maker) => maker.id) } },
    });
  }

  // Profils, adresses, paniers et sessions tombent en cascade avec l'utilisateur.
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });

  // Les codes promo ne sont rattachés à aucun compte : les rédemptions et
  // factures, elles, sont tombées en cascade avec les commandes ci-dessus.
  await prisma.promoCode.deleteMany({});

  // Les compteurs de références repartent de zéro : les tests vérifient une
  // numérotation sans trou, ils ont besoin d'une suite prévisible.
  await prisma.referenceCounter.deleteMany({});

  await resetLedger(prisma);
}

/**
 * Vide le grand livre entre deux exécutions de tests.
 *
 * Le grand livre est **immuable par construction** : un trigger interdit toute
 * suppression, parce qu'une écriture comptable se contre-passe et ne s'efface
 * pas. C'est exactement ce qu'on veut en production.
 *
 * En test, cette immuabilité faisait s'accumuler les écritures d'une
 * exécution à l'autre : les comptes de plateforme — `PSP_FEE`,
 * `PLATFORM_REVENUE` — sont globaux, et leur solde grossissait sans fin. Un
 * test qui lisait l'un d'eux passait la première fois puis échouait ensuite.
 *
 * On désactive donc le garde-fou le temps du nettoyage, explicitement. Cette
 * fonction ne doit jamais être appelée ailleurs que dans les tests.
 */
async function resetLedger(prisma: PrismaService): Promise<void> {
  await prisma.$executeRawUnsafe(
    'ALTER TABLE ledger_entries DISABLE TRIGGER ledger_entries_no_delete',
  );
  try {
    await prisma.$executeRawUnsafe('DELETE FROM ledger_entries');
    await prisma.$executeRawUnsafe('DELETE FROM ledger_transactions');
    await prisma.$executeRawUnsafe('DELETE FROM ledger_accounts WHERE "ownerId" IS NOT NULL');
    // Les comptes de plateforme sont recréés par le seed ; on les garde, mais
    // vidés de leurs écritures.
  } finally {
    // Dans un `finally` : une erreur de nettoyage ne doit pas laisser la base
    // sans son garde-fou d'immuabilité.
    await prisma.$executeRawUnsafe(
      'ALTER TABLE ledger_entries ENABLE TRIGGER ledger_entries_no_delete',
    );
  }
}
