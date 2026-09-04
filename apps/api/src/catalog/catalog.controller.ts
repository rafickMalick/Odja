import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  attachProductImageSchema,
  catalogQuerySchema,
  categorySchema,
  productReviewSchema,
  productSchema,
  productUpdateSchema,
  reorderProductImagesSchema,
  stockUpdateSchema,
  type CatalogQuery,
  type CategoryInput,
  type Page,
  type ProductInput,
  type ProductReviewInput,
  type AttachProductImageInput,
  type ProductImageView,
  type ProductUpdateInput,
  type PublicCategory,
  type PublicProduct,
} from '@oja/contracts';

import { CurrentUser, type AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { ZodValidationPipe, zodBody } from '../common/zod.pipe';
import { CategoryService } from './category.service';
import { ProductImageService } from './product-image.service';
import { ProductService } from './product.service';
import { SearchService } from './search.service';

/** Catalogue public — aucune authentification. */
@Controller('catalog')
export class CatalogPublicController {
  constructor(
    private readonly categories: CategoryService,
    private readonly products: ProductService,
    private readonly search: SearchService,
  ) {}

  @Public()
  @Get('categories')
  async categoryTree(): Promise<PublicCategory[]> {
    return this.categories.tree();
  }

  @Public()
  @Get('products')
  async list(
    @Query(new ZodValidationPipe(catalogQuerySchema)) query: CatalogQuery,
  ): Promise<Page<PublicProduct>> {
    return this.search.search(query);
  }

  @Public()
  @Get('facets')
  async facets() {
    return this.search.facets();
  }

  // Déclaré après /facets : sans cela, « facets » serait capté comme un slug.
  @Public()
  @Get('products/:slug')
  async bySlug(@Param('slug') slug: string): Promise<PublicProduct> {
    return this.products.publicBySlug(slug);
  }
}

/** Gestion des fiches par le créateur. Chacun ne voit que les siennes. */
@Controller('maker/products')
@Roles('MAKER')
export class MakerProductController {
  constructor(
    private readonly products: ProductService,
    private readonly images: ProductImageService,
  ) {}

  /* ── Photos ──
     Le fichier est envoyé au stockage par le navigateur, avec une URL signée
     obtenue sur /uploads/ticket. On ne rattache ici que la clé obtenue. */

  @Get(':id/images')
  async listImages(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<ProductImageView[]> {
    return this.images.list(user.id, id);
  }

  @Post(':id/images')
  async attachImage(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(zodBody(attachProductImageSchema)) input: AttachProductImageInput,
  ): Promise<ProductImageView[]> {
    return this.images.attach(user.id, id, input.fileKey, input.alt);
  }

  @Patch(':id/images/order')
  async reorderImages(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(zodBody(reorderProductImagesSchema)) input: { imageIds: string[] },
  ): Promise<ProductImageView[]> {
    return this.images.reorder(user.id, id, input.imageIds);
  }

  @Delete(':id/images/:imageId')
  async removeImage(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('imageId') imageId: string,
  ): Promise<ProductImageView[]> {
    return this.images.remove(user.id, id, imageId);
  }

  @Post()
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(productSchema)) input: ProductInput,
  ) {
    const product = await this.products.create(user.id, input);
    return { id: product.id, slug: product.slug, status: product.status };
  }

  @Get()
  async list(@CurrentUser() user: AuthenticatedUser, @Query('status') status?: string) {
    const products = await this.products.listMine(user.id, status);
    return products.map((product) => ({
      id: product.id,
      slug: product.slug,
      name: product.name,
      status: product.status,
      makerPriceXof: product.makerPriceXof,
      quantityAvailable: product.quantityAvailable,
      quantityReserved: product.quantityReserved,
      imageCount: product.images.length,
      rejectReason: product.rejectReason,
      updatedAt: product.updatedAt,
    }));
  }

  /** Fiche complète, pour l'édition. Déclarée après `@Get()` sans paramètre. */
  @Get(':id')
  async one(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    const product = await this.products.mineById(user.id, id);
    return {
      id: product.id,
      slug: product.slug,
      name: product.name,
      status: product.status,
      categoryId: product.categoryId,
      description: product.description,
      material: product.material,
      makerPriceXof: product.makerPriceXof,
      commissionBps: product.commissionBps,
      isMadeToOrder: product.isMadeToOrder,
      quantityAvailable: product.quantityAvailable,
      quantityReserved: product.quantityReserved,
      leadTimeDays: product.leadTimeDays,
      observations: product.observations,
      weightGrams: product.weightGrams,
      lengthMm: product.lengthMm,
      widthMm: product.widthMm,
      heightMm: product.heightMm,
      rejectReason: product.rejectReason,
      images: await this.images.list(user.id, id),
      /** Ce qui manque encore pour la mise en vente, tout à la fois. */
      blockers: product.blockers,
    };
  }

  @Patch(':id')
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(zodBody(productUpdateSchema)) input: ProductUpdateInput,
  ) {
    const product = await this.products.update(user.id, id, input);
    return { id: product.id, status: product.status };
  }

  @Post(':id/submit')
  async submit(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.products.submit(user.id, id);
  }

  @Post(':id/archive')
  async archive(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.products.archive(user.id, id);
  }

  @Patch(':id/stock')
  async setStock(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(zodBody(stockUpdateSchema)) input: { quantityAvailable: number },
  ) {
    return this.products.setStock(user.id, id, input.quantityAvailable);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<void> {
    await this.products.remove(user.id, id);
  }
}

/** Modération du catalogue par l'équipe Ojà. */
@Controller('admin/catalog')
@Roles('ADMIN')
export class CatalogAdminController {
  constructor(
    private readonly products: ProductService,
    private readonly categories: CategoryService,
  ) {}

  /* La file de modération porte tout ce qu'il faut pour décider : photos,
     description, dimensions. Sans elles, l'administration valide un nom et un
     prix — ce qui ne modère rien. */
  @Get('products/pending')
  async pending() {
    const products = await this.products.listPendingReview();
    return products.map((product) => ({
      id: product.id,
      slug: product.slug,
      name: product.name,
      description: product.description,
      material: product.material,
      categoryName: product.category.name,
      makerId: product.makerId,
      makerShopName: product.maker.shopName,
      makerCity: product.maker.city.name,
      makerPriceXof: product.makerPriceXof,
      commissionBps: product.maker.commissionBps,
      isMadeToOrder: product.isMadeToOrder,
      leadTimeDays: product.leadTimeDays,
      quantityAvailable: product.quantityAvailable,
      dimensions: {
        lengthMm: product.lengthMm,
        widthMm: product.widthMm,
        heightMm: product.heightMm,
        weightGrams: product.weightGrams,
      },
      images: this.products.imageUrls(product.images),
      imageCount: product.images.length,
      submittedAt: product.submittedAt,
    }));
  }

  @Post('products/:id/review')
  async review(
    @Param('id') id: string,
    @CurrentUser() admin: AuthenticatedUser,
    @Body(zodBody(productReviewSchema)) input: ProductReviewInput,
  ) {
    return this.products.review(id, admin.id, input);
  }

  @Post('products/:id/hide')
  @HttpCode(204)
  async hide(@Param('id') id: string, @CurrentUser() admin: AuthenticatedUser): Promise<void> {
    await this.products.setHidden(id, admin.id, true);
  }

  @Post('products/:id/unhide')
  @HttpCode(204)
  async unhide(@Param('id') id: string, @CurrentUser() admin: AuthenticatedUser): Promise<void> {
    await this.products.setHidden(id, admin.id, false);
  }

  @Post('categories')
  async createCategory(
    @Body(zodBody(categorySchema)) input: CategoryInput,
  ): Promise<PublicCategory> {
    return this.categories.create(input);
  }

  @Delete('categories/:id')
  @HttpCode(204)
  async removeCategory(@Param('id') id: string): Promise<void> {
    await this.categories.remove(id);
  }
}
