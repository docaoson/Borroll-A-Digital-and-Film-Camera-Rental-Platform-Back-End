export interface SignedUploadResult {
  uploadUrl: string;
  path: string;
  token: string;
}

export interface StorageService {
  createUploadUrl(bucket: string, path: string): Promise<SignedUploadResult>;
  getPublicUrl(bucket: string, path: string): string;
  createSignedUrl(
    bucket: string,
    path: string,
    ttlSeconds: number,
  ): Promise<string>;
  assertOwnedFile(
    bucket: string,
    path: string,
    expectedPrefix: string,
  ): Promise<void>;
  remove(bucket: string, path: string): Promise<void>;
}

export const STORAGE_SERVICE = 'STORAGE_SERVICE';
