import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog';
import { InventoryModule } from '../inventory';
import { BookingController } from './booking.controller';
import { BookingService } from './booking.service';
import { PricingService } from './pricing.service';
import { PaymentService } from './payment.service';
import { RenterPaymentController, StaffPaymentController } from './payment.controller';

@Module({
  imports: [CatalogModule, InventoryModule],
  controllers: [BookingController, RenterPaymentController, StaffPaymentController],
  providers: [PricingService, BookingService, PaymentService],
  exports: [BookingService, PricingService],
})
export class BookingModule {}
