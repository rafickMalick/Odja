import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type {
  AdminMaker,
  KycReviewInput,
  MakerProfileInput,
  MakerProfileUpdateInput,
  OwnMakerProfile,
  PublicMaker,
} from '@oja/contracts';

import { PrismaService } from '../prisma/prisma.service';
import { toAdminMaker, toOwnMakerProfile, toPublicMaker } from './maker.mapper';
import { NotificationService } from '../notifications/notification.service';

/* Pas de `as const` : Prisma dérive le type de retour de l'objet `include`,
   et un littéral figé en lecture seule lui fait perdre la relation — les
   appelants reçoivent alors un profil sans sa ville. */
const WITH_PLACE = {
  city: { include: { country: { select: { name: true } } } },
};

@Injectable()
export class MakerService {
  private readonly logger = new Logger(MakerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {}

  async createProfile(userId: string, input: MakerProfileInput): Promise<AdminMaker> {
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
        ]),
      },
      include: WITH_PLACE,
    });

    return toAdminMaker(maker);
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
    return toOwnMakerProfile(maker, productCount);
  }

  async updateProfile(userId: string, input: MakerProfileUpdateInput): Promise<AdminMaker> {
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
        ]),
        ...(touchesIdentity && maker.kycStatus === 'APPROVED'
          ? { kycStatus: 'PENDING' as const, kycSubmittedAt: new Date() }
          : {}),
      },
      include: WITH_PLACE,
    });

    return toAdminMaker(updated);
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
      where: { makerId: maker.id, status: 'PUBLISHED', hiddenAt: null, deletedAt: null },
    });
    return toPublicMaker(maker, productCount);
  }

  // ── Administration ──

  async listForAdmin(status?: string): Promise<AdminMaker[]> {
    const makers = await this.prisma.makerProfile.findMany({
      where: {
        deletedAt: null,
        ...(status ? { kycStatus: status as 'PENDING' } : {}),
      },
      include: WITH_PLACE,
      orderBy: { kycSubmittedAt: 'asc' },
      take: 100,
    });
    return makers.map((maker) => toAdminMaker(maker));
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
    return toAdminMaker(updated);
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
