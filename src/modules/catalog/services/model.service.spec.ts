import { ConfigService } from '@nestjs/config';
import { ModelService } from './model.service';
import { PrismaService } from '../../../infra/database/prisma.service';
import { StorageService } from '../../../infra/storage/storage.service';
import { InventoryService } from '../../inventory';

describe('ModelService camera classification filters', () => {
  const categories = [
    { id: 'film', slug: 'may-film', name: 'Máy ảnh Film', parentId: null },
    { id: 'film-35', slug: 'film-slr', name: 'SLR 35mm', parentId: 'film' },
    { id: 'film-120', slug: 'film-medium-format', name: 'Medium Format 120', parentId: 'film' },
    { id: 'digital', slug: 'may-digital', name: 'Máy ảnh Digital', parentId: null },
    { id: 'digital-ml', slug: 'digital-mirrorless', name: 'Mirrorless', parentId: 'digital' },
  ];
  const makeModel = (overrides: Record<string, unknown> = {}) => ({
    id: 'model-1',
    slug: 'model-1',
    name: 'Camera model',
    kind: 'CAMERA',
    cameraType: 'FILM',
    filmFormat: '35mm',
    mount: null,
    pricePerDay: 100000,
    pricePerWeek: null,
    deposit: 1000000,
    isFeatured: false,
    isActive: true,
    createdAt: new Date('2024-01-01T00:00:00Z'),
    description: '',
    specs: { specs: {} },
    brand: { id: 'brand-1', slug: 'canon', name: 'Canon' },
    category: { ...categories[1] },
    images: [],
    units: [],
    ...overrides,
  });

  let service: ModelService;

  beforeEach(() => {
    const models = [
      makeModel({ id: 'film-35-model', slug: 'film-35', filmFormat: '35mm' }),
      makeModel({
        id: 'film-120-model',
        slug: 'film-120',
        cameraType: 'FILM',
        filmFormat: '120',
        category: { ...categories[2] },
      }),
      makeModel({
        id: 'digital-model',
        slug: 'digital',
        cameraType: 'DIGITAL',
        filmFormat: null,
        category: { ...categories[4] },
        specs: { specs: { sensorSize: 'Full Frame' } },
      }),
    ];
    const prisma = {
      rentalModel: { findMany: jest.fn().mockResolvedValue(models) },
      category: {
        findMany: jest.fn().mockResolvedValue(categories),
        findUnique: jest.fn(({ where }: any) => Promise.resolve(
          where.id === 'missing-category'
            ? null
            : where.id === 'digital-root'
              ? { slug: 'may-digital', parent: null }
              : { slug: 'film-slr', parent: { slug: 'may-film' } },
        )),
      },
      favorite: { findMany: jest.fn().mockResolvedValue([]) },
    } as unknown as PrismaService;
    service = new ModelService(
      prisma,
      { get: jest.fn() } as unknown as ConfigService,
      {} as InventoryService,
      { getPublicUrl: jest.fn() } as unknown as StorageService,
    );
  });

  it('filters film by film format and returns format facets', async () => {
    const result = await service.listPublicModels({
      cameraType: 'FILM' as never,
      filmFormat: '120',
    });

    expect(result.items.map((item) => item.id)).toEqual(['film-120-model']);
    expect(result.items[0]).toMatchObject({ cameraType: 'FILM', filmFormat: '120' });
    expect(result.facets.filmFormats).toContainEqual({ value: '35mm', count: 1 });
    expect(result.facets.filmFormats).toContainEqual({ value: '120', count: 1 });
  });

  it('filters digital cameras by sensor size and exposes sensor facets', async () => {
    const result = await service.listPublicModels({
      cameraType: 'DIGITAL' as never,
      sensorSize: 'Full Frame',
    });

    expect(result.items.map((item) => item.id)).toEqual(['digital-model']);
    expect(result.items[0]).toMatchObject({ cameraType: 'DIGITAL', sensorSize: 'Full Frame' });
    expect(result.facets.sensorSizes).toEqual([{ value: 'Full Frame', count: 1 }]);
  });

  it('accepts a film subtype and digital root under the matching selected type', async () => {
    const assertCategory = (service as any).assertCameraCategoryMatchesType.bind(service);

    await expect(assertCategory('FILM', 'film-category')).resolves.toBeUndefined();
    await expect(assertCategory('DIGITAL', 'digital-root')).resolves.toBeUndefined();
  });

  it('rejects a camera category that conflicts with the selected type', async () => {
    const assertCategory = (service as any).assertCameraCategoryMatchesType.bind(service);

    await expect(assertCategory('DIGITAL', 'film-category')).rejects.toThrow(
      'Danh mục dòng máy không thuộc loại máy ảnh Film hoặc Digital đã chọn.',
    );
    await expect(assertCategory('FILM', 'missing-category')).rejects.toThrow();
  });
});

describe('ModelService admin slug creation and updates', () => {
  const makeCreatedModel = (id: string, slug: string) => ({
    id,
    slug,
    name: 'Pentax 17',
    images: [],
  });
  const duplicateSlugError = () =>
    new (require('@prisma/client').Prisma.PrismaClientKnownRequestError)(
      'Unique constraint failed',
      { code: 'P2002', clientVersion: 'test', meta: { target: ['slug'] } },
    );

  let service: ModelService;
  let create: jest.Mock;
  let update: jest.Mock;
  let findUnique: jest.Mock;

  beforeEach(() => {
    create = jest.fn();
    update = jest.fn();
    findUnique = jest.fn().mockImplementation(({ where }: any) =>
      Promise.resolve(makeCreatedModel(where.id, where.id === 'existing' ? 'saved-slug' : 'pentax-17')),
    );
    const transaction = jest.fn((callback: (tx: any) => unknown) =>
      callback({
        rentalModel: { create, update },
        branch: { findFirst: jest.fn().mockResolvedValue(null) },
        auditLog: { create: jest.fn().mockResolvedValue({}) },
      }),
    );
    const prisma = {
      $transaction: transaction,
      rentalModel: { findUnique, create, update },
      category: { findUnique: jest.fn() },
    } as unknown as PrismaService;
    service = new ModelService(
      prisma,
      { get: jest.fn() } as unknown as ConfigService,
      {} as InventoryService,
      { getPublicUrl: jest.fn() } as unknown as StorageService,
    );
  });

  const createDto = (overrides: Record<string, unknown> = {}) => ({
    kind: 'ACCESSORY',
    categoryId: 'category',
    brandId: 'brand',
    name: 'Pentax 17',
    description: 'Test model',
    pricePerDay: 100,
    deposit: 100,
    ...overrides,
  }) as any;

  it('creates a model with a generated slug when slug is omitted', async () => {
    create.mockResolvedValue(makeCreatedModel('created', 'pentax-17'));

    await service.createAdminModel(createDto(), 'admin');

    expect(create.mock.calls[0][0].data.slug).toBe('pentax-17');
  });

  it('creates a model with a supplied slug', async () => {
    create.mockResolvedValue(makeCreatedModel('created', 'custom-slug'));

    await service.createAdminModel(createDto({ slug: 'custom-slug' }), 'admin');

    expect(create.mock.calls[0][0].data.slug).toBe('custom-slug');
  });

  it('adds a numeric suffix when a generated slug already exists', async () => {
    create.mockImplementation(({ data }: any) =>
      data.slug === 'pentax-17' ? Promise.reject(duplicateSlugError()) : Promise.resolve(makeCreatedModel('created', data.slug)),
    );

    await service.createAdminModel(createDto(), 'admin');

    expect(create.mock.calls.map((call) => call[0].data.slug)).toEqual(['pentax-17', 'pentax-17-2']);
  });

  it('retries generated slugs after concurrent P2002 conflicts', async () => {
    create.mockImplementation(({ data }: any) =>
      data.slug === 'pentax-17-3' ? Promise.resolve(makeCreatedModel('created', data.slug)) : Promise.reject(duplicateSlugError()),
    );

    await service.createAdminModel(createDto(), 'admin');

    expect(create.mock.calls.map((call) => call[0].data.slug)).toEqual(['pentax-17', 'pentax-17-2', 'pentax-17-3']);
  });

  it('keeps the legacy conflict message when a supplied slug is duplicated', async () => {
    create.mockRejectedValue(duplicateSlugError());

    await expect(service.createAdminModel(createDto({ slug: 'same-slug' }), 'admin')).rejects.toThrow('Slug m\u1eabu m\u00e1y \u0111\u00e3 t\u1ed3n t\u1ea1i.');
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('does not change the stored slug when update omits slug', async () => {
    const existing = { id: 'existing', kind: 'ACCESSORY', categoryId: 'category', cameraType: null, slug: 'saved-slug', images: [] };
    findUnique.mockResolvedValue(existing);
    update.mockResolvedValue({ ...existing, name: 'Renamed' });

    await service.updateAdminModel('existing', { name: 'Renamed' } as any, 'admin');

    expect(update.mock.calls[0][0].data.slug).toBeUndefined();
  });
});


