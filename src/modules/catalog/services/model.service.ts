import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, UnitCondition, UnitStatus } from '@prisma/client';
import * as crypto from 'crypto';
import { writeAuditLog } from '../../../common/utils/audit.util';
import { PrismaService } from '../../../infra/database/prisma.service';
import {
  STORAGE_SERVICE,
  StorageService,
} from '../../../infra/storage/storage.service';
import { InventoryService } from '../../inventory';
import {
  CreateModelDto,
  CreateModelImageDto,
  ImagePresignDto,
  ListModelsQueryDto,
  ModelAvailabilityQueryDto,
  PaginationQueryDto,
  ReorderImagesDto,
  UpdateModelDto,
  UpdateModelSpecsDto,
} from '../dto/catalog.dto';

const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;
const MODEL_CATEGORIES_CACHE_TTL_MS = 5 * 60 * 1000;
const ACTIVE_MODELS_CACHE_TTL_MS = 5 * 60 * 1000;

const CONTENT_TYPE_EXTENSIONS: Record<ImagePresignDto['contentType'], string> =
  {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
  };

const ACTIVE_MODEL_CACHE_INCLUDE = {
  brand: { select: { slug: true, name: true } },
  category: {
    select: { id: true, slug: true, name: true, parentId: true },
  },
  images: {
    where: { kind: 'PRODUCT' as const },
    orderBy: [{ sortOrder: 'asc' as const }, { id: 'asc' as const }],
    take: 1,
  },
  units: {
    where: {
      status: UnitStatus.AVAILABLE,
      branch: { isActive: true },
    },
    select: { branch: { select: { slug: true } } },
    distinct: ['branchId' as const],
  },
} satisfies Prisma.RentalModelInclude;

type RawActiveModel = Prisma.RentalModelGetPayload<{
  include: typeof ACTIVE_MODEL_CACHE_INCLUDE;
}>;

interface CachedActiveModel extends RawActiveModel {
  normName: string;
  normBrandName: string;
  availableBranchSlugs: string[];
  thumbnailUrl: string | null;
}

@Injectable()
export class ModelService {
  private allCategoriesCache: {
    data: Array<{
      id: string;
      slug: string;
      name: string;
      parentId: string | null;
    }>;
    expiresAt: number;
  } | null = null;

  private activeModelsCache: {
    data: CachedActiveModel[];
    expiresAt: number;
    unitsVersion: number;
  } | null = null;

  private activeModelsInFlight: Promise<CachedActiveModel[]> | null = null;

  private readonly modelDetailBySlugCache = new Map<
    string,
    {
      data: Record<string, unknown> & { id: string; slug: string };
      expiresAt: number;
      unitsVersion: number;
    }
  >();

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly inventoryService: InventoryService,
    @Inject(STORAGE_SERVICE)
    private readonly storageService: StorageService,
  ) {}

  public invalidateCategoriesCache(): void {
    this.allCategoriesCache = null;
    this.invalidateModelsCache();
  }

  public invalidateModelsCache(): void {
    this.activeModelsCache = null;
    this.activeModelsInFlight = null;
    this.modelDetailBySlugCache.clear();
  }

  private getCurrentUnitsVersion(): number {
    return typeof this.inventoryService?.getUnitsCacheVersion === 'function'
      ? this.inventoryService.getUnitsCacheVersion()
      : 0;
  }

  private unaccent(input: string): string {
    return input
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .replace(/Đ/g, 'd')
      .toLowerCase();
  }

  private matchesSearchTokens(
    model: CachedActiveModel,
    normTokens: string[],
  ): boolean {
    for (const token of normTokens) {
      if (token.length < 3) {
        const matchesName = model.normName.includes(token);
        const matchesBrandPrefix =
          model.normBrandName.startsWith(token) ||
          model.normBrandName.includes(` ${token}`);
        if (!matchesName && !matchesBrandPrefix) {
          return false;
        }
      } else {
        if (
          !model.normName.includes(token) &&
          !model.normBrandName.includes(token)
        ) {
          return false;
        }
      }
    }
    return true;
  }

  private fetchAndCacheActiveModels(): Promise<CachedActiveModel[]> {
    if (this.activeModelsInFlight) {
      return this.activeModelsInFlight;
    }

    this.activeModelsInFlight = this.prisma.rentalModel
      .findMany({
        where: { isActive: true },
        include: ACTIVE_MODEL_CACHE_INCLUDE,
        orderBy: [{ isFeatured: 'desc' }, { createdAt: 'desc' }],
      })
      .then((rows) => {
        const enriched: CachedActiveModel[] = rows.map((m) => ({
          ...m,
          normName: this.unaccent(m.name),
          normBrandName: this.unaccent(m.brand.name),
          availableBranchSlugs: Array.from(
            new Set(m.units.map((u) => u.branch.slug)),
          ).sort(),
          thumbnailUrl: m.images[0]
            ? this.getModelImageUrl(m.images[0].path)
            : null,
        }));
        this.activeModelsCache = {
          data: enriched,
          expiresAt: Date.now() + ACTIVE_MODELS_CACHE_TTL_MS,
          unitsVersion: this.getCurrentUnitsVersion(),
        };
        this.activeModelsInFlight = null;
        return enriched;
      })
      .catch((err) => {
        this.activeModelsInFlight = null;
        throw err;
      });

    return this.activeModelsInFlight;
  }

  private async getCachedActiveModels(): Promise<CachedActiveModel[]> {
    const now = Date.now();
    const currentUnitsVersion = this.getCurrentUnitsVersion();
    if (
      this.activeModelsCache &&
      this.activeModelsCache.unitsVersion === currentUnitsVersion
    ) {
      if (now >= this.activeModelsCache.expiresAt) {
        this.fetchAndCacheActiveModels().catch(() => {});
      }
      return this.activeModelsCache.data;
    }

    return this.fetchAndCacheActiveModels();
  }

  private async getCachedAllCategories() {
    const now = Date.now();
    if (this.allCategoriesCache) {
      if (now >= this.allCategoriesCache.expiresAt) {
        this.prisma.category
          .findMany({
            select: { id: true, slug: true, name: true, parentId: true },
          })
          .then((rows) => {
            this.allCategoriesCache = {
              data: rows,
              expiresAt: Date.now() + MODEL_CATEGORIES_CACHE_TTL_MS,
            };
          })
          .catch(() => {});
      }
      return this.allCategoriesCache.data;
    }
    const rows = await this.prisma.category.findMany({
      select: { id: true, slug: true, name: true, parentId: true },
    });
    this.allCategoriesCache = {
      data: rows,
      expiresAt: now + MODEL_CATEGORIES_CACHE_TTL_MS,
    };
    return rows;
  }

  private getRentalImagesBucket(): string {
    return this.configService.get<string>(
      'STORAGE_BUCKET_RENTAL_IMAGES',
      'rental-images',
    );
  }

  private getModelImageUrl(path: string): string {
    return this.storageService.getPublicUrl(this.getRentalImagesBucket(), path);
  }

  private buildBadges(createdAt: Date): string[] {
    return Date.now() - createdAt.getTime() <= FOURTEEN_DAYS_MS ? ['NEW'] : [];
  }

  private expandCategorySlugs(
    requestedSlugs: string[],
    allCategories: Array<{
      id: string;
      slug: string;
      parentId: string | null;
    }>,
  ): string[] {
    if (requestedSlugs.length === 0) return [];
    const byParent = new Map<string, string[]>();
    const slugToId = new Map<string, string>();
    const idToSlug = new Map<string, string>();

    for (const cat of allCategories) {
      slugToId.set(cat.slug, cat.id);
      idToSlug.set(cat.id, cat.slug);
      if (cat.parentId) {
        const list = byParent.get(cat.parentId) ?? [];
        list.push(cat.id);
        byParent.set(cat.parentId, list);
      }
    }

    const collected = new Set<string>();
    const visit = (id: string) => {
      const slug = idToSlug.get(id);
      if (slug) collected.add(slug);
      for (const childId of byParent.get(id) ?? []) {
        visit(childId);
      }
    };

    for (const slug of requestedSlugs) {
      const id = slugToId.get(slug);
      if (id) visit(id);
      else collected.add(slug);
    }

    return Array.from(collected);
  }

  /**
   * List public models with facet calculation and in-memory pagination.
   *
   * Architectural Decision:
   * In-memory pagination is intentionally used here because:
   * 1. Multi-facet counts (categories, brands, price ranges) require aggregations over the
   *    filtered candidate set across cross-cutting dimensions.
   * 2. Live unit availability checks across branches are dynamic per date-range and cannot
   *    be computed by a simple single SQL join without heavy locking or denormalized materialized views.
   * 3. Catalog size is modest (< 1,000 active models), making in-memory filtering extremely fast (< 15ms).
   */
  async listPublicModels(query: ListModelsQueryDto, userId?: string) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    // Validate price range bounds upfront before executing DB queries
    if (
      query.minPrice !== undefined &&
      query.maxPrice !== undefined &&
      query.minPrice > query.maxPrice
    ) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Khoảng giá không hợp lệ: Giá tối thiểu không được lớn hơn giá tối đa.',
        details: { minPrice: query.minPrice, maxPrice: query.maxPrice },
      });
    }

    const hasDateRange = Boolean(query.from && query.to);
    const activeBranchFilter = query.branch?.trim() || undefined;

    const [allCategories, allActiveModels] = await Promise.all([
      this.getCachedAllCategories(),
      this.getCachedActiveModels(),
    ]);

    const normSearchTokens = query.q?.trim()
      ? query.q
          .trim()
          .split(/\s+/)
          .filter(Boolean)
          .map((t) => this.unaccent(t))
      : [];

    let candidates = allActiveModels.filter((m) => {
      if (query.kind && m.kind !== query.kind) return false;
      if (query.cameraType && m.cameraType !== query.cameraType) return false;
      if (query.mount && m.mount !== query.mount) return false;
      if (query.featured === 'true' && !m.isFeatured) return false;
      if (query.excludeId && m.id === query.excludeId) return false;
      if (
        normSearchTokens.length > 0 &&
        !this.matchesSearchTokens(m, normSearchTokens)
      ) {
        return false;
      }
      return true;
    });

    if (query.sort === 'price_asc') {
      candidates = [...candidates].sort(
        (a, b) => a.pricePerDay - b.pricePerDay || a.id.localeCompare(b.id),
      );
    } else if (query.sort === 'price_desc') {
      candidates = [...candidates].sort(
        (a, b) => b.pricePerDay - a.pricePerDay || a.id.localeCompare(b.id),
      );
    } else if (query.sort === 'newest') {
      candidates = [...candidates].sort(
        (a, b) =>
          b.createdAt.getTime() - a.createdAt.getTime() ||
          a.id.localeCompare(b.id),
      );
    }

    const categoryById = new Map(allCategories.map((c) => [c.id, c]));

    const requestedCategorySlugs = (query.category ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const expandedCategorySlugs = this.expandCategorySlugs(
      requestedCategorySlugs,
      allCategories,
    );

    const requestedBrandSlugs = (query.brand ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    let availabilityMap: Map<string, string[]> | null = null;
    if (hasDateRange && candidates.length > 0) {
      availabilityMap =
        await this.inventoryService.getAvailableBranchSlugsByModel({
          modelIds: candidates.map((m) => m.id),
          branchSlug: activeBranchFilter,
          startDate: query.from!,
          endDate: query.to!,
        });
    }

    const baseFiltered = candidates.filter((model) => {
      if (hasDateRange) {
        const branches = availabilityMap?.get(model.id) ?? [];
        return branches.length > 0;
      }
      if (activeBranchFilter) {
        return model.availableBranchSlugs.includes(activeBranchFilter);
      }
      return true;
    });

    const matchesCategory = (m: (typeof baseFiltered)[number]) =>
      expandedCategorySlugs.length === 0 ||
      expandedCategorySlugs.includes(m.category.slug);

    const matchesBrand = (m: (typeof baseFiltered)[number]) =>
      requestedBrandSlugs.length === 0 ||
      requestedBrandSlugs.includes(m.brand.slug);

    const matchesPrice = (m: (typeof baseFiltered)[number]) =>
      (query.minPrice === undefined || m.pricePerDay >= query.minPrice) &&
      (query.maxPrice === undefined || m.pricePerDay <= query.maxPrice);

    const finalFiltered = baseFiltered.filter(
      (m) => matchesCategory(m) && matchesBrand(m) && matchesPrice(m),
    );

    const forPriceFacet = baseFiltered.filter(
      (m) => matchesCategory(m) && matchesBrand(m),
    );
    const forCategoryFacet = baseFiltered.filter(
      (m) => matchesBrand(m) && matchesPrice(m),
    );
    const forBrandFacet = baseFiltered.filter(
      (m) => matchesCategory(m) && matchesPrice(m),
    );

    const priceFacet = [
      {
        key: 'lt100k',
        min: 0,
        max: 100000,
        count: forPriceFacet.filter((m) => m.pricePerDay < 100000).length,
      },
      {
        key: '100k-300k',
        min: 100000,
        max: 300000,
        count: forPriceFacet.filter(
          (m) => m.pricePerDay >= 100000 && m.pricePerDay < 300000,
        ).length,
      },
      {
        key: '300k-600k',
        min: 300000,
        max: 600000,
        count: forPriceFacet.filter(
          (m) => m.pricePerDay >= 300000 && m.pricePerDay < 600000,
        ).length,
      },
      {
        key: 'gte600k',
        min: 600000,
        max: null,
        count: forPriceFacet.filter((m) => m.pricePerDay >= 600000).length,
      },
    ];

    const categoryCounts = new Map<
      string,
      { slug: string; name: string; parentSlug: string | null; count: number }
    >();
    for (const m of forCategoryFacet) {
      const parent = m.category.parentId
        ? categoryById.get(m.category.parentId)
        : null;
      const existing = categoryCounts.get(m.category.slug);
      if (existing) {
        existing.count += 1;
      } else {
        categoryCounts.set(m.category.slug, {
          slug: m.category.slug,
          name: m.category.name,
          parentSlug: parent?.slug ?? null,
          count: 1,
        });
      }
    }

    const brandCounts = new Map<
      string,
      { slug: string; name: string; count: number }
    >();
    for (const m of forBrandFacet) {
      const existing = brandCounts.get(m.brand.slug);
      if (existing) {
        existing.count += 1;
      } else {
        brandCounts.set(m.brand.slug, {
          slug: m.brand.slug,
          name: m.brand.name,
          count: 1,
        });
      }
    }

    const total = finalFiltered.length;
    const paged = finalFiltered.slice((page - 1) * pageSize, page * pageSize);

    const favoriteSet = new Set<string>();
    if (userId && paged.length > 0) {
      const favs = await this.prisma.favorite.findMany({
        where: {
          userId,
          modelId: { in: paged.map((m) => m.id) },
        },
        select: { modelId: true },
      });
      for (const fav of favs) {
        favoriteSet.add(fav.modelId);
      }
    }

    return {
      items: paged.map((m) => {
        const baseItem: Record<string, unknown> = {
          id: m.id,
          slug: m.slug,
          name: m.name,
          kind: m.kind,
          cameraType: m.cameraType,
          brand: m.brand,
          category: { slug: m.category.slug, name: m.category.name },
          mount: m.mount,
          pricePerDay: m.pricePerDay,
          pricePerWeek: m.pricePerWeek,
          deposit: m.deposit,
          thumbnailUrl: m.thumbnailUrl,
          isFeatured: m.isFeatured,
          badges: this.buildBadges(m.createdAt),
          isFavorite: favoriteSet.has(m.id),
          description: m.description,
          availableAtBranches: hasDateRange
            ? (availabilityMap?.get(m.id) ?? [])
            : m.availableBranchSlugs,
        };
        return baseItem;
      }),
      page,
      pageSize,
      total,
      facets: {
        price: priceFacet,
        categories: Array.from(categoryCounts.values()),
        brands: Array.from(brandCounts.values()),
      },
    };
  }

  async getPublicModelBySlug(slug: string, userId?: string) {
    const now = Date.now();
    const currentUnitsVersion = this.getCurrentUnitsVersion();
    const cached = this.modelDetailBySlugCache.get(slug);

    if (
      cached &&
      now < cached.expiresAt &&
      cached.unitsVersion === currentUnitsVersion
    ) {
      let isFavorite = false;
      if (userId) {
        const fav = await this.prisma.favorite.findUnique({
          where: {
            userId_modelId: { userId, modelId: cached.data.id },
          },
          select: { userId: true },
        });
        isFavorite = Boolean(fav);
      }
      return {
        ...cached.data,
        isFavorite,
      };
    }

    const model = await this.prisma.rentalModel.findFirst({
      where: { slug, isActive: true },
      include: {
        brand: { select: { slug: true, name: true } },
        category: { select: { slug: true, name: true } },
        images: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] },
        specs: true,
        units: {
          where: {
            status: UnitStatus.AVAILABLE,
            branch: { isActive: true },
          },
          select: { branch: { select: { slug: true } } },
          distinct: ['branchId'],
        },
        favorites: userId
          ? {
              where: { userId },
              select: { userId: true },
              take: 1,
            }
          : false,
      },
    });

    if (!model) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Không tìm thấy mẫu máy.',
        details: {},
      });
    }

    const availableAtBranches = Array.from(
      new Set(model.units.map((u) => u.branch.slug)),
    ).sort();
    const isFavorite =
      Array.isArray(model.favorites) && model.favorites.length > 0;

    const inspection =
      model.lastInspectedAt || model.inspectionNotes
        ? {
            lastInspectedAt: model.lastInspectedAt
              ? model.lastInspectedAt.toISOString()
              : null,
            items: Array.isArray(model.inspectionNotes)
              ? model.inspectionNotes
              : [],
          }
        : null;

    const baseDetail = {
      id: model.id,
      slug: model.slug,
      name: model.name,
      kind: model.kind,
      cameraType: model.cameraType,
      description: model.description,
      mount: model.mount,
      filmFormat: model.filmFormat,
      brand: model.brand,
      category: model.category,
      pricePerDay: model.pricePerDay,
      pricePerWeek: model.pricePerWeek,
      deposit: model.deposit,
      images: model.images.map((img) => ({
        id: img.id,
        url: this.getModelImageUrl(img.path),
        kind: img.kind,
        caption: img.caption,
        sampleLens: img.sampleLens,
      })),
      specs: model.specs?.specs ?? null,
      inspection,
      availableAtBranches,
      aiSetupAvailable: false,
    };

    this.modelDetailBySlugCache.set(slug, {
      data: baseDetail,
      expiresAt: Date.now() + ACTIVE_MODELS_CACHE_TTL_MS,
      unitsVersion: currentUnitsVersion,
    });

    return {
      ...baseDetail,
      isFavorite,
    };
  }

  async getModelAvailability(
    modelId: string,
    query: ModelAvailabilityQueryDto,
  ) {
    const [model, branch, unavailableDates] = await Promise.all([
      this.prisma.rentalModel.findFirst({
        where: { id: modelId, isActive: true },
        select: { id: true },
      }),
      this.prisma.branch.findFirst({
        where: { slug: query.branch, isActive: true },
        select: { id: true, slug: true },
      }),
      this.inventoryService.getUnavailableDatesForModel({
        modelId,
        branchSlug: query.branch,
        month: query.month,
      }),
    ]);

    if (!model || !branch) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Không tìm thấy mẫu máy hoặc chi nhánh.',
        details: {},
      });
    }

    return {
      month: query.month,
      branch: branch.slug,
      unavailableDates,
    };
  }

  async findModelsForBooking(modelIds: string[]) {
    const models = await this.prisma.rentalModel.findMany({
      where: { id: { in: modelIds } },
      include: {
        images: {
          where: { kind: 'PRODUCT' },
          orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
          take: 1,
        },
      },
    });
    return models.map((m) => ({
      ...m,
      thumbnailUrl: m.images[0]
        ? this.getModelImageUrl(m.images[0].path)
        : null,
    }));
  }

  async listAdminModels(query: PaginationQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where: Prisma.RentalModelWhereInput = {};
    if (query.q?.trim()) {
      const q = query.q.trim();
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { slug: { contains: q, mode: 'insensitive' } },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.rentalModel.findMany({
        where,
        include: {
          brand: { select: { id: true, slug: true, name: true } },
          category: { select: { id: true, slug: true, name: true } },
          images: {
            where: { kind: 'PRODUCT' },
            orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
            take: 1,
          },
          _count: { select: { units: true } },
        },
        orderBy: [{ createdAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.rentalModel.count({ where }),
    ]);

    return {
      items: items.map((m) => ({
        ...m,
        thumbnailUrl: m.images?.[0]
          ? this.getModelImageUrl(m.images[0].path)
          : null,
      })),
      page,
      pageSize,
      total,
    };
  }

  async getAdminModel(id: string) {
    const model = await this.prisma.rentalModel.findUnique({
      where: { id },
      include: {
        brand: true,
        category: true,
        images: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] },
        specs: true,
      },
    });
    if (!model) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Không tìm thấy mẫu máy.',
        details: {},
      });
    }
    return {
      ...model,
      images: model.images.map((img) => ({
        ...img,
        url: this.getModelImageUrl(img.path),
      })),
    };
  }

  async createAdminModel(dto: CreateModelDto, actorId: string) {
    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const model = await tx.rentalModel.create({
          data: {
            kind: dto.kind,
            categoryId: dto.categoryId,
            brandId: dto.brandId,
            name: dto.name.trim(),
            slug: dto.slug.trim().toLowerCase(),
            description: dto.description.trim(),
            cameraType: dto.cameraType ?? null,
            mount: dto.mount ?? null,
            filmFormat: dto.filmFormat ?? null,
            pricePerDay: dto.pricePerDay,
            pricePerWeek: dto.pricePerWeek ?? null,
            deposit: dto.deposit,
            isActive: dto.isActive ?? true,
            isFeatured: dto.isFeatured ?? false,
            lastInspectedAt: dto.lastInspectedAt
              ? new Date(dto.lastInspectedAt)
              : null,
            inspectionNotes: dto.inspectionNotes
              ? (dto.inspectionNotes as unknown as Prisma.InputJsonValue)
              : undefined,
          },
        });

        // Tự động tạo 1 unit vật lý ban đầu tại chi nhánh mặc định để máy sẵn sàng cho thuê
        const defaultBranch = await tx.branch.findFirst({
          where: { isActive: true },
          orderBy: { createdAt: 'asc' },
        });
        if (defaultBranch) {
          const prefix =
            (model.slug || 'CAM')
              .toUpperCase()
              .replace(/[^A-Z0-9]/g, '')
              .slice(0, 4) || 'CAM';
          const randomNum = Math.floor(100 + Math.random() * 900);
          await tx.rentalUnit.create({
            data: {
              modelId: model.id,
              branchId: defaultBranch.id,
              serialNumber: `${prefix}-01-${randomNum}`,
              condition: UnitCondition.EXCELLENT,
              status: UnitStatus.AVAILABLE,
              notes: 'Thiết bị sẵn sàng cho thuê',
            },
          });
        }

        await writeAuditLog(tx, {
          actorId,
          action: 'MODEL_CREATED',
          targetType: 'RENTAL_MODEL',
          targetId: model.id,
          metadata: { slug: model.slug, pricePerDay: model.pricePerDay },
        });
        return model;
      });
      this.invalidateModelsCache();
      return this.getAdminModel(created.id);
    } catch (err: unknown) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException({
          code: 'VALIDATION_ERROR',
          message: 'Slug mẫu máy đã tồn tại.',
          details: { fields: { slug: 'Slug đã được sử dụng' } },
        });
      }
      throw err;
    }
  }

  async updateAdminModel(id: string, dto: UpdateModelDto, actorId: string) {
    const existing = await this.prisma.rentalModel.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Không tìm thấy mẫu máy.',
        details: {},
      });
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.rentalModel.update({
          where: { id },
          data: {
            kind: dto.kind,
            categoryId: dto.categoryId,
            brandId: dto.brandId,
            name: dto.name?.trim(),
            slug: dto.slug?.trim().toLowerCase(),
            description: dto.description?.trim(),
            cameraType: dto.cameraType,
            mount: dto.mount,
            filmFormat: dto.filmFormat,
            pricePerDay: dto.pricePerDay,
            pricePerWeek: dto.pricePerWeek,
            deposit: dto.deposit,
            isActive: dto.isActive,
            isFeatured: dto.isFeatured,
            lastInspectedAt:
              dto.lastInspectedAt === undefined
                ? undefined
                : dto.lastInspectedAt === null
                  ? null
                  : new Date(dto.lastInspectedAt),
            inspectionNotes:
              dto.inspectionNotes === undefined
                ? undefined
                : dto.inspectionNotes === null
                  ? Prisma.DbNull
                  : (dto.inspectionNotes as unknown as Prisma.InputJsonValue),
          },
        });

        await writeAuditLog(tx, {
          actorId,
          action: 'MODEL_UPDATED',
          targetType: 'RENTAL_MODEL',
          targetId: id,
          metadata: dto as unknown as Prisma.InputJsonValue,
        });
      });
      this.invalidateModelsCache();
      return this.getAdminModel(id);
    } catch (err: unknown) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException({
          code: 'VALIDATION_ERROR',
          message: 'Slug mẫu máy đã tồn tại.',
          details: { fields: { slug: 'Slug đã được sử dụng' } },
        });
      }
      throw err;
    }
  }

  async deleteAdminModel(id: string, actorId: string) {
    const existing = await this.prisma.rentalModel.findUnique({
      where: { id },
      include: { _count: { select: { bookingUnits: true, units: true } } },
    });
    if (!existing) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Không tìm thấy mẫu máy.',
        details: {},
      });
    }

    if (existing._count.bookingUnits > 0 || existing._count.units > 0) {
      await this.prisma.$transaction(async (tx) => {
        await tx.rentalModel.update({
          where: { id },
          data: { isActive: false },
        });

        await writeAuditLog(tx, {
          actorId,
          action: 'MODEL_DEACTIVATED',
          targetType: 'RENTAL_MODEL',
          targetId: id,
        });
      });
      this.invalidateModelsCache();
      return { id, isActive: false, hidden: true };
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.rentalModel.delete({ where: { id } });
      await writeAuditLog(tx, {
        actorId,
        action: 'MODEL_DELETED',
        targetType: 'RENTAL_MODEL',
        targetId: id,
      });
    });
    this.invalidateModelsCache();
    return { id, deleted: true };
  }

  async updateModelSpecs(
    id: string,
    dto: UpdateModelSpecsDto,
    actorId: string,
  ) {
    const model = await this.prisma.rentalModel.findUnique({ where: { id } });
    if (!model) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Không tìm thấy mẫu máy.',
        details: {},
      });
    }

    const specsJson = dto as unknown as Prisma.InputJsonValue;
    const saved = await this.prisma.$transaction(async (tx) => {
      const upserted = await tx.rentalModelSpecs.upsert({
        where: { modelId: id },
        update: { specs: specsJson },
        create: { modelId: id, specs: specsJson },
      });
      await writeAuditLog(tx, {
        actorId,
        action: 'MODEL_SPECS_UPDATED',
        targetType: 'RENTAL_MODEL',
        targetId: id,
      });
      return upserted;
    });
    this.invalidateModelsCache();
    return { modelId: saved.modelId, specs: saved.specs };
  }

  async presignModelImage(modelId: string, dto: ImagePresignDto) {
    const model = await this.prisma.rentalModel.findUnique({
      where: { id: modelId },
      select: { id: true },
    });
    if (!model) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Không tìm thấy mẫu máy.',
        details: {},
      });
    }
    const ext = CONTENT_TYPE_EXTENSIONS[dto.contentType];
    const path = `models/${modelId}/${crypto.randomUUID()}.${ext}`;
    return this.storageService.createUploadUrl(
      this.getRentalImagesBucket(),
      path,
    );
  }

  async addModelImage(
    modelId: string,
    dto: CreateModelImageDto,
    actorId: string,
  ) {
    const model = await this.prisma.rentalModel.findUnique({
      where: { id: modelId },
      select: { id: true },
    });
    if (!model) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Không tìm thấy mẫu máy.',
        details: {},
      });
    }

    await this.storageService.assertOwnedFile(
      this.getRentalImagesBucket(),
      dto.path,
      `models/${modelId}/`,
      {
        maxBytes: 8 * 1024 * 1024,
        allowedMimeTypes: Object.keys(CONTENT_TYPE_EXTENSIONS),
      },
    );

    const image = await this.prisma.$transaction(async (tx) => {
      const created = await tx.rentalModelImage.create({
        data: {
          modelId,
          path: dto.path,
          kind: dto.kind,
          caption: dto.caption ?? null,
          sampleLens: dto.sampleLens ?? null,
          sortOrder: dto.sortOrder ?? 0,
        },
      });
      await writeAuditLog(tx, {
        actorId,
        action: 'MODEL_IMAGE_ADDED',
        targetType: 'RENTAL_MODEL',
        targetId: modelId,
        metadata: { imageId: created.id, path: created.path },
      });
      return created;
    });
    this.invalidateModelsCache();

    return {
      ...image,
      url: this.getModelImageUrl(image.path),
    };
  }

  async reorderModelImages(
    modelId: string,
    dto: ReorderImagesDto,
    actorId: string,
  ) {
    await this.prisma.$transaction(async (tx) => {
      await Promise.all(
        dto.imageIds.map((imageId, i) =>
          tx.rentalModelImage.updateMany({
            where: { id: imageId, modelId },
            data: { sortOrder: i },
          }),
        ),
      );
      await writeAuditLog(tx, {
        actorId,
        action: 'MODEL_IMAGES_REORDERED',
        targetType: 'RENTAL_MODEL',
        targetId: modelId,
      });
    });
    this.invalidateModelsCache();
    return { ok: true };
  }

  async deleteModelImage(modelId: string, imageId: string, actorId: string) {
    const img = await this.prisma.rentalModelImage.findFirst({
      where: { id: imageId, modelId },
    });
    if (!img) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Không tìm thấy ảnh.',
        details: {},
      });
    }
    await this.storageService.remove(this.getRentalImagesBucket(), img.path);
    await this.prisma.$transaction(async (tx) => {
      await tx.rentalModelImage.delete({ where: { id: imageId } });
      await writeAuditLog(tx, {
        actorId,
        action: 'MODEL_IMAGE_DELETED',
        targetType: 'RENTAL_MODEL',
        targetId: modelId,
        metadata: { imageId },
      });
    });
    this.invalidateModelsCache();
    return { deleted: true };
  }
}
