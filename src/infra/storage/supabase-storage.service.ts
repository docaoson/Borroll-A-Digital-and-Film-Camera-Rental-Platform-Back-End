import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { StorageService } from './storage.service';

@Injectable()
export class SupabaseStorageService implements StorageService {
  private readonly supabase: SupabaseClient;
  private readonly logger = new Logger(SupabaseStorageService.name);

  constructor(private readonly configService: ConfigService) {
    const supabaseUrl = this.configService.get<string>('SUPABASE_URL')!;
    const supabaseServiceKey = this.configService.get<string>(
      'SUPABASE_SERVICE_ROLE_KEY',
    )!;

    this.supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
  }

  async createUploadUrl(
    bucket: string,
    path: string,
    _contentType?: string,
  ): Promise<string> {
    const { data, error } = await this.supabase.storage
      .from(bucket)
      .createSignedUploadUrl(path);

    if (error || !data) {
      this.logger.error(`Failed to create signed upload URL: ${error?.message}`);
      throw new Error(`Storage upload URL creation failed: ${error?.message}`);
    }

    return data.signedUrl;
  }

  getPublicUrl(bucket: string, path: string): string {
    const { data } = this.supabase.storage.from(bucket).getPublicUrl(path);
    return data.publicUrl;
  }

  async createSignedUrl(
    bucket: string,
    path: string,
    ttlSeconds: number,
  ): Promise<string> {
    const { data, error } = await this.supabase.storage
      .from(bucket)
      .createSignedUrl(path, ttlSeconds);

    if (error || !data) {
      this.logger.error(`Failed to create signed read URL: ${error?.message}`);
      throw new Error(`Storage signed URL creation failed: ${error?.message}`);
    }

    return data.signedUrl;
  }

  async remove(bucket: string, path: string): Promise<void> {
    const { error } = await this.supabase.storage.from(bucket).remove([path]);
    if (error) {
      this.logger.warn(
        `Failed to remove file ${path} from bucket ${bucket}: ${error.message}`,
      );
    }
  }
}

