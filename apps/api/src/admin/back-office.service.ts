import { Injectable, NotFoundException } from '@nestjs/common';
import type { LedgerAccountType, Prisma } from '@oja/db';
import { ORDER_LABELS, SUB_ORDER_LABELS } from '@oja/domain';

import { LedgerService } from '../ledger/ledger.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Lectures du back-office.
 *
 * Trois besoins que rien ne couvrait : consulter le grand livre, relire le
 * journal d'audit, et retrouver une commande dont on n'a que le nom du client
 * au téléphone. Tout y est en **lecture seule** — le grand livre est
 * immuable par construction (trigger en base), et une correction s'y fait par
 * contre-passation, jamais par retouche.
 */

/** Sens habituel de chaque compte, pour présenter des montants lisibles. */
const ACCOUNT_LABELS: Record<LedgerAccountType, string> = {
  PLATFORM_CASH: 'Trésorerie Ojà',
  PLATFORM_REVENUE: 'Commissions encaissées',
  MAKER_PAYABLE: 'Dû aux créateurs',
  COURIER_PAYABLE: 'Dû aux livreurs',
  CUSTOMER_REFUNDABLE: 'Dû aux clients',
  PSP_FEE: 'Frais de l’agrégateur',
  VAT_PAYABLE: 'TVA collectée',
  RECEIVABLE_ON_DELIVERY: 'À encaisser à la livraison',
  COURIER_CASH_HELD: 'Espèces chez les livreurs',
};

@Injectable()
export class BackOfficeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
  ) {}

  // ═══════════════════════════════ Grand livre

  /**
   * Soldes par compte.
   *
   * Les comptes nominatifs — un par créateur, un par livreur — sont agrégés
   * par type : une place de marché à mille artisans afficherait mille lignes
   * dont personne ne ferait rien. Le détail nominatif se lit dans l'espace de
   * l'intéressé.
   */
  async ledgerBalances(): Promise<{
    accounts: { type: string; label: string; balanceXof: number; accountCount: number }[];
    invariants: { ok: boolean; problems: string[] };
  }> {
    const rows = await this.prisma.ledgerEntry.groupBy({
      by: ['accountId'],
      _sum: { amountXof: true },
    });

    const accounts = await this.prisma.ledgerAccount.findMany({
      where: { id: { in: rows.map((row) => row.accountId) } },
      select: { id: true, type: true },
    });

    const typeOf = new Map(accounts.map((account) => [account.id, account.type]));
    const totals = new Map<LedgerAccountType, { balance: number; count: number }>();

    for (const row of rows) {
      const type = typeOf.get(row.accountId);
      if (!type) continue;
      const current = totals.get(type) ?? { balance: 0, count: 0 };
      totals.set(type, {
        balance: current.balance + (row._sum.amountXof ?? 0),
        count: current.count + 1,
      });
    }

    return {
      accounts: (Object.keys(ACCOUNT_LABELS) as LedgerAccountType[]).map((type) => ({
        type,
        label: ACCOUNT_LABELS[type],
        balanceXof: totals.get(type)?.balance ?? 0,
        accountCount: totals.get(type)?.count ?? 0,
      })),
      invariants: await this.ledger.checkInvariants(),
    };
  }

  /** Dernières écritures, transaction par transaction. */
  async ledgerTransactions(limit = 50): Promise<
    {
      id: string;
      kind: string;
      refType: string;
      refId: string;
      /** Référence lisible (CMD-2026-000123, LIT-…) : celle que l'agent cherche. */
      reference: string | null;
      memo: string | null;
      createdAt: string;
      entries: { account: string; label: string; amountXof: number }[];
    }[]
  > {
    const transactions = await this.prisma.ledgerTransaction.findMany({
      include: { entries: { include: { account: true } } },
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 200),
    });

    const references = await this.ledgerReferences(transactions);

    return transactions.map((transaction) => ({
      id: transaction.id,
      kind: transaction.kind,
      refType: transaction.refType,
      refId: transaction.refId,
      reference: references.get(`${transaction.refType}:${transaction.refId}`) ?? null,
      memo: transaction.memo,
      createdAt: transaction.createdAt.toISOString(),
      entries: transaction.entries.map((entry) => ({
        account: entry.account.type,
        label: ACCOUNT_LABELS[entry.account.type],
        amountXof: entry.amountXof,
      })),
    }));
  }

  /**
   * Traduit les identifiants internes des écritures en références métier.
   *
   * Une écriture pointe un identifiant de base (`cmuq…`) que personne ne
   * peut chercher. Une requête par type, pas une par ligne.
   */
  private async ledgerReferences(
    transactions: { refType: string; refId: string }[],
  ): Promise<Map<string, string>> {
    const idsOf = (type: string) =>
      [...new Set(transactions.filter((t) => t.refType === type).map((t) => t.refId))];

    const [orders, payments, subOrders, disputes] = await Promise.all([
      this.prisma.order.findMany({
        where: { id: { in: idsOf('order') } },
        select: { id: true, reference: true },
      }),
      this.prisma.payment.findMany({
        where: { id: { in: idsOf('payment') } },
        select: { id: true, order: { select: { reference: true } } },
      }),
      this.prisma.subOrder.findMany({
        where: { id: { in: idsOf('sub_order') } },
        select: { id: true, reference: true },
      }),
      this.prisma.dispute.findMany({
        where: { id: { in: idsOf('dispute') } },
        select: { id: true, reference: true },
      }),
    ]);

    return new Map<string, string>([
      ...orders.map((o) => [`order:${o.id}`, o.reference] as [string, string]),
      ...payments.map((p) => [`payment:${p.id}`, p.order.reference] as [string, string]),
      ...subOrders.map((s) => [`sub_order:${s.id}`, s.reference] as [string, string]),
      ...disputes.map((d) => [`dispute:${d.id}`, d.reference] as [string, string]),
    ]);
  }

  // ═══════════════════════════════ Journal d'audit

  async auditLog(filters: { action?: string; targetId?: string; limit?: number }): Promise<
    {
      id: string;
      action: string;
      actorRole: string | null;
      actorName: string | null;
      targetType: string;
      targetId: string;
      createdAt: string;
    }[]
  > {
    const where: Prisma.AuditLogWhereInput = {
      ...(filters.action ? { action: { contains: filters.action } } : {}),
      ...(filters.targetId ? { targetId: filters.targetId } : {}),
    };

    const logs = await this.prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: Math.min(filters.limit ?? 100, 300),
    });

    /* Les noms sont résolus en une requête plutôt qu'une par ligne : cent
       lignes de journal ne doivent pas coûter cent allers-retours. */
    const actorIds = [...new Set(logs.map((log) => log.actorId).filter(Boolean))] as string[];
    const actors = await this.prisma.user.findMany({
      where: { id: { in: actorIds } },
      select: { id: true, firstName: true, lastName: true },
    });
    const nameOf = new Map(
      actors.map((actor) => [actor.id, `${actor.firstName} ${actor.lastName}`]),
    );

    return logs.map((log) => ({
      id: log.id,
      action: log.action,
      actorRole: log.actorRole,
      actorName: log.actorId ? (nameOf.get(log.actorId) ?? null) : null,
      targetType: log.targetType,
      targetId: log.targetId,
      createdAt: log.createdAt.toISOString(),
    }));
  }

  // ═══════════════════════════════ Commandes

  /**
   * Recherche de commande.
   *
   * Par référence, par nom ou par téléphone du destinataire : au téléphone, un
   * client donne rarement sa référence de commande, mais toujours son nom.
   */
  async searchOrders(query: string | undefined, status: string | undefined) {
    const where: Prisma.OrderWhereInput = {
      ...(status ? { status: status as 'CONFIRMED' } : {}),
      ...(query
        ? {
            OR: [
              { reference: { contains: query, mode: 'insensitive' as const } },
              { shipFullName: { contains: query, mode: 'insensitive' as const } },
              { shipPhone: { contains: query } },
            ],
          }
        : {}),
    };

    const orders = await this.prisma.order.findMany({
      where,
      include: {
        subOrders: {
          include: { maker: { select: { shopName: true } } },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    return orders.map((order) => ({
      reference: order.reference,
      status: order.status,
      // Les mêmes libellés que ceux que voit le client : l'agent au téléphone
      // doit pouvoir lui répéter ce qu'il lit.
      statusLabel: ORDER_LABELS[order.status],
      shipFullName: order.shipFullName,
      shipPhone: order.shipPhone,
      totalXof: order.totalXof,
      subOrders: order.subOrders.map((subOrder) => ({
        reference: subOrder.reference,
        shopName: subOrder.maker.shopName,
        status: subOrder.status,
        statusLabel: SUB_ORDER_LABELS[subOrder.status],
      })),
      placedAt: order.placedAt?.toISOString() ?? null,
      createdAt: order.createdAt.toISOString(),
    }));
  }

  // ═══════════════════════════════ Paramétrage

  /**
   * Réglages du pays : c'est ici que se joue l'ouverture d'un nouveau marché.
   *
   * Le cahier (§ 13) veut qu'ouvrir un pays soit un réglage, pas un
   * déploiement. L'écran le rend visible : un pays inactif est un pays dont
   * personne ne voit le catalogue, et il suffit d'un clic.
   */
  async settings() {
    const [countries, rates, methods] = await Promise.all([
      this.prisma.country.findMany({
        include: { cities: { select: { id: true, name: true } } },
        orderBy: { name: 'asc' },
      }),
      this.prisma.vehicleRate.findMany({
        include: { country: { select: { name: true } } },
        orderBy: [{ countryId: 'asc' }, { vehicle: 'asc' }],
      }),
      this.prisma.paymentMethodConfig.findMany({
        include: { country: { select: { name: true } } },
        orderBy: [{ countryId: 'asc' }, { position: 'asc' }],
      }),
    ]);

    return {
      countries: countries.map((country) => ({
        id: country.id,
        name: country.name,
        code: country.iso2,
        currency: country.currency,
        vatBps: country.vatBps,
        isActive: country.isActive,
        cityCount: country.cities.length,
      })),
      vehicleRates: rates.map((rate) => ({
        id: rate.id,
        country: rate.country.name,
        vehicle: rate.vehicle,
        baseFeeXof: rate.baseFeeXof,
        perKmXof: rate.perKmXof,
        minFeeXof: rate.minFeeXof,
        maxWeightKg: rate.maxWeightKg,
      })),
      paymentMethods: methods.map((method) => ({
        id: method.id,
        country: method.country.name,
        channel: method.channel,
        operator: method.operator,
        label: method.label,
        feeBps: method.feeBps,
        isActive: method.isActive,
      })),
    };
  }

  /** Activation ou désactivation d'un pays. Voir `settings()`. */
  async setCountryActive(countryId: string, isActive: boolean, adminId: string) {
    const country = await this.prisma.country.findUnique({ where: { id: countryId } });
    if (!country) throw new NotFoundException();

    await this.prisma.$transaction([
      this.prisma.country.update({ where: { id: countryId }, data: { isActive } }),
      this.prisma.auditLog.create({
        data: {
          actorId: adminId,
          actorRole: 'ADMIN',
          action: isActive ? 'country.open' : 'country.close',
          targetType: 'Country',
          targetId: countryId,
          before: { isActive: country.isActive },
          after: { isActive },
        },
      }),
    ]);

    return { id: countryId, isActive };
  }
}
