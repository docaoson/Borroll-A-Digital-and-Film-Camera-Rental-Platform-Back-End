import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity';
import { AdminController } from './admin.controller';

@Module({
  imports: [IdentityModule],
  controllers: [AdminController],
})
export class AdminModule {}
