import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient } from '@supabase/supabase-js';
import {
  AssertOwnedFileOptions,
  SignedUploadResult,
  StorageService,
} from './storage.service';

@Injectable()
export class SupabaseStorageService implements StorageService {
  private readonly supabase: ReturnType<typeof createClient>;
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
  ): Promise<SignedUploadResult> {
    const { data, error } = await this.supabase.storage
      .from(bucket)
      .createSignedUploadUrl(path);

    if (error || !data) {
      this.logger.error(
        `Failed to create signed upload URL: ${error?.message}`,
      );
      throw new ServiceUnavailableException({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Không thể tạo liên kết tải ảnh lên lúc này.',
        details: {},
      });
    }

    return {
      uploadUrl: data.signedUrl,
      path: data.path,
      token: data.token,
    };
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
      throw new ServiceUnavailableException({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Không thể tạo liên kết xem ảnh lúc này.',
        details: {},
      });
    }

    return data.signedUrl;
  }

  async assertOwnedFile(
    bucket: string,
    path: string,
    expectedPrefix: string,
    options?: AssertOwnedFileOptions,
  ): Promise<void> {
    if (!path || path.includes('..') || !path.startsWith(expectedPrefix)) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Đường dẫn tệp tin không hợp lệ.',
        details: {},
      });
    }

    const lastSlash = path.lastIndexOf('/');
    const folder = lastSlash >= 0 ? path.slice(0, lastSlash) : '';
    const fileName = lastSlash >= 0 ? path.slice(lastSlash + 1) : path;

    if (!fileName) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Đường dẫn tệp tin không hợp lệ.',
        details: {},
      });
    }

    const { data, error } = await this.supabase.storage
      .from(bucket)
      .list(folder, { search: fileName, limit: 20 });

    const matchedFile = data?.find((item) => item.name === fileName);
    if (error || !matchedFile) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Tệp tin chưa được tải lên hoặc không tồn tại.',
        details: {},
      });
    }

    const metadata = (matchedFile.metadata ?? {}) as Record<string, unknown>;
    const uploadedSize =
      typeof metadata.size === 'number' ? metadata.size : undefined;
    const uploadedMime =
      typeof metadata.mimetype === 'string'
        ? metadata.mimetype.toLowerCase()
        : undefined;

    if (
      options?.maxBytes !== undefined &&
      uploadedSize !== undefined &&
      uploadedSize > options.maxBytes
    ) {
      await this.remove(bucket, path);
      const maxMb = Math.round((options.maxBytes / (1024 * 1024)) * 10) / 10;
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: `Dung lượng tệp tin vượt quá giới hạn cho phép (${maxMb} MB).`,
        details: { maxBytes: options.maxBytes, uploadedSize },
      });
    }

    if (
      options?.allowedMimeTypes &&
      options.allowedMimeTypes.length > 0 &&
      uploadedMime &&
      !options.allowedMimeTypes.includes(uploadedMime)
    ) {
      await this.remove(bucket, path);
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Định dạng tệp tin tải lên không được hỗ trợ.',
        details: { allowedMimeTypes: options.allowedMimeTypes, uploadedMime },
      });
    }
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
