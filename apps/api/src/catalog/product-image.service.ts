import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { ProductImageView } from '@oja/contracts';
import { MAX_PHOTOS, MIN_PHOTOS } from '@oja/domain';

import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

/**
 * Photos d'une fiche produit.
 *
 * Le cahier client impose **entre 3 et 5 photos**. La borne haute est
 * appliquée ici, à l'ajout : refuser une sixième photo au moment de la mise en
 * vente ferait perdre à l'artisan le travail de téléversement.
 */
@Injectable()
export class ProductImageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async list(userId: string, productId: string): Promise<ProductImageView[]> {
    await this.requireOwnProduct(userId, productId);
    return this.viewsFor(productId);
  }

  async attach(
    userId: string,
    productId: string,
    fileKey: string,
    alt?: string,
  ): Promise<ProductImageView[]> {
    await this.requireOwnProduct(userId, productId);

    const count = await this.prisma.productImage.count({ where: { productId } });
    if (count >= MAX_PHOTOS) {
      throw new BadRequestException(
        `Cinq photos au maximum. Retirez-en une avant d'en ajouter une autre.`,
      );
    }

    /* On vérifie que le fichier est bien arrivé au stockage. Sans ce contrôle,
       une clé inventée passerait, et la fiche partirait en validation avec des
       images fantômes. */
    await this.storage.assertExists(fileKey);

    await this.prisma.productImage.create({
      data: {
        productId,
        fileKey,
        position: count,
        ...(alt ? { alt } : {}),
      },
    });

    return this.viewsFor(productId);
  }

  /**
   * Retire une photo et **resserre les positions**.
   *
   * Laisser des trous (0, 2, 3) n'a pas d'effet visible tout de suite, mais
   * une réorganisation ultérieure produit alors un ordre imprévisible.
   */
  async remove(userId: string, productId: string, imageId: string): Promise<ProductImageView[]> {
    await this.requireOwnProduct(userId, productId);

    const image = await this.prisma.productImage.findFirst({
      where: { id: imageId, productId },
    });
    if (!image) throw new NotFoundException();

    await this.prisma.$transaction(async (tx) => {
      await tx.productImage.delete({ where: { id: imageId } });

      const remaining = await tx.productImage.findMany({
        where: { productId },
        orderBy: { position: 'asc' },
      });

      for (const [position, item] of remaining.entries()) {
        if (item.position !== position) {
          await tx.productImage.update({ where: { id: item.id }, data: { position } });
        }
      }
    });

    // Le fichier part aussi : garder des octets orphelins coûte, et une photo
    // retirée d'une fiche n'a plus de raison d'être lisible.
    await this.storage.remove(image.fileKey);

    return this.viewsFor(productId);
  }

  async reorder(
    userId: string,
    productId: string,
    imageIds: string[],
  ): Promise<ProductImageView[]> {
    await this.requireOwnProduct(userId, productId);

    const images = await this.prisma.productImage.findMany({ where: { productId } });

    /* La liste doit être une permutation exacte : une liste partielle
       laisserait des photos sans position définie, et la première image —
       celle qui sert de vignette — deviendrait arbitraire. */
    if (imageIds.length !== images.length) {
      throw new BadRequestException(
        `Indiquez les ${images.length} photos dans l'ordre voulu.`,
      );
    }

    const known = new Set(images.map((image) => image.id));
    if (imageIds.some((id) => !known.has(id)) || new Set(imageIds).size !== imageIds.length) {
      throw new BadRequestException('Liste de photos invalide.');
    }

    await this.prisma.$transaction(
      imageIds.map((id, position) =>
        this.prisma.productImage.update({ where: { id }, data: { position } }),
      ),
    );

    return this.viewsFor(productId);
  }

  /** Ce qui manque en photos pour pouvoir mettre en vente. */
  async photoStatus(productId: string): Promise<{ count: number; missing: number }> {
    const count = await this.prisma.productImage.count({ where: { productId } });
    return { count, missing: Math.max(0, MIN_PHOTOS - count) };
  }

  private async viewsFor(productId: string): Promise<ProductImageView[]> {
    const images = await this.prisma.productImage.findMany({
      where: { productId },
      orderBy: { position: 'asc' },
    });

    return images.map((image) => ({
      id: image.id,
      url: this.storage.publicUrlFor(image.fileKey),
      alt: image.alt,
      position: image.position,
    }));
  }

  /** Un créateur qui vise la fiche d'un confrère reçoit 404, jamais 403. */
  private async requireOwnProduct(userId: string, productId: string): Promise<void> {
    const maker = await this.prisma.makerProfile.findUnique({ where: { userId } });
    if (!maker) throw new NotFoundException();

    const product = await this.prisma.product.findFirst({
      where: { id: productId, makerId: maker.id, deletedAt: null },
      select: { id: true },
    });
    if (!product) throw new NotFoundException();
  }
}
