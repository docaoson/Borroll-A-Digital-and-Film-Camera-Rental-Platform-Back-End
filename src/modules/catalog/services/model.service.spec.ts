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
        findUnique: jest.fn().mockResolvedValue({
          slug: 'film-slr',
          parent: { slug: 'may-film' },
        }),
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

  it('rejects assigning a camera to a category under a different group', async () => {
    const assertCategory = (service as any).assertCameraCategoryMatchesType.bind(service);

    await expect(assertCategory('CAMERA', 'DIGITAL', 'film-category')).rejects.toThrow(
      'Loại thiết bị phải thuộc đúng nhóm Film, Digital hoặc Instant đã chọn.',
    );
  });
});
