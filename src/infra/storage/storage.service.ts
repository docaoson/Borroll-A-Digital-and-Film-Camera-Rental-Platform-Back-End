export interface StorageService {
  createUploadUrl(
    bucket: string,
    path: string,
    contentType?: string,
  ): Promise<string>;
  getPublicUrl(bucket: string, path: string): string;
  createSignedUrl(
    bucket: string,
    path: string,
    ttlSeconds: number,
  ): Promise<string>;
  remove(bucket: string, path: string): Promise<void>;
}

export const STORAGE_SERVICE = 'STORAGE_SERVICE';

