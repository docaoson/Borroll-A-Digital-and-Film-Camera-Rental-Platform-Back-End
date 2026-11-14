import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseStorageService } from './supabase-storage.service';

const imageBytes = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x01]);

describe('SupabaseStorageService.assertOwnedFile', () => {
  let service: SupabaseStorageService;
  let list: jest.Mock;
  let download: jest.Mock;
  let remove: jest.Mock;
  let from: jest.Mock;

  const makeFile = (overrides: { size?: number; mimetype?: string } = {}) => ({
    name: 'proof.jpg',
    metadata: {
      size: overrides.size ?? imageBytes.length,
      mimetype: overrides.mimetype ?? 'image/jpeg',
    },
  });

  const configureFile = (
    file: ReturnType<typeof makeFile> | null,
    bytes = imageBytes,
  ) => {
    list.mockResolvedValue({ data: file ? [file] : [], error: null });
    download.mockResolvedValue({
      data: new Blob([bytes], { type: 'image/jpeg' }),
      error: null,
    });
  };

  beforeEach(() => {
    list = jest.fn();
    download = jest.fn();
    remove = jest.fn().mockResolvedValue({ data: [], error: null });
    from = jest.fn().mockReturnValue({ list, download, remove });
    service = new SupabaseStorageService({
      get: jest.fn((key: string) =>
        key === 'SUPABASE_URL'
          ? 'https://example.supabase.co'
          : 'test-service-key',
      ),
    } as unknown as ConfigService);
    (service as unknown as { supabase: unknown }).supabase = {
      storage: { from },
    };
  });

  it('accepts an existing JPG with matching MIME metadata and signature', async () => {
    configureFile(makeFile());

    await expect(
      service.assertOwnedFile(
        'payment-proofs',
        'renter-1/booking-1/proof.jpg',
        'renter-1/booking-1/',
        {
          maxBytes: 5 * 1024 * 1024,
          allowedMimeTypes: ['image/jpeg', 'image/png'],
        },
      ),
    ).resolves.toBeUndefined();

    expect(from).toHaveBeenCalledWith('payment-proofs');
    expect(list).toHaveBeenCalledWith('renter-1/booking-1', {
      search: 'proof.jpg',
      limit: 100,
    });
    expect(download).toHaveBeenCalledWith('renter-1/booking-1/proof.jpg');
    expect(remove).not.toHaveBeenCalled();
  });

  it('accepts a PNG with its required eight-byte signature', async () => {
    const pngBytes = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
    list.mockResolvedValue({
      data: [
        {
          name: 'proof.png',
          metadata: { size: pngBytes.length, mimetype: 'image/png' },
        },
      ],
      error: null,
    });
    download.mockResolvedValue({
      data: new Blob([pngBytes], { type: 'image/png' }),
      error: null,
    });

    await expect(
      service.assertOwnedFile(
        'payment-proofs',
        'renter-1/booking-1/proof.png',
        'renter-1/booking-1/',
        { allowedMimeTypes: ['image/jpeg', 'image/png'] },
      ),
    ).resolves.toBeUndefined();
  });

  it('rejects an empty path, traversal, absolute path, and a different owner prefix', async () => {
    for (const path of [
      '',
      '../renter-1/booking-1/proof.jpg',
      '/renter-1/booking-1/proof.jpg',
      'renter-2/booking-1/proof.jpg',
      'renter-1\\booking-1\\proof.jpg',
    ]) {
      await expect(
        service.assertOwnedFile('payment-proofs', path, 'renter-1/booking-1/'),
      ).rejects.toBeInstanceOf(BadRequestException);
    }
    expect(from).not.toHaveBeenCalled();
  });

  it('rejects files not present in the bucket', async () => {
    configureFile(null);

    await expect(
      service.assertOwnedFile(
        'payment-proofs',
        'renter-1/booking-1/proof.jpg',
        'renter-1/booking-1/',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(download).not.toHaveBeenCalled();
  });

  it('rejects files whose storage metadata cannot be verified', async () => {
    list.mockResolvedValue({
      data: [{ name: 'proof.jpg', metadata: null }],
      error: null,
    });

    await expect(
      service.assertOwnedFile(
        'payment-proofs',
        'renter-1/booking-1/proof.jpg',
        'renter-1/booking-1/',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(download).not.toHaveBeenCalled();
  });

  it('removes and rejects files larger than the configured 5 MB limit', async () => {
    configureFile(makeFile({ size: 5 * 1024 * 1024 + 1 }));

    await expect(
      service.assertOwnedFile(
        'payment-proofs',
        'renter-1/booking-1/proof.jpg',
        'renter-1/booking-1/',
        {
          maxBytes: 5 * 1024 * 1024,
          allowedMimeTypes: ['image/jpeg', 'image/png'],
        },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(download).not.toHaveBeenCalled();
    expect(remove).toHaveBeenCalledWith(['renter-1/booking-1/proof.jpg']);
  });

  it('removes and rejects a MIME type outside the allowlist', async () => {
    configureFile(makeFile({ mimetype: 'image/gif' }));

    await expect(
      service.assertOwnedFile(
        'payment-proofs',
        'renter-1/booking-1/proof.jpg',
        'renter-1/booking-1/',
        { allowedMimeTypes: ['image/jpeg', 'image/png'] },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(download).not.toHaveBeenCalled();
    expect(remove).toHaveBeenCalled();
  });

  it('removes and rejects a JPG whose bytes do not match its declared MIME type', async () => {
    const forgedContent = Buffer.from('not an image');
    configureFile(makeFile({ size: forgedContent.length }), forgedContent);

    await expect(
      service.assertOwnedFile(
        'payment-proofs',
        'renter-1/booking-1/proof.jpg',
        'renter-1/booking-1/',
        { allowedMimeTypes: ['image/jpeg', 'image/png'] },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(remove).toHaveBeenCalled();
  });

  it('handles undefined options while still verifying the stored image', async () => {
    configureFile(makeFile());

    await expect(
      service.assertOwnedFile(
        'payment-proofs',
        'renter-1/booking-1/proof.jpg',
        'renter-1/booking-1/',
      ),
    ).resolves.toBeUndefined();
  });
});
