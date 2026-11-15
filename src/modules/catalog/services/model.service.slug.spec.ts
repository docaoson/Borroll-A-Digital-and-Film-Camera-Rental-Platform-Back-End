import { ConflictException } from '@nestjs/common';
import { ModelService } from './model.service';
import { PrismaService } from '../../../infra/database/prisma.service';
import { ConfigService } from '@nestjs/config';
import { InventoryService } from '../../inventory';
import { StorageService } from '../../../infra/storage/storage.service';

// Helper to create a Prisma known request error for slug duplication
function duplicateSlugError() {
  return new (require('@prisma/client').Prisma.PrismaClientKnownRequestError)(
    'Unique constraint failed',
    { code: 'P2002', clientVersion: 'test', meta: { target: ['slug'] } },
  );
}

describe('ModelService slug edge cases', () => {
  let service: ModelService;
  let createMock: jest.Mock;
  let updateMock: jest.Mock;
  let findUniqueMock: jest.Mock;

  beforeEach(() => {
    createMock = jest.fn();
    updateMock = jest.fn();
    // getAdminModel will be called after create/update; provide minimal model with images array
    findUniqueMock = jest.fn().mockResolvedValue({ id: 'default', slug: 'default', images: [] });

    const transaction = jest.fn((cb: (tx: any) => any) =>
      cb({
        rentalModel: { create: createMock, update: updateMock },
        branch: { findFirst: jest.fn().mockResolvedValue(null) },
        auditLog: { create: jest.fn().mockResolvedValue({}) },
      }),
    );

    const prisma = {
      $transaction: transaction,
      rentalModel: { findUnique: findUniqueMock, create: createMock, update: updateMock },
      category: { findUnique: jest.fn() },
    } as unknown as PrismaService;

    service = new ModelService(
      prisma,
      { get: jest.fn() } as unknown as ConfigService,
      {} as InventoryService,
      { getPublicUrl: jest.fn() } as unknown as StorageService,
    );
  });

  const baseDto = {
    kind: 'ACCESSORY',
    categoryId: 'cat',
    brandId: 'brand',
    name: '!!!', // name that yields empty slug → fallback
    description: 'desc',
    pricePerDay: 100,
    deposit: 1000,
  } as any;

  it('creates model with fallback slug when name yields empty slug', async () => {
    const createdModel = { id: 'created', slug: 'san-pham-abc123', images: [] } as any;
    findUniqueMock.mockResolvedValueOnce(createdModel);
    createMock.mockResolvedValue(createdModel);
    const result = await (service as any).createAdminModel(baseDto, 'admin');
    const sentSlug = createMock.mock.calls[0][0].data.slug as string;
    expect(sentSlug).toMatch(/^san-pham-[0-9a-f]+$/);
    expect(result.id).toBe('created');
  });

  it('fails with ConflictException after exceeding max slug generation attempts', async () => {
    createMock.mockRejectedValue(duplicateSlugError());
    await expect((service as any).createAdminModel(baseDto, 'admin')).rejects.toThrow(
      ConflictException,
    );
    // Should have attempted the maximum number of attempts (5)
    expect(createMock).toHaveBeenCalledTimes(5);
  });

  it('updates model without slug keeps existing slug unchanged', async () => {
    const existing = { id: 'model-1', slug: 'existing-slug', kind: 'ACCESSORY', images: [] } as any;
    findUniqueMock.mockResolvedValue(existing);
    updateMock.mockResolvedValue({ ...existing, name: 'New Name' });
    await (service as any).updateAdminModel('model-1', { name: 'New Name' } as any, 'admin');
    expect(updateMock.mock.calls[0][0].data.slug).toBeUndefined();
  });

  it('updates model with provided valid slug updates the slug', async () => {
    const existing = { id: 'model-2', slug: 'old-slug', kind: 'ACCESSORY', images: [] } as any;
    findUniqueMock.mockResolvedValue(existing);
    updateMock.mockResolvedValue({ ...existing, slug: 'new-slug' });
    await (service as any).updateAdminModel('model-2', { slug: 'new-slug' } as any, 'admin');
    expect(updateMock.mock.calls[0][0].data.slug).toBe('new-slug');
  });

  it('updates model with duplicate slug throws ConflictException with legacy message', async () => {
    const existing = { id: 'model-3', slug: 'old-slug', kind: 'ACCESSORY', images: [] } as any;
    findUniqueMock.mockResolvedValue(existing);
    updateMock.mockRejectedValue(duplicateSlugError());
    await expect(
      (service as any).updateAdminModel('model-3', { slug: 'dup-slug' } as any, 'admin'),
    ).rejects.toThrow('Slug mẫu máy đã tồn tại.');
  });
});
