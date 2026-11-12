import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory';
import { CatalogAdminController } from './catalog-admin.controller';
import { CatalogController } from './catalog.controller';
import { CatalogService } from './catalog.service';

@Module({
  imports: [InventoryModule],
  controllers: [CatalogController, CatalogAdminController],
  providers: [CatalogService],
  exports: [CatalogService],
})
export class CatalogModule {}
