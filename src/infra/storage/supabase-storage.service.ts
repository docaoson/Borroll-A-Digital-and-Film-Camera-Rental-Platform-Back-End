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

const IMAGE_SIGNATURES: Record<string, (bytes: Uint8Array) => boolean> = {
  'image/jpeg': (bytes) =>
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff,
  'image/png': (bytes) =>
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a,
  'image/webp': (bytes) =>
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50,
};

const IMAGE_EXTENSIONS: Record<string, readonly string[]> = {
  'image/jpeg': ['jpg', 'jpeg'],
  'image/png': ['png'],
  'image/webp': ['webp'],
};

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
    const invalid = (message: string, details: Record<string, unknown> = {}) =>
      new BadRequestException({ code: 'VALIDATION_ERROR', message, details });
    const isSafeRelativePath = (value: string) => {
      if (
        !value ||
        value !== value.trim() ||
        value.startsWith('/') ||
        value.includes('\\') ||
        /[%?#:\u0000-\u001f\u007f]/.test(value)
      ) {
        return false;
      }
      return value
        .split('/')
        .every(
          (segment) =>
            segment.length > 0 &&
            segment !== '.' &&
            segment !== '..' &&
            /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/.test(segment),
        );
    };

    if (
      typeof bucket !== 'string' ||
      !bucket.trim() ||
      typeof path !== 'string' ||
      typeof expectedPrefix !== 'string' ||
      !expectedPrefix.endsWith('/') ||
      !isSafeRelativePath(expectedPrefix.slice(0, -1)) ||
      !isSafeRelativePath(path) ||
      !path.startsWith(expectedPrefix) ||
      path.length <= expectedPrefix.length
    ) {
      throw invalid('Đường dẫn tệp tin không hợp lệ.');
    }

    if (
      options?.maxBytes !== undefined &&
      (!Number.isSafeInteger(options.maxBytes) || options.maxBytes < 1)
    ) {
      throw invalid('Giới hạn dung lượng tệp tin không hợp lệ.');
    }
    if (options?.allowedMimeTypes && options.allowedMimeTypes.length === 0) {
      throw invalid('Danh sách định dạng ảnh cho phép không hợp lệ.');
    }

    const lastSlash = path.lastIndexOf('/');
    const folder = path.slice(0, lastSlash);
    const fileName = path.slice(lastSlash + 1);
    const { data, error } = await this.supabase.storage
      .from(bucket)
      .list(folder, { search: fileName, limit: 100 });
    const matchedFile = data?.find((item) => item.name === fileName);

    if (error || !matchedFile) {
      throw invalid('Không tìm thấy tệp đã tải lên trong kho lưu trữ.');
    }

    const metadata = matchedFile.metadata;
    const uploadedSize = metadata?.size;
    const uploadedMime =
      typeof metadata?.mimetype === 'string'
        ? metadata.mimetype.trim().toLowerCase()
        : undefined;
    if (
      !metadata ||
      !Number.isSafeInteger(uploadedSize) ||
      (uploadedSize as number) < 0 ||
      !uploadedMime
    ) {
      throw invalid('Không thể xác minh thông tin tệp đã tải lên.');
    }

    const maxBytes = options?.maxBytes ?? 8 * 1024 * 1024;
    if (uploadedSize! > maxBytes) {
      await this.remove(bucket, path);
      const maxMb = Math.round((maxBytes / (1024 * 1024)) * 10) / 10;
      throw invalid('Dung lượng ảnh không được vượt quá ' + maxMb + ' MB.', {
        maxBytes,
        uploadedSize,
      });
    }

    const allowedMimeTypes = options?.allowedMimeTypes;
    if (
      !Object.hasOwn(IMAGE_SIGNATURES, uploadedMime) ||
      (allowedMimeTypes && !allowedMimeTypes.includes(uploadedMime))
    ) {
      await this.remove(bucket, path);
      throw invalid('Định dạng ảnh tải lên không được hỗ trợ.', {
        allowedMimeTypes: allowedMimeTypes ?? Object.keys(IMAGE_SIGNATURES),
        uploadedMime,
      });
    }

    const extension = fileName.split('.').pop()?.toLowerCase();
    if (!extension || !IMAGE_EXTENSIONS[uploadedMime].includes(extension)) {
      await this.remove(bucket, path);
      throw invalid('Phần mở rộng tệp không khớp với định dạng ảnh.');
    }

    const { data: fileBlob, error: downloadError } = await this.supabase.storage
      .from(bucket)
      .download(path);
    if (downloadError || !fileBlob || fileBlob.size !== uploadedSize) {
      throw invalid('Không thể xác minh nội dung tệp trong kho lưu trữ.');
    }

    const signature = new Uint8Array(await fileBlob.slice(0, 12).arrayBuffer());
    if (!IMAGE_SIGNATURES[uploadedMime](signature)) {
      await this.remove(bucket, path);
      throw invalid('Nội dung tệp không khớp với định dạng ảnh khai báo.');
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
