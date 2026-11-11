import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog';
import { InventoryModule } from '../inventory';
import { BookingController } from './booking.controller';
import { BookingService } from './booking.service';
import { PricingService } from './pricing.service';

@Module({
  imports: [CatalogModule, InventoryModule],
  controllers: [BookingController],
  providers: [PricingService, BookingService],
  exports: [BookingService, PricingService],
})
export class BookingModule {}

