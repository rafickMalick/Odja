import { Module } from '@nestjs/common';

import { MakerModule } from '../makers/maker.module';
import {
  CatalogAdminController,
  CatalogPublicController,
  MakerProductController,
} from './catalog.controller';
import { CategoryService } from './category.service';
import { GeoController } from './geo.controller';
import { ProductImageService } from './product-image.service';
import { ProductService } from './product.service';
import { SearchService } from './search.service';

@Module({
  imports: [MakerModule],
  controllers: [
    CatalogPublicController,
    GeoController,
    MakerProductController,
    CatalogAdminController,
  ],
  providers: [CategoryService, ProductService, ProductImageService, SearchService],
  exports: [ProductService],
})
export class CatalogModule {}
