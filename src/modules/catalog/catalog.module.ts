import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory';
import { CatalogAdminController } from './catalog-admin.controller';
import { CatalogController } from './catalog.controller';
import { CatalogService } from './catalog.service';
import {
  BranchService,
  BrandService,
  CategoryService,
  ContactSettingsService,
  FavoriteService,
  FilmProductService,
  ModelService,
} from './services';

const catalogServices = [
  CatalogService,
  BranchService,
  CategoryService,
  BrandService,
  FilmProductService,
  ContactSettingsService,
  FavoriteService,
  ModelService,
];

@Module({
  imports: [InventoryModule],
  controllers: [CatalogController, CatalogAdminController],
  providers: catalogServices,
  exports: catalogServices,
})
export class CatalogModule {}
