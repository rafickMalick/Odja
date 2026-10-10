import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type {
  CreativeOverview,
  ReportInput,
  ReportResolutionInput,
  ReportView,
} from '@oja/contracts';
import type { ContentReport, User } from '@oja/db';

import { MakerService } from '../makers/maker.service';
import { NotificationService } from '../notifications/notification.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Signalements de contenus (cahier des évolutions, § 13).
 *
 * Une personne qui estime qu'une photo, une œuvre ou un profil a été publié
 * sans autorisation le signale ; l'administration tranche et peut masquer le
 * contenu. Rien n'est supprimé : une fiche se masque, une exposition ou un
 * profil se suspend, et la décision est journalisée.
 */
@Injectable()
export class ReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
    private readonly makers: MakerService,
  ) {}

  async create(input: ReportInput, reporterId: string | undefined): Promise<{ reference: string }> {
    if (!reporterId && !input.email) {
      throw new BadRequestException('Indiquez une adresse e-mail pour que nous puissions vous répondre.');
    }
    const target = await this.describe(input.targetType, input.targetId);
    if (!target) throw new NotFoundException('Ce contenu n’existe plus.');

    const report = await this.prisma.$transaction(async (tx) => {
      const year = new Date().getFullYear();
      const counter = await tx.referenceCounter.upsert({
        where: { scope_year: { scope: 'content_report', year } },
        update: { value: { increment: 1 } },
        create: { scope: 'content_report', year, value: 1 },
      });
      return tx.contentReport.create({
        data: {
          reference: `SIG-${year}-${String(counter.value).padStart(6, '0')}`,
          targetType: input.targetType,
          targetId: input.targetId,
          targetLabel: target.label,
          reason: input.reason,
          details: input.details,
          reporterId: reporterId ?? null,
          reporterEmail: reporterId ? null : (input.email ?? null),
        },
      });
    });

    await this.notifications.adminNotice({
      title: 'Nouveau signalement',
      body: `${report.reference} · ${target.label}`,
      href: '/admin/signalements',
    });
    return { reference: report.reference };
  }

  async list(status?: string): Promise<ReportView[]> {
    const reports = await this.prisma.contentReport.findMany({
      where: status ? { status: status as ContentReport['status'] } : {},
      include: { reporter: { select: { email: true, firstName: true, lastName: true } } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return Promise.all(reports.map((report) => this.toView(report)));
  }

  async resolve(id: string, adminId: string, input: ReportResolutionInput): Promise<ReportView> {
    const report = await this.prisma.contentReport.findUnique({ where: { id } });
    if (!report) throw new NotFoundException();
    if (report.status !== 'OPEN') throw new ConflictException('Ce signalement est déjà traité.');

    const hide = input.decision === 'RESOLVED' && input.hideContent;
    if (hide) await this.hide(report, adminId, input.note);

    await this.prisma.$transaction([
      this.prisma.contentReport.update({
        where: { id },
        data: {
          status: input.decision,
          resolution: input.note,
          contentHidden: hide,
          handledById: adminId,
          handledAt: new Date(),
        },
      }),
      this.prisma.auditLog.create({
        data: {
          actorId: adminId,
          actorRole: 'ADMIN',
          action: `report.${input.decision.toLowerCase()}`,
          targetType: 'ContentReport',
          targetId: id,
          after: { note: input.note, contentHidden: hide, target: `${report.targetType}:${report.targetId}` },
        },
      }),
    ]);

    if (report.reporterId) {
      await this.notifications.notice('visitor_notice', report.reporterId, {
        title: 'Votre signalement a été traité',
        body: `${report.reference} : ${input.note}`,
        href: '/compte/notifications',
      });
    }

    const updated = await this.prisma.contentReport.findUniqueOrThrow({
      where: { id },
      include: { reporter: { select: { email: true, firstName: true, lastName: true } } },
    });
    return this.toView(updated);
  }

  /** Les chiffres qui attendent un geste, sur une ligne (§ 11). */
  async overview(): Promise<CreativeOverview> {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const apprentice = { in: ['APPRENTICE_DESIGNER', 'APPRENTICE_ARTISAN'] as ('APPRENTICE_DESIGNER' | 'APPRENTICE_ARTISAN')[] };

    const [
      professionalsPending,
      apprenticesPending,
      premiumActive,
      suspendedMakers,
      exhibitionsToReview,
      exhibitionsAwaitingContract,
      exhibitionsLive,
      reportsOpen,
      passesConfirmedThisMonth,
    ] = await Promise.all([
      this.prisma.makerProfile.count({
        where: { kycStatus: 'PENDING', deletedAt: null, creatorKind: { notIn: apprentice.in } },
      }),
      this.prisma.makerProfile.count({
        where: { kycStatus: 'PENDING', deletedAt: null, creatorKind: apprentice },
      }),
      this.prisma.makerSubscription.count({
        where: {
          cancelledAt: null,
          startsAt: { lte: now },
          OR: [{ endsAt: null }, { endsAt: { gt: now } }],
          plan: { isDefault: false },
        },
      }),
      this.prisma.makerProfile.count({ where: { suspendedAt: { not: null }, deletedAt: null } }),
      this.prisma.exhibition.count({ where: { status: 'SUBMITTED' } }),
      this.prisma.exhibition.count({ where: { status: 'ACCEPTED' } }),
      this.prisma.exhibition.count({ where: { status: 'PUBLISHED' } }),
      this.prisma.contentReport.count({ where: { status: 'OPEN' } }),
      this.prisma.exhibitionPass.count({ where: { status: 'CONFIRMED', updatedAt: { gte: monthStart } } }),
    ]);

    return {
      professionalsPending,
      apprenticesPending,
      premiumActive,
      suspendedMakers,
      exhibitionsToReview,
      exhibitionsAwaitingContract,
      exhibitionsLive,
      reportsOpen,
      passesConfirmedThisMonth,
    };
  }

  // ═══════════════════════════════ Utilitaires

  private async hide(report: ContentReport, adminId: string, note: string): Promise<void> {
    const reason = `Signalement ${report.reference} : ${note}`;
    switch (report.targetType) {
      case 'PRODUCT':
        await this.prisma.$transaction([
          this.prisma.product.update({ where: { id: report.targetId }, data: { hiddenAt: new Date() } }),
          this.prisma.auditLog.create({
            data: {
              actorId: adminId,
              actorRole: 'ADMIN',
              action: 'product.hide',
              targetType: 'Product',
              targetId: report.targetId,
              after: { reason },
            },
          }),
        ]);
        return;
      case 'MAKER':
        await this.makers.suspend(report.targetId, adminId, reason);
        return;
      case 'EXHIBITION':
        await this.prisma.exhibition.updateMany({
          where: { id: report.targetId, status: { in: ['PUBLISHED', 'SCHEDULED'] } },
          data: { status: 'SUSPENDED', suspendedAt: new Date(), suspendReason: reason },
        });
        return;
      case 'EXHIBITION_WORK':
        await this.prisma.exhibitionWork.update({
          where: { id: report.targetId },
          data: { reviewStatus: 'REJECTED', reviewNote: reason },
        });
        return;
    }
  }

  private async describe(
    type: ContentReport['targetType'],
    id: string,
  ): Promise<{ label: string; href: string } | null> {
    switch (type) {
      case 'PRODUCT': {
        const product = await this.prisma.product.findUnique({ where: { id }, select: { name: true, slug: true } });
        return product ? { label: `Fiche « ${product.name} »`, href: `/produit/${product.slug}` } : null;
      }
      case 'MAKER': {
        const maker = await this.prisma.makerProfile.findUnique({ where: { id }, select: { shopName: true, slug: true } });
        return maker ? { label: `Profil « ${maker.shopName} »`, href: `/atelier/${maker.slug}` } : null;
      }
      case 'EXHIBITION': {
        const exhibition = await this.prisma.exhibition.findUnique({ where: { id }, select: { title: true } });
        return exhibition ? { label: `Exposition « ${exhibition.title} »`, href: `/admin/expositions/${id}` } : null;
      }
      case 'EXHIBITION_WORK': {
        const work = await this.prisma.exhibitionWork.findUnique({
          where: { id },
          select: { title: true, exhibitionId: true, exhibition: { select: { title: true } } },
        });
        return work
          ? {
              label: `Œuvre « ${work.title} » (${work.exhibition.title})`,
              href: `/admin/expositions/${work.exhibitionId}`,
            }
          : null;
      }
    }
  }

  private async toView(
    report: ContentReport & { reporter: Pick<User, 'email' | 'firstName' | 'lastName'> | null },
  ): Promise<ReportView> {
    const target = await this.describe(report.targetType, report.targetId);
    return {
      id: report.id,
      reference: report.reference,
      targetType: report.targetType,
      targetId: report.targetId,
      targetLabel: report.targetLabel,
      targetHref: target?.href ?? null,
      reason: report.reason,
      details: report.details,
      reporter: report.reporter
        ? `${report.reporter.firstName} ${report.reporter.lastName} (${report.reporter.email})`
        : (report.reporterEmail ?? 'Anonyme'),
      status: report.status,
      resolution: report.resolution,
      contentHidden: report.contentHidden,
      handledAt: report.handledAt?.toISOString() ?? null,
      createdAt: report.createdAt.toISOString(),
    };
  }
}

