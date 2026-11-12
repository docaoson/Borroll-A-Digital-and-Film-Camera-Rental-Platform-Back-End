import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { BookingService } from '../modules/booking';

@Injectable()
export class ExpirePendingBookingsJob {
  constructor(private readonly bookingService: BookingService) {}

  @Cron('*/10 * * * *')
  async handleCron() {
    await this.bookingService.expirePendingBookings();
  }
}
