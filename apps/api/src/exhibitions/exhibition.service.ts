import { createHash, timingSafeEqual } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  ExhibitionCard,
  ExhibitionFileInput,
  ExhibitionInput,
  ExhibitionPlanView,
  ExhibitionUpdateInput,
  ExhibitionWorkInput,
  ExhibitionWorkUpdateInput,
  OrganizerExhibition,
  PublicExhibition,
} from '@oja/contracts';
import type { Prisma } from '@oja/db';
import {
  accessRequirement,
  assertExhibitionTransition,
  canSeeContent,
  isEditableByOrganizer,
  isPubliclyVisible,
} from '@oja/domain';

import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { NotificationService } from '../notifications/notification.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import {
  FULL_EXHIBITION_INCLUDE,
  toCard,
  toOrganizerView,
  toPlanView,
  toPublicWork,
  type FullExhibition,
  type MapperContext,
} from './exhibition.mapper';

/** Ce qu'un visiteur détient pour une exposition : inscription ou billet. */
export interface PassChecker {
  hasConfirmedPass(exhibitionId: string, userId: string | undefined): Promise<boolean>;
}

const PLACE = { city: { include: { country: { select: { name: true } } } } };

/**
 * Expositions, côté organisateur et côté public (§ 6 et 7).
 *
 * Deux parcours mènent ici : le créateur déjà inscrit, dont la boutique est
 * reprise d'office, et l'organisateur externe, qui n'a besoin que d'un compte
 * (§ 6.2). Seul le premier peut vendre les œuvres exposées : la vente passe
 * par une fiche de son catalogue, avec le circuit de commande et de livraison
 * qui existe déjà.
 */
@Injectable()
export class ExhibitionService {
  private readonly logger = new Logger(ExhibitionService.name);
  private readonly defaultCommissionBps: number;
  private passes: PassChecker | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly notifications: NotificationService,
    config: ConfigService,
  ) {
    this.defaultCommissionBps = config.get<number>('PLATFORM_COMMISSION_BPS', 500);
  }

  /** La billetterie s'inscrit ici, pour ouvrir la galerie à ses détenteurs. */
  usePassChecker(passes: PassChecker): void {
    this.passes = passes;
  }

  context(now = new Date()): MapperContext {
    return {
      imageUrl: (fileKey) => this.storage.publicUrlFor(fileKey),
      defaultCommissionBps: this.defaultCommissionBps,
      now,
    };
  }

  // ═══════════════════════════════ Formules

  async activePlans(): Promise<ExhibitionPlanView[]> {
    const plans = await this.prisma.exhibitionPlan.findMany({
      where: { isActive: true },
      orderBy: { position: 'asc' },
    });
    return plans.map(toPlanView);
  }

  // ═══════════════════════════════ Organisateur

  async listMine(userId: string): Promise<OrganizerExhibition[]> {
    const exhibitions = await this.prisma.exhibition.findMany({
      where: { organizerId: userId },
      include: FULL_EXHIBITION_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    const context = this.context();
    return exhibitions.map((exhibition) => toOrganizerView(exhibition, context));
  }

  async mine(userId: string, id: string): Promise<OrganizerExhibition> {
    return toOrganizerView(await this.requireOwn(userId, id), this.context());
  }

  async create(user: AuthenticatedUser, input: ExhibitionInput): Promise<OrganizerExhibition> {
    await this.assertCity(input.cityId);
    if (input.planId) await this.assertPlan(input.planId);

    /* Parcours A : un créateur inscrit retrouve sa boutique, et ses pièces
       peuvent être vendues pendant l'exposition. */
    const maker = await this.prisma.makerProfile.findUnique({ where: { userId: user.id } });

    const created = await this.prisma.exhibition.create({
      data: {
        slug: await this.uniqueSlug(input.title),
        organizerId: user.id,
        makerId: maker?.id ?? null,
        ...this.dataFrom(input),
      },
    });

    if (input.accessCode) await this.setAccessCode(created.id, input.accessCode);
    return this.mine(user.id, created.id);
  }

  async update(userId: string, id: string, input: ExhibitionUpdateInput): Promise<OrganizerExhibition> {
    const exhibition = await this.requireOwn(userId, id);
    this.assertEditable(exhibition.status);
    if (input.cityId) await this.assertCity(input.cityId);
    if (input.planId) await this.assertPlan(input.planId);

    await this.prisma.exhibition.update({ where: { id }, data: this.dataFrom(input) });
    if (input.accessCode) await this.setAccessCode(id, input.accessCode);
    return this.mine(userId, id);
  }

  /** Affiche, dossier de présentation ou photo du lieu. */
  async attachFile(userId: string, id: string, input: ExhibitionFileInput): Promise<OrganizerExhibition> {
    const exhibition = await this.requireOwn(userId, id);
    this.assertEditable(exhibition.status);

    const purpose = input.slot === 'dossier' ? 'exhibition-document' : 'exhibition-image';
    await this.assertOwnFile(input.fileKey, purpose, userId);

    const data: Prisma.ExhibitionUpdateInput =
      input.slot === 'cover'
        ? { coverKey: input.fileKey }
        : input.slot === 'dossier'
          ? { dossierKey: input.fileKey }
          : { venueImageKeys: { set: [...exhibition.venueImageKeys, input.fileKey].slice(-6) } };

    await this.prisma.exhibition.update({ where: { id }, data });
    return this.mine(userId, id);
  }

  async addWork(userId: string, id: string, input: ExhibitionWorkInput): Promise<OrganizerExhibition> {
    const exhibition = await this.requireOwn(userId, id);
    this.assertEditable(exhibition.status);
    await this.checkWorkInput(exhibition, userId, input);

    await this.prisma.exhibitionWork.create({
      data: {
        exhibitionId: id,
        position: exhibition.works.length,
        title: input.title,
        artistName: input.artistName,
        description: input.description,
        materials: input.materials ?? null,
        dimensions: input.dimensions ?? null,
        productId: input.productId ?? null,
        imageKeys: input.imageKeys ?? [],
        proofKey: input.proofKey ?? null,
      },
    });
    return this.mine(userId, id);
  }

  async updateWork(
    userId: string,
    id: string,
    workId: string,
    input: ExhibitionWorkUpdateInput,
  ): Promise<OrganizerExhibition> {
    const exhibition = await this.requireOwn(userId, id);
    this.assertEditable(exhibition.status);
    if (!exhibition.works.some((work) => work.id === workId)) throw new NotFoundException();
    await this.checkWorkInput(exhibition, userId, input);

    const data: Prisma.ExhibitionWorkUpdateInput = {};
    for (const key of ['title', 'artistName', 'description', 'materials', 'dimensions', 'proofKey'] as const) {
      if (input[key] !== undefined) data[key] = input[key];
    }
    if (input.imageKeys !== undefined) data.imageKeys = { set: input.imageKeys };
    if (input.productId !== undefined) {
      data.product = input.productId ? { connect: { id: input.productId } } : { disconnect: true };
    }
    /* Une œuvre modifiée après un refus repasse en examen. */
    data.reviewStatus = 'PENDING';
    data.reviewNote = null;

    await this.prisma.exhibitionWork.update({ where: { id: workId }, data });
    return this.mine(userId, id);
  }

  async removeWork(userId: string, id: string, workId: string): Promise<OrganizerExhibition> {
    const exhibition = await this.requireOwn(userId, id);
    this.assertEditable(exhibition.status);
    if (!exhibition.works.some((work) => work.id === workId)) throw new NotFoundException();

    await this.prisma.exhibitionWork.delete({ where: { id: workId } });
    return this.mine(userId, id);
  }

  /** Soumission du dossier à l'administration (§ 6.4, étape 1). */
  async submit(userId: string, id: string): Promise<OrganizerExhibition> {
    const exhibition = await this.requireOwn(userId, id);
    const view = toOrganizerView(exhibition, this.context());

    if (view.blockers.length > 0) {
      throw new BadRequestException({
        error: 'Dossier incomplet',
        message: 'Ce dossier ne peut pas encore être soumis.',
        errors: view.blockers.map((message) => ({ field: 'exhibition', message })),
      });
    }

    assertExhibitionTransition(exhibition.status, 'SUBMITTED');
    await this.prisma.exhibition.update({
      where: { id },
      data: { status: 'SUBMITTED', submittedAt: new Date(), reviewNote: null },
    });

    await this.notifications.notice('organizer_notice', userId, {
      title: 'Demande d’exposition reçue',
      body: `« ${exhibition.title} » est entre les mains de l’équipe Ojà. Vous serez prévenu de sa décision.`,
      href: `/expositions/mes-expositions/${id}`,
    });
    await this.notifications.adminNotice({
      title: 'Demande d’exposition à examiner',
      body: `« ${exhibition.title} », par ${exhibition.organizerName}.`,
      href: `/admin/expositions/${id}`,
    });

    return this.mine(userId, id);
  }

  // ═══════════════════════════════ Public

  /**
   * Rubrique Expositions (§ 10) : à venir, en cours, terminées encore
   * consultables ; gratuites ou payantes ; mises en avant.
   */
  async listPublic(filters: {
    when?: string | undefined;
    access?: string | undefined;
    featured?: boolean | undefined;
  }): Promise<ExhibitionCard[]> {
    const now = new Date();
    const exhibitions = await this.prisma.exhibition.findMany({
      where: {
        AND: [
          this.publicWhere(now),
          filters.when === 'upcoming' ? { startsAt: { gt: now } } : {},
          filters.when === 'current' ? { startsAt: { lte: now }, endsAt: { gte: now } } : {},
          filters.when === 'past' ? { endsAt: { lt: now } } : {},
          filters.access === 'free' ? { accessMode: 'FREE' as const } : {},
          filters.access === 'paid' ? { accessMode: 'PAID' as const } : {},
          filters.featured ? { isFeatured: true } : {},
        ],
      },
      include: {
        ...PLACE,
        _count: { select: { works: { where: { reviewStatus: 'APPROVED' } } } },
      },
      orderBy: [{ isFeatured: 'desc' }, { startsAt: filters.when === 'past' ? 'desc' : 'asc' }],
      take: 60,
    });

    const context = this.context(now);
    return exhibitions.map((exhibition) => toCard(exhibition, exhibition._count.works, context));
  }

  /**
   * Page publique d'une exposition (§ 7). La galerie n'est livrée qu'à qui y
   * a droit : billet payé, inscription, code d'accès — ou l'organisateur et
   * l'administration, qui doivent pouvoir vérifier ce qui est publié.
   */
  async publicBySlug(slug: string, viewer: AuthenticatedUser | undefined): Promise<PublicExhibition> {
    const now = new Date();
    const exhibition = await this.prisma.exhibition.findFirst({
      where: { slug, ...this.publicWhere(now) },
      include: FULL_EXHIBITION_INCLUDE,
    });
    if (!exhibition) throw new NotFoundException();

    await this.promoteIfDue(exhibition, now);
    void this.prisma.exhibition
      .update({ where: { id: exhibition.id }, data: { viewCount: { increment: 1 } } })
      .catch(() => undefined);

    const isOrganizerOrAdmin =
      viewer !== undefined && (viewer.id === exhibition.organizerId || viewer.role === 'ADMIN');
    const hasConfirmedPass = this.passes
      ? await this.passes.hasConfirmedPass(exhibition.id, viewer?.id)
      : false;
    const unlocked = canSeeContent(exhibition, { hasConfirmedPass, isOrganizerOrAdmin });

    const context = this.context(now);
    const approved = exhibition.works.filter((work) => work.reviewStatus === 'APPROVED');

    return {
      ...toCard(exhibition, approved.length, context),
      summary: exhibition.summary,
      objective: exhibition.objective,
      discipline: exhibition.discipline,
      openingHours: exhibition.openingHours,
      venueName: exhibition.format === 'ONLINE' ? null : exhibition.venueName,
      venueAddress: exhibition.format === 'ONLINE' ? null : exhibition.venueAddress,
      venueDescription: exhibition.venueDescription,
      venueImageUrls: exhibition.venueImageKeys.map(context.imageUrl),
      onsiteInfo: exhibition.onsiteInfo,
      remoteInfo: exhibition.remoteInfo,
      organizer: { makerSlug: exhibition.maker?.kycStatus === 'APPROVED' ? exhibition.maker.slug : null },
      requirement: accessRequirement(exhibition),
      unlocked,
      works: unlocked ? approved.map((work) => toPublicWork(work, context)) : null,
    };
  }

  /** Vérifie un code d'accès sans jamais stocker le code en clair. */
  async checkAccessCode(exhibitionId: string, code: string): Promise<boolean> {
    const exhibition = await this.prisma.exhibition.findUnique({
      where: { id: exhibitionId },
      select: { accessCodeHash: true },
    });
    if (!exhibition?.accessCodeHash) return false;
    const expected = Buffer.from(exhibition.accessCodeHash, 'hex');
    const actual = Buffer.from(hashCode(exhibitionId, code), 'hex');
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }

  /** Exposition visible du public, telle que la billetterie la lit. */
  async requirePublic(slug: string) {
    const exhibition = await this.prisma.exhibition.findFirst({
      where: { slug, ...this.publicWhere(new Date()) },
    });
    if (!exhibition) throw new NotFoundException();
    return exhibition;
  }

  // ═══════════════════════════════ Utilitaires

  publicWhere(now: Date): Prisma.ExhibitionWhereInput {
    return {
      OR: [
        { status: 'PUBLISHED' },
        { status: 'SCHEDULED', publishAt: { lte: now } },
      ],
    };
  }

  /**
   * Une exposition programmée dont la date est passée bascule en ligne à la
   * première lecture : personne n'a à cliquer « publier » le bon matin.
   */
  private async promoteIfDue(exhibition: FullExhibition, now: Date): Promise<void> {
    if (exhibition.status !== 'SCHEDULED' || !isPubliclyVisible(exhibition, now)) return;
    const updated = await this.prisma.exhibition.updateMany({
      where: { id: exhibition.id, status: 'SCHEDULED' },
      data: { status: 'PUBLISHED', publishedAt: now },
    });
    if (updated.count > 0) {
      await this.notifications.notice('organizer_notice', exhibition.organizerId, {
        title: 'Votre exposition est en ligne',
        body: `« ${exhibition.title} » est visible sur Ojà. Partagez son lien !`,
        href: `/expositions/${exhibition.slug}`,
      });
    }
  }

  private async requireOwn(userId: string, id: string): Promise<FullExhibition> {
    const exhibition = await this.prisma.exhibition.findFirst({
      where: { id, organizerId: userId },
      include: FULL_EXHIBITION_INCLUDE,
    });
    // 404 plutôt que 403 : on ne confirme pas l'existence du dossier d'un autre.
    if (!exhibition) throw new NotFoundException();
    return exhibition;
  }

  private assertEditable(status: FullExhibition['status']): void {
    if (!isEditableByOrganizer(status)) {
      throw new ConflictException(
        'Ce dossier est en cours d’instruction : il ne se modifie plus. Écrivez au support pour toute correction.',
      );
    }
  }

  private async checkWorkInput(
    exhibition: FullExhibition,
    userId: string,
    input: ExhibitionWorkUpdateInput,
  ): Promise<void> {
    for (const key of input.imageKeys ?? []) await this.assertOwnFile(key, 'exhibition-image', userId);
    if (input.proofKey) await this.assertOwnFile(input.proofKey, 'exhibition-document', userId);

    if (input.productId) {
      /* Seules les pièces de la boutique de l'organisateur se vendent
         pendant son exposition : le paiement, la livraison et le versement
         passent par cette boutique. */
      const product = exhibition.makerId
        ? await this.prisma.product.findFirst({
            where: { id: input.productId, makerId: exhibition.makerId, deletedAt: null },
          })
        : null;
      if (!product) {
        throw new BadRequestException('Cette fiche n’appartient pas à votre boutique.');
      }
    }
  }

  /** Une clé doit désigner un fichier de cet usage, envoyé par ce compte. */
  private async assertOwnFile(fileKey: string, purpose: string, userId: string): Promise<void> {
    if (!fileKey.includes(`/${purpose}/`) || !fileKey.includes(`/${userId}/`)) {
      throw new BadRequestException('Fichier inconnu.');
    }
    await this.storage.assertExists(fileKey);
  }

  private async assertCity(cityId: string): Promise<void> {
    const city = await this.prisma.city.findUnique({ where: { id: cityId } });
    if (!city) throw new BadRequestException('Ville inconnue.');
  }

  private async assertPlan(planId: string): Promise<void> {
    const plan = await this.prisma.exhibitionPlan.findUnique({ where: { id: planId } });
    if (!plan || !plan.isActive) throw new BadRequestException('Formule inconnue ou indisponible.');
  }

  private async setAccessCode(id: string, code: string): Promise<void> {
    await this.prisma.exhibition.update({
      where: { id },
      data: { accessCodeHash: hashCode(id, code) },
    });
  }

  private dataFrom(input: ExhibitionUpdateInput) {
    const data: Record<string, unknown> = {};
    for (const key of [
      'title',
      'organizerName',
      'summary',
      'objective',
      'discipline',
      'cityId',
      'openingHours',
      'format',
      'venueName',
      'venueAddress',
      'venueDescription',
      'plannedWorkCount',
      'planId',
      'accessMode',
      'ticketPriceXof',
      'requiresRegistration',
      'onsiteInfo',
      'remoteInfo',
    ] as const) {
      if (input[key] !== undefined) data[key] = input[key];
    }
    if (input.startsAt) data['startsAt'] = new Date(input.startsAt);
    if (input.endsAt) data['endsAt'] = new Date(input.endsAt);
    return data as Omit<Prisma.ExhibitionUncheckedCreateInput, 'slug' | 'organizerId'>;
  }

  private async uniqueSlug(title: string): Promise<string> {
    const base =
      title
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 70) || 'exposition';
    for (let suffix = 0; suffix < 100; suffix++) {
      const candidate = suffix === 0 ? base : `${base}-${suffix + 1}`;
      const taken = await this.prisma.exhibition.findUnique({ where: { slug: candidate } });
      if (!taken) return candidate;
    }
    return `${base}-${Date.now().toString(36)}`;
  }
}

/** Empreinte salée par l'exposition : un même code ne donne pas la même
 *  empreinte d'une exposition à l'autre. La casse ne compte pas. */
function hashCode(exhibitionId: string, code: string): string {
  return createHash('sha256').update(`${exhibitionId}:${code.trim().toLowerCase()}`).digest('hex');
}

