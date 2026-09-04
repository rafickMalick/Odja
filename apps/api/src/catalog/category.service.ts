import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { CategoryInput, PublicCategory } from '@oja/contracts';

import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class CategoryService {
  constructor(private readonly prisma: PrismaService) {}

  /** Arbre complet, avec le nombre de pièces réellement visibles. */
  async tree(): Promise<PublicCategory[]> {
    const categories = await this.prisma.category.findMany({
      select: {
        id: true,
        slug: true,
        name: true,
        position: true,
        parentId: true,
        _count: {
          select: {
            products: { where: { status: 'PUBLISHED', hiddenAt: null, deletedAt: null } },
          },
        },
      },
      orderBy: { position: 'asc' },
    });

    const nodes = new Map<string, PublicCategory>();
    for (const category of categories) {
      nodes.set(category.id, {
        id: category.id,
        slug: category.slug,
        name: category.name,
        position: category.position,
        productCount: category._count.products,
        children: [],
      });
    }

    const roots: PublicCategory[] = [];
    for (const category of categories) {
      const node = nodes.get(category.id);
      if (!node) continue;
      const parent = category.parentId ? nodes.get(category.parentId) : undefined;
      if (parent) parent.children.push(node);
      else roots.push(node);
    }

    return roots;
  }

  async create(input: CategoryInput): Promise<PublicCategory> {
    const taken = await this.prisma.category.findUnique({ where: { slug: input.slug } });
    if (taken) throw new BadRequestException('Cet identifiant de catégorie est déjà pris.');

    const category = await this.prisma.category.create({
      data: {
        name: input.name,
        slug: input.slug,
        position: input.position,
        ...(input.parentId ? { parentId: input.parentId } : {}),
      },
    });

    return {
      id: category.id,
      slug: category.slug,
      name: category.name,
      position: category.position,
      productCount: 0,
      children: [],
    };
  }

  async remove(id: string): Promise<void> {
    const count = await this.prisma.product.count({ where: { categoryId: id, deletedAt: null } });
    if (count > 0) {
      // Supprimer la catégorie laisserait ces fiches sans rattachement, et
      // elles disparaîtraient du catalogue sans que personne ne le demande.
      throw new BadRequestException(
        `${count} produit(s) utilisent cette catégorie : déplacez-les d'abord.`,
      );
    }
    const category = await this.prisma.category.findUnique({ where: { id } });
    if (!category) throw new NotFoundException();
    await this.prisma.category.delete({ where: { id } });
  }
}
