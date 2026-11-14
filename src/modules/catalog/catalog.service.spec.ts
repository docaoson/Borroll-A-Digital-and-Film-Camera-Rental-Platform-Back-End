import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { assertSafeE2eDatabase } from '../../../test/helpers/e2e-cleanup.util';
import { PrismaService } from '../../infra/database/prisma.service';
import { StorageService } from '../../infra/storage/storage.service';
import { InventoryService } from '../inventory';
import { CatalogService } from './catalog.service';
import {
  BranchService,
  BrandService,
  CategoryService,
  ContactSettingsService,
  FavoriteService,
  FilmProductService,
  ModelService,
} from './services';

describe('CatalogService - Contact Settings & Active Public Filters', () => {
  let service: CatalogService;
  let mockPrisma: {
    contactSetting: {
      findUnique: jest.Mock;
      upsert: jest.Mock;
    };
    branch: {
      findMany: jest.Mock;
    };
    category: {
      findMany: jest.Mock;
    };
    brand: {
      findMany: jest.Mock;
    };
    filmProduct: {
      findMany: jest.Mock;
    };
    auditLog: {
      create: jest.Mock;
    };
    $transaction: jest.Mock;
  };

  beforeEach(() => {
    mockPrisma = {
      contactSetting: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({
          id: 'default',
          zaloOaId: null,
          zaloPhone: null,
          messengerPage: null,
          instagramHandle: null,
          hotline: null,
          welcomeMessage: null,
          isChatEnabled: false,
        }),
      },
      branch: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'b-1',
            slug: 'tay-ho',
            name: 'Chi nhánh Tây Hồ',
            address: 'Hà Nội',
            phone: '0866747114',
            openHours: '09:00 - 21:00',
            mapUrl: null,
          },
        ]),
      },
      category: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'cat-1',
            slug: 'may-anh-film',
            name: 'Máy ảnh Film',
            parentId: null,
            sortOrder: 1,
            isActive: true,
          },
        ]),
      },
      brand: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'brand-1',
            slug: 'canon',
            name: 'Canon',
            isActive: true,
          },
        ]),
      },
      filmProduct: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'film-1',
            name: 'Kodak ColorPlus 200',
            iso: 200,
            format: '35mm',
            price: 185000,
            inStock: true,
            isActive: true,
            imagePath: null,
          },
        ]),
      },
      auditLog: {
        create: jest.fn().mockResolvedValue({ id: 'audit-1' }),
      },
      $transaction: jest
        .fn()
        .mockImplementation((cb: (tx: unknown) => unknown) => cb(mockPrisma)),
    };

    const prismaService = mockPrisma as unknown as PrismaService;
    const configService = { get: jest.fn() } as unknown as ConfigService;
    const storageService = {} as unknown as StorageService;
    const inventoryService = {} as unknown as InventoryService;

    const branchService = new BranchService(prismaService);
    const categoryService = new CategoryService(prismaService);
    const brandService = new BrandService(prismaService);
    const filmProductService = new FilmProductService(
      prismaService,
      configService,
      storageService,
    );
    const contactSettingsService = new ContactSettingsService(
      prismaService,
      configService,
      storageService,
    );
    const favoriteService = new FavoriteService(
      prismaService,
      configService,
      storageService,
    );
    const modelService = new ModelService(
      prismaService,
      configService,
      inventoryService,
      storageService,
    );

    service = new CatalogService(
      branchService,
      categoryService,
      brandService,
      filmProductService,
      contactSettingsService,
      favoriteService,
      modelService,
    );
  });

  it('returns null fields when unconfigured and caches for 5 minutes', async () => {
    const first = await service.getPublicContactSettings();
    expect(first).toEqual({
      chatEnabled: false,
      welcomeMessage: null,
      zalo: { oaId: null, url: null },
      messenger: { url: null },
      instagram: { handle: null, url: null },
      hotline: null,
      payment: {
        enabled: false,
        bankName: null,
        accountNumber: null,
        accountName: null,
        qrImageUrl: null,
        qrPath: null,
        instructions: null,
      },
      branches: [
        { slug: 'tay-ho', name: 'Chi nhánh Tây Hồ', phone: '0866747114' },
      ],
    });

    await service.getPublicContactSettings();
    expect(mockPrisma.contactSetting.findUnique).toHaveBeenCalledTimes(1);
  });

  it('rejects URLs and HTML/script inputs with 400 BadRequestException', async () => {
    await expect(
      service.updateContactSettings(
        { messengerPage: 'https://m.me/borroll.camera' },
        'admin-1',
      ),
    ).rejects.toThrow(BadRequestException);

    await expect(
      service.updateContactSettings(
        { instagramHandle: 'https://instagram.com/borroll.camera' },
        'admin-1',
      ),
    ).rejects.toThrow(BadRequestException);

    await expect(
      service.updateContactSettings(
        { welcomeMessage: '<script>alert(1)</script>' },
        'admin-1',
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('queries only active (isActive: true) records for branches, categories, brands, and film-products', async () => {
    await service.getPublicBranches();
    expect(mockPrisma.branch.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { isActive: true } }),
    );

    await service.getPublicCategories();
    expect(mockPrisma.category.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { isActive: true } }),
    );

    await service.getPublicBrands();
    expect(mockPrisma.brand.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { isActive: true } }),
    );

    await service.getPublicFilmProducts();
    expect(mockPrisma.filmProduct.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { isActive: true, inStock: true },
      }),
    );
  });

  it('blocks E2E execution against supabase.com unless ALLOW_E2E_ON_REMOTE is "true"', () => {
    expect(() =>
      assertSafeE2eDatabase({
        DATABASE_URL:
          'postgresql://postgres:secret@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres',
      }),
    ).toThrow(/ALLOW_E2E_ON_REMOTE/);

    expect(() =>
      assertSafeE2eDatabase({
        DATABASE_URL:
          'postgresql://postgres:secret@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres',
        ALLOW_E2E_ON_REMOTE: 'true',
      }),
    ).not.toThrow();

    expect(() =>
      assertSafeE2eDatabase({
        DATABASE_URL:
          'postgresql://postgres:postgres@localhost:5432/borroll_test',
      }),
    ).not.toThrow();
  });
});
