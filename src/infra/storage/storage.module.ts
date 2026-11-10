import { Global, Module } from '@nestjs/common';
import { STORAGE_SERVICE } from './storage.service';
import { SupabaseStorageService } from './supabase-storage.service';

@Global()
@Module({
  providers: [
    {
      provide: STORAGE_SERVICE,
      useClass: SupabaseStorageService,
    },
    SupabaseStorageService,
  ],
  exports: [STORAGE_SERVICE, SupabaseStorageService],
})
export class StorageModule {}
