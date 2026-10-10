import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  AdminExhibition,
  AdminExhibitionSummary,
  ExhibitionContractInput,
  ExhibitionPaymentInput,
  ExhibitionPlanInput,
  ExhibitionPlanUpdateInput,
  ExhibitionPlanView,
  ExhibitionReviewInput,
  ExhibitionWorkReviewInput,
  PrivateFileLink,
} from '@oja/contracts';
import type { Prisma } from '@oja/db';
import { assertExhibitionTransition, type ExhibitionStatus } from '@oja/domain';

import { NotificationService } from '../notifications/notification.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import {
  FULL_EXHIBITION_INCLUDE,
  toAdminSummary,
  toAdminView,
  toPlanView,
  type FullExhibition,
} from './exhibition.mapper';
import { ExhibitionService } from './exhibition.service';

/**
 * Instruction des expositions (§ 6.4, § 6.5 et § 11.3).
 *
 * Chaque étape — décision, validation d'une œuvre, contrat, paiement,
 * programmation, suspension — est journalisée et prévient l'organisateur. Le
 * cahier exige que ces actions puissent être retracées (§ 13, traçabilité).
 */
@Injectable()
export class ExhibitionAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly notifications: NotificationService,
    private readonly exhibitions: ExhibitionService,
  ) {}

  async list(status?: string): Promise<AdminExhibitionSummary[]> {
    const rows = await this.prisma.exhibition.findMany({
      where: status ? { status: status as ExhibitionStatus } : { status: { not: 'DRAFT' } },
      include: { plan: true, works: { select: { reviewStatus: true } } },
      orderBy: [{ submittedAt: 'asc' }, { createdAt: 'desc' }],
      take: 200,
    });
    return rows.map(toAdminSummary);
  }

  async get(id: string): Promise<AdminExhibition> {
    return toAdminView(await this.require(id), this.exhibitions.context());
  }

  /**
   * Liens de lecture du dossier et des justificatifs. Délivrés à la demande,
   * pour quelques minutes : ce sont des pièces privées (§ 13).
   */
  async privateFiles(id: string): Promise<PrivateFileLink[]> {
    const exhibition = await this.require(id);
    const links: PrivateFileLink[] = [];
    if (exhibition.dossierKey) {
      links.push({ label: 'Dossier de présentation', url: await this.storage.createReadUrl(exhibition.dossierKey) });
    }
    for (const work of exhibition.works) {
      if (work.proofKey) {
        links.push({
          label: `Justificatif — ${work.title}`,
          url: await this.storage.createReadUrl(work.proofKey),
        });
      }
    }
    return links;
  }

  /** Décision sur le projet : accepter, refuser, demander des modifications. */
  async review(id: string, adminId: string, input: ExhibitionReviewInput): Promise<AdminExhibition> {
    const exhibition = await this.require(id);
    if (input.decision !== 'ACCEPT' && !input.note) {
      throw new BadRequestException('Dites à l’organisateur ce qui motive la décision.');
    }

    const target: ExhibitionStatus =
      input.decision === 'ACCEPT'
        ? 'ACCEPTED'
        : input.decision === 'REJECT'
          ? 'REJECTED'
          : 'CHANGES_REQUESTED';
    assertExhibitionTransition(exhibition.status, target);

    await this.apply(id, adminId, `exhibition.${input.decision.toLowerCase()}`, {
      status: target,
      reviewNote: input.note ?? null,
      reviewedAt: new Date(),
      reviewerId: adminId,
    });

    const messages = {
      ACCEPT: {
        title: 'Votre exposition est acceptée',
        body: `« ${exhibition.title} » est acceptée. L’équipe Ojà vous adresse les conditions contractuelles et les modalités de paiement.`,
      },
      REJECT: {
        title: 'Votre demande d’exposition n’est pas retenue',
        body: `« ${exhibition.title} » n’a pas été retenue : ${input.note ?? ''}`,
      },
      REQUEST_CHANGES: {
        title: 'Modifications demandées sur votre exposition',
        body: `L’équipe Ojà demande des modifications sur « ${exhibition.title} » : ${input.note ?? ''}`,
      },
    } as const;
    await this.notifications.notice('organizer_notice', exhibition.organizerId, {
      ...messages[input.decision],
      href: `/expositions/mes-expositions/${id}`,
    });

    return this.get(id);
  }

  /** Validation œuvre par œuvre (§ 6.5) : seules les œuvres validées sont publiées. */
  async reviewWork(
    id: string,
    workId: string,
    adminId: string,
    input: ExhibitionWorkReviewInput,
  ): Promise<AdminExhibition> {
    const exhibition = await this.require(id);
    const work = exhibition.works.find((item) => item.id === workId);
    if (!work) throw new NotFoundException();
    if (input.decision === 'REJECT' && !input.note) {
      throw new BadRequestException('Un refus d’œuvre doit être motivé.');
    }

    await this.prisma.$transaction([
      this.prisma.exhibitionWork.update({
        where: { id: workId },
        data: {
          reviewStatus: input.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED',
          reviewNote: input.note ?? null,
        },
      }),
      this.audit(adminId, `exhibition.work.${input.decision.toLowerCase()}`, id, {
        workId,
        note: input.note ?? null,
      }),
    ]);

    if (input.decision === 'REJECT') {
      await this.notifications.notice('organizer_notice', exhibition.organizerId, {
        title: 'Une œuvre n’a pas été retenue',
        body: `« ${work.title} » ne sera pas exposée : ${input.note}`,
        href: `/expositions/mes-expositions/${id}`,
      });
    }
    return this.get(id);
  }

  /** Suivi du contrat : envoi, puis signature (§ 6.4, étapes 6 et 7). */
  async contract(id: string, adminId: string, input: ExhibitionContractInput): Promise<AdminExhibition> {
    const exhibition = await this.require(id);
    if (!['ACCEPTED', 'SCHEDULED', 'PUBLISHED'].includes(exhibition.status)) {
      throw new ConflictException('Le contrat se traite une fois le projet accepté.');
    }

    const now = new Date();
    await this.apply(id, adminId, 'exhibition.contract', {
      ...(input.contractReference ? { contractReference: input.contractReference } : {}),
      ...(input.sent ? { contractSentAt: exhibition.contractSentAt ?? now } : {}),
      ...(input.signed ? { contractSignedAt: exhibition.contractSignedAt ?? now } : {}),
    });

    if (input.sent && !exhibition.contractSentAt) {
      await this.notifications.notice('organizer_notice', exhibition.organizerId, {
        title: 'Contrat d’exposition envoyé',
        body: `Le contrat de « ${exhibition.title} » vous a été adressé. Signez-le et réglez la formule pour que l’exposition soit programmée.`,
        href: `/expositions/mes-expositions/${id}`,
      });
    }
    return this.get(id);
  }

  /** Paiement de la formule, reçu hors plateforme (§ 6.4, étape 8). */
  async payment(id: string, adminId: string, input: ExhibitionPaymentInput): Promise<AdminExhibition> {
    const exhibition = await this.require(id);
    if (!['ACCEPTED', 'SCHEDULED', 'PUBLISHED'].includes(exhibition.status)) {
      throw new ConflictException('Le paiement se constate une fois le projet accepté.');
    }

    await this.apply(id, adminId, 'exhibition.payment', {
      paymentAmountXof: input.amountXof,
      paymentReference: input.reference,
      paymentReceivedAt: new Date(),
    });

    await this.notifications.notice('organizer_notice', exhibition.organizerId, {
      title: 'Paiement de votre exposition confirmé',
      body: `Nous avons bien reçu le règlement de « ${exhibition.title} ».`,
      href: `/expositions/mes-expositions/${id}`,
    });
    return this.get(id);
  }

  /** Programmation de la mise en ligne, contrat signé et paiement reçu. */
  async schedule(id: string, adminId: string, publishAt: Date): Promise<AdminExhibition> {
    const view = await this.get(id);
    if (view.scheduleBlockers.length > 0) {
      throw new BadRequestException(
        `Avant de programmer, il manque : ${view.scheduleBlockers.join(', ')}.`,
      );
    }
    assertExhibitionTransition(view.status, 'SCHEDULED');

    await this.apply(id, adminId, 'exhibition.schedule', { status: 'SCHEDULED', publishAt });

    const exhibition = await this.require(id);
    await this.notifications.notice('organizer_notice', exhibition.organizerId, {
      title: 'Votre exposition est programmée',
      body: `« ${exhibition.title} » sera en ligne le ${publishAt.toLocaleDateString('fr-FR')}.`,
      href: `/expositions/mes-expositions/${id}`,
    });
    return this.get(id);
  }

  async publishNow(id: string, adminId: string): Promise<AdminExhibition> {
    const exhibition = await this.require(id);
    assertExhibitionTransition(exhibition.status, 'PUBLISHED');
    const now = new Date();
    await this.apply(id, adminId, 'exhibition.publish', {
      status: 'PUBLISHED',
      publishedAt: exhibition.publishedAt ?? now,
      publishAt: exhibition.publishAt ?? now,
      suspendedAt: null,
      suspendReason: null,
    });

    await this.notifications.notice('organizer_notice', exhibition.organizerId, {
      title: 'Votre exposition est en ligne',
      body: `« ${exhibition.title} » est visible sur Ojà. Partagez son lien !`,
      href: `/expositions/${exhibition.slug}`,
    });
    return this.get(id);
  }

  async suspend(id: string, adminId: string, reason: string): Promise<AdminExhibition> {
    const exhibition = await this.require(id);
    assertExhibitionTransition(exhibition.status, 'SUSPENDED');
    await this.apply(id, adminId, 'exhibition.suspend', {
      status: 'SUSPENDED',
      suspendedAt: new Date(),
      suspendReason: reason,
    });

    await this.notifications.notice('organizer_notice', exhibition.organizerId, {
      title: 'Votre exposition est suspendue',
      body: `« ${exhibition.title} » n’est plus visible : ${reason}`,
      href: `/expositions/mes-expositions/${id}`,
    });
    return this.get(id);
  }

  async setFeatured(id: string, adminId: string, isFeatured: boolean): Promise<AdminExhibition> {
    await this.require(id);
    await this.apply(id, adminId, isFeatured ? 'exhibition.feature' : 'exhibition.unfeature', {
      isFeatured,
    });
    return this.get(id);
  }

  // ═══════════════════════════════ Formules

  async plans(): Promise<ExhibitionPlanView[]> {
    const plans = await this.prisma.exhibitionPlan.findMany({ orderBy: { position: 'asc' } });
    return plans.map(toPlanView);
  }

  async createPlan(adminId: string, input: ExhibitionPlanInput): Promise<ExhibitionPlanView> {
    const taken = await this.prisma.exhibitionPlan.findUnique({ where: { code: input.code } });
    if (taken) throw new ConflictException('Ce code de formule existe déjà.');
    const plan = await this.prisma.exhibitionPlan.create({
      data: { ...input, description: input.description ?? null },
    });
    await this.audit(adminId, 'exhibition.plan.create', plan.id, toPlanView(plan), 'ExhibitionPlan');
    return toPlanView(plan);
  }

  async updatePlan(
    adminId: string,
    planId: string,
    input: ExhibitionPlanUpdateInput,
  ): Promise<ExhibitionPlanView> {
    const before = await this.prisma.exhibitionPlan.findUnique({ where: { id: planId } });
    if (!before) throw new NotFoundException();
    const data: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input)) if (value !== undefined) data[key] = value;

    const plan = await this.prisma.exhibitionPlan.update({ where: { id: planId }, data });
    await this.audit(adminId, 'exhibition.plan.update', planId, toPlanView(plan), 'ExhibitionPlan');
    return toPlanView(plan);
  }

  // ═══════════════════════════════ Utilitaires

  private async require(id: string): Promise<FullExhibition> {
    const exhibition = await this.prisma.exhibition.findUnique({
      where: { id },
      include: FULL_EXHIBITION_INCLUDE,
    });
    if (!exhibition) throw new NotFoundException();
    return exhibition;
  }

  /** Met à jour et journalise dans la même transaction. */
  private async apply(
    id: string,
    adminId: string,
    action: string,
    data: Prisma.ExhibitionUpdateInput,
  ): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.exhibition.update({ where: { id }, data }),
      this.audit(adminId, action, id, data as object),
    ]);
  }

  private audit(
    adminId: string,
    action: string,
    targetId: string,
    after: object,
    targetType = 'Exhibition',
  ) {
    return this.prisma.auditLog.create({
      data: {
        actorId: adminId,
        actorRole: 'ADMIN',
        action,
        targetType,
        targetId,
        after: JSON.parse(JSON.stringify(after)) as Prisma.InputJsonValue,
      },
    });
  }
}
