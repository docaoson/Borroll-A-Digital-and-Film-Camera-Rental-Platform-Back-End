import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { IdentityController } from './identity.controller';
import { IdentityService } from './identity.service';

@Module({
  imports: [JwtModule.register({})],
  controllers: [IdentityController],
  providers: [IdentityService],
  exports: [IdentityService],
})
export class IdentityModule {}
