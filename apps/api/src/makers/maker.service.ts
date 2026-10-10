import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  AdminMaker,
  KycReviewInput,
  MakerCard,
  MakerDirectoryQuery,
  MakerImageInput,
  MakerProfileInput,
  MakerProfileUpdateInput,
  MakerWork,
  OwnMakerProfile,
  Page,
  PublicMaker,
} from '@oja/contracts';
import type { MakerProfile } from '@oja/db';
import { commissionFor, displayAvailability, findContactDetails } from '@oja/domain';

import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import {
  toAdminMaker,
  toMakerCard,
  toOwnMakerProfile,
  toPublicMaker,
  type MakerContext,
} from './maker.mapper';
import { NotificationService } from '../notifications/notification.service';
import {
  liveSubscriptionsInclude,
  VisibilityService,
  type ResolvedPlan,
} from './visibility.service';

/* Pas de `as const` : Prisma dérive le type de retour de l'objet `include`,
   et un littéral figé en lecture seule lui fait perdre la relation — les
   appelants reçoivent alors un profil sans sa ville. */
const WITH_PLACE = {
  city: { include: { country: { select: { name: true } } } },
};

/** Une fiche que le public peut voir, quelle que soit sa disponibilité. */
const PUBLIC_PRODUCT = { status: 'PUBLISHED' as const, hiddenAt: null, deletedAt: null };

/** Champs du profil créatif, communs à la création et à la mise à jour. */
const CREATIVE_FIELDS = [
  'creatorKind',
  'activityField',
  'specialties',
  'techniques',
  'services',
  'region',
  'publicArea',
] as const;

/* L'annuaire trie en mémoire (formule, mise en avant, note) : le rang dépend
   d'une autre table et de la date du jour, ce qu'un ORDER BY n'exprime pas
   simplement. Ce plafond le garde raisonnable — au-delà, il faudra
   matérialiser le rang. */
const DIRECTORY_SCAN_LIMIT = 500;

@Injectable()
export class MakerService {
  private readonly logger = new Logger(MakerService.name);
  private readonly defaultCommissionBps: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
    private readonly storage: StorageService,
    private readonly visibility: VisibilityService,
    config: ConfigService,
  ) {
    this.defaultCommissionBps = config.get<number>('PLATFORM_COMMISSION_BPS', 500);
  }

  /** Ce que le mapper ne lit pas sur la ligne : formule et URL des images. */
  private context(resolved: ResolvedPlan, productCount = 0): MakerContext {
    return {
      productCount,
      plan: { ...this.visibility.summary(resolved), showBadge: resolved.plan.showBadge },
      imageUrl: (fileKey) => this.storage.publicUrlFor(fileKey),
    };
  }

  private async contextFor(maker: MakerProfile, productCount = 0): Promise<MakerContext> {
    return this.context(await this.visibility.resolveFor(maker.id), productCount);
  }

  async createProfile(userId: string, input: MakerProfileInput): Promise<AdminMaker> {
    assertNoContactDetails(input);

    const existing = await this.prisma.makerProfile.findUnique({ where: { userId } });
    if (existing) {
      throw new ConflictException('Votre boutique existe déjà.');
    }

    const city = await this.prisma.city.findUnique({ where: { id: input.cityId } });
    if (!city) throw new BadRequestException('Ville inconnue.');

    const maker = await this.prisma.makerProfile.create({
      data: {
        userId,
        slug: await this.uniqueSlug(input.shopName),
        shopName: input.shopName,
        cityId: input.cityId,
        ...optional(input, [
          'description',
          'managerName',
          'contactPhone',
          'contactEmail',
          'postalAddress',
          'ifuNumber',
          'rccmNumber',
          'pickupLine1',
          'pickupLandmark',
          'pickupLatitude',
          'pickupLongitude',
          ...CREATIVE_FIELDS,
        ]),
      },
      include: WITH_PLACE,
    });

    return toAdminMaker(maker, await this.contextFor(maker));
  }

  /** Vue que le créateur a de sa propre boutique : complète, privé compris. */
  async myProfile(userId: string): Promise<OwnMakerProfile> {
    const maker = await this.prisma.makerProfile.findUnique({
      where: { userId },
      include: WITH_PLACE,
    });
    if (!maker) throw new NotFoundException('Aucune boutique pour ce compte.');

    const productCount = await this.prisma.product.count({
      where: { makerId: maker.id, deletedAt: null },
    });
    return toOwnMakerProfile(maker, await this.contextFor(maker, productCount));
  }

  async updateProfile(userId: string, input: MakerProfileUpdateInput): Promise<AdminMaker> {
    assertNoContactDetails(input);

    const maker = await this.prisma.makerProfile.findUnique({ where: { userId } });
    if (!maker) throw new NotFoundException('Aucune boutique pour ce compte.');

    /* Un dossier déjà approuvé qui change de raison sociale, d'IFU ou de RCCM
       doit repasser devant l'administration : ce sont précisément les pièces
       qu'elle a vérifiées. Le reste — description, logo — se modifie
       librement. */
    const changed = (next: string | null | undefined, current: string | null): boolean =>
      next !== undefined && (next ?? '').trim() !== (current ?? '').trim();

    /* « Modifié » veut dire une valeur différente de celle en base : le
       formulaire de la boutique renvoie tous ses champs à chaque
       enregistrement, et un simple changement de description ne doit pas
       renvoyer un atelier validé en attente de validation. */
    const touchesIdentity =
      changed(input.ifuNumber, maker.ifuNumber) ||
      changed(input.rccmNumber, maker.rccmNumber) ||
      changed(input.managerName, maker.managerName);

    const updated = await this.prisma.makerProfile.update({
      where: { userId },
      data: {
        ...optional(input, [
          'shopName',
          'description',
          'cityId',
          'managerName',
          'contactPhone',
          'contactEmail',
          'postalAddress',
          'ifuNumber',
          'rccmNumber',
          'pickupLine1',
          'pickupLandmark',
          'pickupLatitude',
          'pickupLongitude',
          ...CREATIVE_FIELDS,
        ]),
        ...(touchesIdentity && maker.kycStatus === 'APPROVED'
          ? { kycStatus: 'PENDING' as const, kycSubmittedAt: new Date() }
          : {}),
      },
      include: WITH_PLACE,
    });

    return toAdminMaker(updated, await this.contextFor(updated));
  }

  /**
   * Logo ou bannière. Le fichier est déjà sur le stockage ; on vérifie qu'il y
   * est vraiment avant de le rattacher, comme pour les photos produit.
   */
  async setImage(userId: string, input: MakerImageInput): Promise<OwnMakerProfile> {
    const maker = await this.prisma.makerProfile.findUnique({ where: { userId } });
    if (!maker) throw new NotFoundException('Aucune boutique pour ce compte.');

    /* La clé doit désigner une image de boutique envoyée par ce compte : sans
       ce contrôle, on afficherait en vitrine le fichier d'un autre — voire une
       pièce justificative. */
    if (!input.fileKey.includes('/shop-image/') || !input.fileKey.includes(`/${userId}/`)) {
      throw new BadRequestException('Fichier inconnu.');
    }
    await this.storage.assertExists(input.fileKey);

    const previous = input.slot === 'logo' ? maker.logoUrl : maker.coverUrl;
    await this.prisma.makerProfile.update({
      where: { userId },
      data: input.slot === 'logo' ? { logoUrl: input.fileKey } : { coverUrl: input.fileKey },
    });
    await this.dropStoredImage(previous);

    return this.myProfile(userId);
  }

  async removeImage(userId: string, slot: 'logo' | 'cover'): Promise<OwnMakerProfile> {
    const maker = await this.prisma.makerProfile.findUnique({ where: { userId } });
    if (!maker) throw new NotFoundException('Aucune boutique pour ce compte.');

    const previous = slot === 'logo' ? maker.logoUrl : maker.coverUrl;
    await this.prisma.makerProfile.update({
      where: { userId },
      data: slot === 'logo' ? { logoUrl: null } : { coverUrl: null },
    });
    await this.dropStoredImage(previous);

    return this.myProfile(userId);
  }

  /** Les images de démonstration sont des chemins du site, pas des clés : on
   *  ne supprime que ce qui vient du stockage. */
  private async dropStoredImage(fileKey: string | null): Promise<void> {
    if (!fileKey || fileKey.startsWith('/') || fileKey.startsWith('http')) return;
    try {
      await this.storage.remove(fileKey);
    } catch (error) {
      this.logger.warn(`Image ${fileKey} non supprimée : ${(error as Error).message}`);
    }
  }

  /** Dépôt du dossier pour validation par l'administration. */
  async submitKyc(userId: string): Promise<{ status: string }> {
    const maker = await this.prisma.makerProfile.findUnique({ where: { userId } });
    if (!maker) throw new NotFoundException('Aucune boutique pour ce compte.');

    if (maker.kycStatus === 'APPROVED') {
      throw new ConflictException('Votre compte est déjà validé.');
    }

    // On liste tous les manques d'un coup : un créateur renvoyé cinq fois de
    // suite pour un champ à la fois abandonne.
    const missing: string[] = [];
    if (!maker.managerName) missing.push('nom du responsable');
    if (!maker.contactPhone) missing.push('téléphone');
    if (!maker.postalAddress) missing.push('adresse physique');
    if (!maker.pickupLine1) missing.push("adresse de l'atelier");
    if (!maker.ifuNumber && !maker.rccmNumber) missing.push('numéro IFU ou RCCM');

    if (missing.length > 0) {
      throw new BadRequestException(
        `Complétez votre dossier avant de le déposer : ${missing.join(', ')}.`,
      );
    }

    await this.prisma.makerProfile.update({
      where: { userId },
      data: { kycStatus: 'PENDING', kycSubmittedAt: new Date(), kycRejectReason: null },
    });

    return { status: 'PENDING' };
  }

  // ── Vue publique ──

  async publicBySlug(slug: string): Promise<PublicMaker> {
    const maker = await this.prisma.makerProfile.findFirst({
      where: { slug, deletedAt: null, kycStatus: 'APPROVED' },
      include: WITH_PLACE,
    });
    // Un atelier non validé n'existe pas pour le public.
    if (!maker) throw new NotFoundException();

    const productCount = await this.prisma.product.count({
      where: { makerId: maker.id, isForSale: true, ...PUBLIC_PRODUCT },
    });
    return toPublicMaker(maker, await this.contextFor(maker, productCount));
  }

  /**
   * Galerie d'un atelier : tout ce qu'il a publié, à vendre ou non (§ 2.2 E).
   *
   * Les pièces vendues et les réalisations de portfolio y restent : c'est
   * précisément ce qui montre le savoir-faire d'un atelier.
   */
  async worksBySlug(slug: string): Promise<MakerWork[]> {
    const maker = await this.prisma.makerProfile.findFirst({
      where: { slug, deletedAt: null, kycStatus: 'APPROVED' },
    });
    if (!maker) throw new NotFoundException();

    const products = await this.prisma.product.findMany({
      where: { makerId: maker.id, ...PUBLIC_PRODUCT },
      include: {
        category: { select: { name: true } },
        images: { orderBy: { position: 'asc' }, take: 1 },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });

    const commissionBps = maker.commissionBps || this.defaultCommissionBps;
    return products.map((product) => ({
      id: product.id,
      slug: product.slug,
      name: product.name,
      category: product.category.name,
      material: product.material,
      imageUrl: product.images[0] ? this.storage.publicUrlFor(product.images[0].fileKey) : null,
      finalPriceXof: product.isForSale
        ? product.makerPriceXof + commissionFor(product.makerPriceXof, commissionBps)
        : null,
      availability: displayAvailability(product),
    }));
  }

  /**
   * Annuaire des créateurs, par zone et par statut (§ 2.2 D).
   *
   * Les formules qui l'achètent passent en tête, puis les ateliers que
   * l'équipe met en avant, puis les mieux notés. Tous les autres restent
   * listés : payer donne une meilleure place, jamais l'exclusivité (§ 3.4).
   */
  async directory(query: MakerDirectoryQuery): Promise<Page<MakerCard>> {
    const insensitive = 'insensitive' as const;
    const makers = await this.prisma.makerProfile.findMany({
      where: {
        deletedAt: null,
        kycStatus: 'APPROVED',
        ...(query.kind ? { creatorKind: query.kind } : {}),
        ...(query.country || query.city
          ? {
              city: {
                ...(query.city ? { name: { equals: query.city, mode: insensitive } } : {}),
                ...(query.country ? { country: { iso2: query.country.toUpperCase() } } : {}),
              },
            }
          : {}),
        ...(query.q
          ? {
              OR: [
                { shopName: { contains: query.q, mode: insensitive } },
                { activityField: { contains: query.q, mode: insensitive } },
                { specialties: { has: query.q } },
                { techniques: { has: query.q } },
              ],
            }
          : {}),
      },
      include: {
        ...WITH_PLACE,
        subscriptions: liveSubscriptionsInclude(),
        _count: { select: { products: { where: { isForSale: true, ...PUBLIC_PRODUCT } } } },
      },
      take: DIRECTORY_SCAN_LIMIT,
    });

    const fallback = await this.visibility.defaultPlan();
    const ranked = makers
      .map((maker) => ({ maker, resolved: this.visibility.resolve(maker.subscriptions, fallback) }))
      .sort(
        (a, b) =>
          Number(b.resolved.plan.boostInDirectory) - Number(a.resolved.plan.boostInDirectory) ||
          Number(b.maker.isFeatured) - Number(a.maker.isFeatured) ||
          b.maker.ratingAvg - a.maker.ratingAvg ||
          a.maker.shopName.localeCompare(b.maker.shopName, 'fr'),
      );

    const offset = Math.max(0, Number.parseInt(query.cursor ?? '0', 10) || 0);
    const slice = ranked.slice(offset, offset + query.limit);

    return {
      items: slice.map(({ maker, resolved }) =>
        toMakerCard(maker, this.context(resolved, maker._count.products)),
      ),
      nextCursor: offset + query.limit < ranked.length ? String(offset + query.limit) : null,
      total: ranked.length,
    };
  }

  // ── Administration ──

  async listForAdmin(status?: string): Promise<AdminMaker[]> {
    const makers = await this.prisma.makerProfile.findMany({
      where: {
        deletedAt: null,
        ...(status ? { kycStatus: status as 'PENDING' } : {}),
      },
      include: { ...WITH_PLACE, subscriptions: liveSubscriptionsInclude() },
      orderBy: { kycSubmittedAt: 'asc' },
      take: 100,
    });
    const fallback = await this.visibility.defaultPlan();
    return makers.map((maker) =>
      toAdminMaker(maker, this.context(this.visibility.resolve(maker.subscriptions, fallback))),
    );
  }

  async reviewKyc(
    makerId: string,
    reviewerId: string,
    input: KycReviewInput,
  ): Promise<AdminMaker> {
    const maker = await this.prisma.makerProfile.findUnique({ where: { id: makerId } });
    if (!maker) throw new NotFoundException();

    if (input.decision === 'REJECT' && !input.reason) {
      // Un refus sans motif ne dit pas au créateur quoi corriger : il
      // redéposera le même dossier, et le travail sera à refaire des deux côtés.
      throw new BadRequestException('Un refus doit être motivé.');
    }

    const approved = input.decision === 'APPROVE';

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.makerProfile.update({
        where: { id: makerId },
        data: {
          kycStatus: approved ? 'APPROVED' : 'REJECTED',
          kycReviewedAt: new Date(),
          kycReviewerId: reviewerId,
          kycRejectReason: approved ? null : (input.reason ?? null),
        },
        include: WITH_PLACE,
      });

      // Le compte utilisateur suit la décision : un créateur validé devient
      // actif, un créateur refusé ne peut rien publier.
      await tx.user.update({
        where: { id: maker.userId },
        data: { status: approved ? 'ACTIVE' : 'REJECTED' },
      });

      /* Un atelier dont l'agrément est retiré ne doit pas garder ses fiches en
         ligne — c'est tout l'intérêt de la validation. */
      if (!approved) {
        await tx.product.updateMany({
          where: { makerId, status: 'PUBLISHED' },
          data: { status: 'ARCHIVED' },
        });
      }

      await tx.auditLog.create({
        data: {
          actorId: reviewerId,
          actorRole: 'ADMIN',
          action: approved ? 'maker.kyc.approve' : 'maker.kyc.reject',
          targetType: 'MakerProfile',
          targetId: makerId,
          after: { kycStatus: approved ? 'APPROVED' : 'REJECTED', reason: input.reason ?? null },
        },
      });

      return result;
    });

    /* Un refus sans motif transmis fait redéposer le même dossier
       indéfiniment, et l'équipe le retraite à chaque fois. */
    await this.notifications.kycDecision(
      updated.userId,
      approved,
      'MAKER',
      input.reason ?? null,
    );

    this.logger.log(`Dossier ${makerId} ${approved ? 'validé' : 'refusé'} par ${reviewerId}`);
    return toAdminMaker(updated, await this.contextFor(updated));
  }

  /**
   * Identifiant d'URL unique. On ajoute un suffixe plutôt que de refuser le
   * nom : deux ateliers peuvent légitimement s'appeler « Atelier Sènou ».
   */
  private async uniqueSlug(shopName: string): Promise<string> {
    const base =
      shopName
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 60) || 'atelier';

    for (let suffix = 0; suffix < 100; suffix++) {
      const candidate = suffix === 0 ? base : `${base}-${suffix + 1}`;
      const taken = await this.prisma.makerProfile.findUnique({ where: { slug: candidate } });
      if (!taken) return candidate;
    }

    return `${base}-${Date.now().toString(36)}`;
  }
}

/**
 * Ne retient que les clés réellement fournies.
 *
 * Nécessaire avec `exactOptionalPropertyTypes` : passer `{ description:
 * undefined }` à Prisma n'est pas la même chose que ne pas passer la clé, et
 * la première forme est refusée par le typage. Le type de retour retire donc
 * explicitement `undefined` des valeurs — sans quoi on le réintroduirait par
 * la porte de derrière.
 */
type Defined<T, K extends keyof T> = { [P in K]?: Exclude<T[P], undefined> };

function optional<T extends object, K extends keyof T>(
  source: T,
  keys: readonly K[],
): Defined<T, K> {
  const result: Defined<T, K> = {};
  for (const key of keys) {
    const value = source[key];
    if (value !== undefined) result[key] = value as Exclude<T[K], undefined>;
  }
  return result;
}

/** Textes publics du profil, où un numéro ou une adresse e-mail n'a pas sa place. */
const PUBLIC_TEXT_FIELDS = ['shopName', 'description', 'activityField', 'services'] as const;

/**
 * Refuse les coordonnées directes dans les textes publics du profil
 * (§ 2.2 C). Chaque erreur porte le nom de son champ, pour que le formulaire
 * l'affiche au bon endroit.
 */
function assertNoContactDetails(
  input: Partial<Record<(typeof PUBLIC_TEXT_FIELDS)[number], string | undefined>>,
): void {
  const errors: { field: string; message: string }[] = [];
  for (const field of PUBLIC_TEXT_FIELDS) {
    const value = input[field];
    if (!value) continue;
    const problem = findContactDetails(value);
    if (problem) errors.push({ field, message: problem });
  }
  if (errors.length > 0) {
    throw new BadRequestException({
      error: 'Coordonnées dans le profil public',
      message: 'Votre profil public ne peut pas contenir de coordonnées directes.',
      errors,
    });
  }
}
