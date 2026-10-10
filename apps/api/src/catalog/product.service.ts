import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  ProductInput,
  ProductReviewInput,
  ProductUpdateInput,
  PublicProduct,
} from '@oja/contracts';
import type { City, Category, MakerProfile, Product, ProductImage } from '@oja/db';
import {
  assertProductTransition,
  commissionFor,
  displayAvailability,
  isPurchasable,
  whyNotSubmittable,
} from '@oja/domain';

import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { NotificationService } from '../notifications/notification.service';
import { VisibilityService } from '../makers/visibility.service';

/* Pas de `as const` : Prisma dérive le type de retour de l'objet `include`,
   et un littéral figé en lecture seule lui fait perdre les relations. */
const WITH_RELATIONS = {
  category: true,
  images: { orderBy: { position: 'asc' as const } },
  maker: { include: { city: true } },
};

type FullProduct = Product & {
  category: Category;
  images: ProductImage[];
  maker: MakerProfile & { city: City };
};

@Injectable()
export class ProductService {
  private readonly logger = new Logger(ProductService.name);
  private readonly defaultCommissionBps: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly notifications: NotificationService,
    private readonly visibility: VisibilityService,
    config: ConfigService,
  ) {
    this.defaultCommissionBps = config.get<number>('PLATFORM_COMMISSION_BPS', 500);
  }

  // ═══════════════════════════════ Espace créateur

  async create(userId: string, input: ProductInput): Promise<FullProduct> {
    const maker = await this.requireMaker(userId);

    const category = await this.prisma.category.findUnique({
      where: { id: input.categoryId },
    });
    if (!category) throw new BadRequestException('Catégorie inconnue.');

    /* Le quota de la formule se vérifie à la création : refuser plus tard, à
       la mise en ligne, ferait perdre la saisie et les photos. */
    await this.visibility.assertCanAddProduct(maker.id);

    /* Une réalisation de portfolio n'a ni prix ni colis : les colonnes,
       obligatoires en base, valent alors 0. */
    return this.prisma.product.create({
      data: {
        makerId: maker.id,
        slug: await this.uniqueSlug(input.name),
        name: input.name,
        categoryId: input.categoryId,
        description: input.description,
        isForSale: input.isForSale,
        availability: input.availability,
        makerPriceXof: input.makerPriceXof ?? 0,
        isMadeToOrder: input.isForSale && input.isMadeToOrder,
        quantityAvailable: input.isForSale ? input.quantityAvailable : 0,
        weightGrams: input.weightGrams ?? 0,
        lengthMm: input.lengthMm ?? 0,
        widthMm: input.widthMm ?? 0,
        heightMm: input.heightMm ?? 0,
        status: 'DRAFT',
        ...defined(input, ['material', 'leadTimeDays', 'observations']),
      },
      include: WITH_RELATIONS,
    });
  }

  async listMine(userId: string, status?: string): Promise<FullProduct[]> {
    const maker = await this.requireMaker(userId);
    return this.prisma.product.findMany({
      where: {
        makerId: maker.id,
        deletedAt: null,
        ...(status ? { status: status as 'DRAFT' } : {}),
      },
      include: WITH_RELATIONS,
      orderBy: { updatedAt: 'desc' },
    });
  }

  /**
   * Une fiche du créateur, telle qu'il l'édite.
   *
   * On y joint ce qui manque encore pour la mettre en vente. Le calcul est
   * déjà fait par `submit()`, mais l'y laisser seul obligerait l'artisan à
   * cliquer pour découvrir qu'il lui manque une photo : la liste est donnée
   * d'avance, à l'écran.
   */
  async mineById(
    userId: string,
    productId: string,
  ): Promise<FullProduct & { blockers: string[]; commissionBps: number }> {
    const maker = await this.requireMaker(userId);
    const product = await this.prisma.product.findFirst({
      where: { id: productId, makerId: maker.id, deletedAt: null },
      include: WITH_RELATIONS,
    });
    if (!product) throw new NotFoundException();

    const blockers = whyNotSubmittable({
      isForSale: product.isForSale,
      imageCount: product.images.length,
      makerKycApproved: maker.kycStatus === 'APPROVED',
      isMadeToOrder: product.isMadeToOrder,
      leadTimeDays: product.leadTimeDays,
      quantityAvailable: product.quantityAvailable,
      makerPriceXof: product.makerPriceXof,
    });

    return {
      ...product,
      blockers,
      commissionBps: maker.commissionBps,
    };
  }

  async update(
    userId: string,
    productId: string,
    input: ProductUpdateInput,
  ): Promise<FullProduct> {
    const product = await this.requireOwnProduct(userId, productId);

    /* Une fiche en ligne que le créateur modifie repasse en validation.
       Sans cette règle, on publierait un fauteuil à 150 000 F et on le
       remplacerait ensuite par autre chose, hors du regard de l'administration. */
    /* Changer seulement la disponibilité — « vendu », « indisponible » — ne
       touche pas au contenu vérifié : la fiche reste en ligne. */
    const contentKeys = Object.keys(input).filter(
      (key) => key !== 'availability' && input[key as keyof ProductUpdateInput] !== undefined,
    );
    const backToReview = product.status === 'PUBLISHED' && contentKeys.length > 0;

    /* Passer une pièce en vente exige ce qu'exige la création : un prix et un
       colis. On contrôle sur l'état final, fiche existante comprise. */
    const forSale = input.isForSale ?? product.isForSale;
    if (forSale && !product.isForSale) {
      const missing = (['makerPriceXof', 'weightGrams', 'lengthMm', 'widthMm', 'heightMm'] as const)
        .filter((field) => !(input[field] ?? product[field]));
      if (missing.length > 0) {
        throw new BadRequestException({
          error: 'Fiche incomplète',
          message: 'Indiquez le prix, le poids et les dimensions pour mettre cette pièce en vente.',
          errors: missing.map((field) => ({ field, message: 'Requis pour une pièce à vendre' })),
        });
      }
    }

    const updated = await this.prisma.product.update({
      where: { id: productId },
      data: {
        ...defined(input, [
          'name',
          'categoryId',
          'description',
          'material',
          'isForSale',
          'availability',
          'makerPriceXof',
          'isMadeToOrder',
          'quantityAvailable',
          'leadTimeDays',
          'observations',
          'weightGrams',
          'lengthMm',
          'widthMm',
          'heightMm',
        ]),
        ...(forSale ? {} : { isMadeToOrder: false }),
        ...(backToReview ? { status: 'PENDING_REVIEW' as const, reviewedAt: null } : {}),
      },
      include: WITH_RELATIONS,
    });

    return updated;
  }

  /** Dépôt de la fiche à la modération. */
  async submit(userId: string, productId: string): Promise<{ status: string }> {
    const product = await this.requireOwnProduct(userId, productId);
    const maker = await this.requireMaker(userId);

    const imageCount = await this.prisma.productImage.count({ where: { productId } });

    const problems = whyNotSubmittable({
      isForSale: product.isForSale,
      imageCount,
      makerKycApproved: maker.kycStatus === 'APPROVED',
      isMadeToOrder: product.isMadeToOrder,
      leadTimeDays: product.leadTimeDays,
      quantityAvailable: product.quantityAvailable,
      makerPriceXof: product.makerPriceXof,
    });

    if (problems.length > 0) {
      throw new BadRequestException({
        error: 'Fiche incomplète',
        message: 'Cette fiche ne peut pas encore être mise en vente.',
        errors: problems.map((message: string) => ({ field: 'product', message })),
      });
    }

    assertProductTransition(product.status, 'PENDING_REVIEW');

    await this.prisma.product.update({
      where: { id: productId },
      data: { status: 'PENDING_REVIEW', submittedAt: new Date(), rejectReason: null },
    });

    return { status: 'PENDING_REVIEW' };
  }

  async archive(userId: string, productId: string): Promise<{ status: string }> {
    const product = await this.requireOwnProduct(userId, productId);
    assertProductTransition(product.status, 'ARCHIVED');

    await this.prisma.product.update({
      where: { id: productId },
      data: { status: 'ARCHIVED' },
    });
    return { status: 'ARCHIVED' };
  }

  /**
   * Suppression **logique**. Une fiche référencée par une commande passée ne
   * disparaît jamais : la facture doit rester lisible dix ans plus tard.
   */
  async remove(userId: string, productId: string): Promise<void> {
    await this.requireOwnProduct(userId, productId);
    await this.prisma.product.update({
      where: { id: productId },
      data: { deletedAt: new Date(), status: 'ARCHIVED' },
    });
  }

  async setStock(
    userId: string,
    productId: string,
    quantityAvailable: number,
  ): Promise<{ quantityAvailable: number; reserved: number }> {
    const product = await this.requireOwnProduct(userId, productId);

    /* Le stock ne peut pas descendre sous ce qui est déjà réservé par des
       commandes en cours : on aurait vendu des pièces qu'on ne peut plus
       livrer. */
    if (quantityAvailable < product.quantityReserved) {
      throw new BadRequestException(
        `${product.quantityReserved} pièce(s) sont réservées par des commandes en cours : ` +
          'le stock ne peut pas descendre en dessous.',
      );
    }

    const updated = await this.prisma.product.update({
      where: { id: productId },
      data: { quantityAvailable },
    });

    return {
      quantityAvailable: updated.quantityAvailable,
      reserved: updated.quantityReserved,
    };
  }

  // ═══════════════════════════════ Modération

  /** Clés de stockage converties en URL de lecture. */
  imageUrls(images: ProductImage[]): { url: string; alt: string | null }[] {
    return images.map((image) => ({
      url: this.storage.publicUrlFor(image.fileKey),
      alt: image.alt,
    }));
  }

  async listPendingReview(): Promise<FullProduct[]> {
    return this.prisma.product.findMany({
      where: { status: 'PENDING_REVIEW', deletedAt: null },
      include: WITH_RELATIONS,
      orderBy: { submittedAt: 'asc' },
      take: 100,
    });
  }

  async review(
    productId: string,
    reviewerId: string,
    input: ProductReviewInput,
  ): Promise<{ status: string }> {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, deletedAt: null },
    });
    if (!product) throw new NotFoundException();

    if (input.decision === 'REJECT' && !input.reason) {
      throw new BadRequestException('Un refus doit être motivé.');
    }

    const target = input.decision === 'PUBLISH' ? 'PUBLISHED' : 'REJECTED';
    assertProductTransition(product.status, target);

    await this.prisma.$transaction([
      this.prisma.product.update({
        where: { id: productId },
        data: {
          status: target,
          reviewedAt: new Date(),
          reviewerId,
          rejectReason: target === 'REJECTED' ? (input.reason ?? null) : null,
        },
      }),
      this.prisma.auditLog.create({
        data: {
          actorId: reviewerId,
          actorRole: 'ADMIN',
          action: target === 'PUBLISHED' ? 'product.publish' : 'product.reject',
          targetType: 'Product',
          targetId: productId,
          after: { status: target, reason: input.reason ?? null },
        },
      }),
    ]);

    await this.notifications.productDecision(
      productId,
      target === 'PUBLISHED',
      input.reason ?? null,
    );

    return { status: target };
  }

  /** Masquage par un administrateur, distinct du refus à la modération. */
  async setHidden(productId: string, adminId: string, hidden: boolean): Promise<void> {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, deletedAt: null },
    });
    if (!product) throw new NotFoundException();

    await this.prisma.$transaction([
      this.prisma.product.update({
        where: { id: productId },
        data: { hiddenAt: hidden ? new Date() : null },
      }),
      this.prisma.auditLog.create({
        data: {
          actorId: adminId,
          actorRole: 'ADMIN',
          action: hidden ? 'product.hide' : 'product.unhide',
          targetType: 'Product',
          targetId: productId,
        },
      }),
    ]);
  }

  // ═══════════════════════════════ Vue publique

  async publicBySlug(slug: string): Promise<PublicProduct> {
    const product = await this.prisma.product.findFirst({
      where: { slug, status: 'PUBLISHED', hiddenAt: null, deletedAt: null },
      include: WITH_RELATIONS,
    });
    if (!product) throw new NotFoundException();
    return this.toPublic(product);
  }

  /**
   * Compose la fiche telle que le client la voit.
   *
   * Le prix affiché est **recalculé** à chaque affichage plutôt que stocké :
   * le taux de commission peut changer, et une valeur figée en base finirait
   * par mentir. Il n'est figé qu'au moment de la commande. Le client ne voit
   * que ce prix — la part créateur et la marge d'Ojà restent au back-office.
   */
  toPublic(product: FullProduct): PublicProduct {
    const commissionBps = product.maker.commissionBps || this.defaultCommissionBps;
    const commissionXof = commissionFor(product.makerPriceXof, commissionBps);

    return {
      id: product.id,
      slug: product.slug,
      name: product.name,
      description: product.description,
      material: product.material,
      category: {
        id: product.category.id,
        slug: product.category.slug,
        name: product.category.name,
      },
      maker: {
        id: product.maker.id,
        slug: product.maker.slug,
        shopName: product.maker.shopName,
        city: product.maker.city.name,
      },
      /* La clé devient une URL affichable. Les fiches de démonstration
         portent des chemins du front, les vraies photos des clés de stockage :
         le résolveur accepte les deux. */
      images: product.images.map((image) => ({
        url: this.storage.publicUrlFor(image.fileKey),
        alt: image.alt,
      })),

      finalPriceXof: product.makerPriceXof + commissionXof,

      isMadeToOrder: product.isMadeToOrder,
      leadTimeDays: product.leadTimeDays,
      quantityAvailable: product.quantityAvailable - product.quantityReserved,
      inStock:
        product.isMadeToOrder ||
        product.quantityAvailable - product.quantityReserved > 0,
      isForSale: product.isForSale,
      availability: displayAvailability(product),
      purchasable: isPurchasable(product),

      dimensions: {
        lengthMm: product.lengthMm,
        widthMm: product.widthMm,
        heightMm: product.heightMm,
        weightGrams: product.weightGrams,
      },

      ratingAvg: product.ratingAvg,
      ratingCount: product.ratingCount,
    };
  }

  // ═══════════════════════════════ Utilitaires

  private async requireMaker(userId: string): Promise<MakerProfile> {
    const maker = await this.prisma.makerProfile.findUnique({ where: { userId } });
    if (!maker) throw new NotFoundException('Aucune boutique pour ce compte.');
    return maker;
  }

  /**
   * Charge une fiche **en s'assurant qu'elle appartient au demandeur**.
   *
   * Un créateur qui demande la fiche d'un confrère reçoit `404`, jamais
   * `403` : un `403` confirmerait que la fiche existe, ce qui suffit à
   * énumérer le catalogue non publié de la concurrence.
   */
  private async requireOwnProduct(userId: string, productId: string): Promise<Product> {
    const maker = await this.requireMaker(userId);
    const product = await this.prisma.product.findFirst({
      where: { id: productId, makerId: maker.id, deletedAt: null },
    });
    if (!product) throw new NotFoundException();
    return product;
  }

  private async uniqueSlug(name: string): Promise<string> {
    const base =
      name
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 70) || 'piece';

    for (let suffix = 0; suffix < 100; suffix++) {
      const candidate = suffix === 0 ? base : `${base}-${suffix + 1}`;
      const taken = await this.prisma.product.findUnique({ where: { slug: candidate } });
      if (!taken) return candidate;
    }
    return `${base}-${Date.now().toString(36)}`;
  }
}

/** Voir maker.service.ts : `exactOptionalPropertyTypes` distingue « clé
 *  absente » de « clé à undefined », et Prisma refuse la seconde forme. */
type Defined<T, K extends keyof T> = { [P in K]?: Exclude<T[P], undefined> };

function defined<T extends object, K extends keyof T>(
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
