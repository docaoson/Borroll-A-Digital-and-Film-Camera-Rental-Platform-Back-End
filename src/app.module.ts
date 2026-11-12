import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { JwtModule } from '@nestjs/jwt';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { BACKEND_ENV_FILE_PATH, validate } from './config/env.validation';
import { HealthModule } from './health/health.module';
import { DatabaseModule } from './infra/database/database.module';
import { StorageModule } from './infra/storage/storage.module';
import { ExpirePendingBookingsJob } from './jobs/expire-pending-bookings.job';
import { AdminModule } from './modules/admin';
import { BookingModule } from './modules/booking';
import { CatalogModule } from './modules/catalog';
import { IdentityModule } from './modules/identity/identity.module';
import { InventoryModule } from './modules/inventory';
import { OperationsModule } from './modules/operations';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [BACKEND_ENV_FILE_PATH, '.env'],
      validate,
    }),
    JwtModule.register({
      global: true,
    }),
    EventEmitterModule.forRoot(),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([
      {
        ttl: 60000,
        limit: 100,
      },
    ]),
    DatabaseModule,
    StorageModule,
    HealthModule,
    IdentityModule,
    InventoryModule,
    CatalogModule,
    BookingModule,
    OperationsModule,
    AdminModule,
  ],
  providers: [
    ExpirePendingBookingsJob,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
  ],
})
export class AppModule {}
