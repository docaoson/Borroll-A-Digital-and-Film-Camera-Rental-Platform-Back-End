import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
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
  PaginationQueryDto,
  ReorderImagesDto,
  UpdateModelDto,
  UpdateModelSpecsDto,
} from '../dto/catalog.dto';

const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;

const CONTENT_TYPE_EXTENSIONS: Record<ImagePresignDto['contentType'], string> =
  {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
  };

@Injectable()
export class ModelService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly inventoryService: InventoryService,
    @Inject(STORAGE_SERVICE)
    private readonly storageService: StorageService,
  ) {}

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

  private async findMatchingModelIdsByQuery(q: string): Promise<string[]> {
    const tokens = q.trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) {
      return [];
    }

    const conditions = tokens.map(
      (token) =>
        Prisma.sql`unaccent(lower(rm.name || ' ' || b.name)) LIKE '%' || unaccent(lower(${token})) || '%'`,
    );

    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT rm.id
      FROM rental_models rm
      INNER JOIN brands b ON b.id = rm.brand_id
      WHERE rm.is_active = true
        AND ${Prisma.join(conditions, ' AND ')}
    `);
    return rows.map((r) => r.id);
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
   * ARCHITECTURAL DECISION: In-memory filtering and scoring for Catalog Models.
   *
   * Rental model search involves multi-token Vietnamese unaccented matching, hierarchical
   * category-tree expansion, and real-time inventory availability scoring against branch dates.
   * For the current catalog scale (< 500 models), in-memory evaluation provides deterministic
   * sub-10ms response times without combinatorial SQL join explosions.
   * Scalability path: Migrate search to PostgreSQL pg_trgm indices or Elasticsearch when catalog > 10,000 models.
   */
  async listPublicModels(query: ListModelsQueryDto, userId?: string) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    let matchingIds: string[] | null = null;
    if (query.q) {
      matchingIds = await this.findMatchingModelIdsByQuery(query.q);
      if (matchingIds.length === 0) {
        return { items: [], page, pageSize, total: 0 };
      }
    }

    const where: Prisma.RentalModelWhereInput = {
      isActive: true,
    };

    if (matchingIds !== null) {
      where.id = { in: matchingIds };
    }

    if (query.kind) {
      where.kind = query.kind;
    }

    if (query.cameraType) {
      where.cameraType = query.cameraType;
    }

    if (query.brand) {
      const brandSlugs = query.brand
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
      if (brandSlugs.length > 0) {
        where.brand = { slug: { in: brandSlugs } };
      }
    }

    if (query.category) {
      const catSlugs = query.category
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
      if (catSlugs.length > 0) {
        const allCategories = await this.prisma.category.findMany({
          select: { id: true, slug: true, parentId: true },
        });
        const expanded = this.expandCategorySlugs(catSlugs, allCategories);
        where.category = { slug: { in: expanded } };
      }
    }

    if (query.minPrice !== undefined || query.maxPrice !== undefined) {
      where.pricePerDay = {};
      if (query.minPrice !== undefined) {
        where.pricePerDay.gte = query.minPrice;
      }
      if (query.maxPrice !== undefined) {
        where.pricePerDay.lte = query.maxPrice;
      }
    }

    const allModels = await this.prisma.rentalModel.findMany({
      where,
      include: {
        brand: { select: { slug: true, name: true } },
        category: { select: { slug: true, name: true } },
        images: {
          where: { kind: 'PRODUCT' },
          orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
          take: 1,
        },
      },
      orderBy: [{ isFeatured: 'desc' }, { createdAt: 'desc' }],
    });

    const favoriteModelIds = new Set<string>();
    if (userId) {
      const favs = await this.prisma.favorite.findMany({
        where: { userId },
        select: { modelId: true },
      });
      for (const f of favs) {
        favoriteModelIds.add(f.modelId);
      }
    }

    let branchIdFilter: string | null = null;
    if (query.branch) {
      const br = await this.prisma.branch.findUnique({
        where: { slug: query.branch },
        select: { id: true },
      });
      branchIdFilter = br?.id ?? '__none__';
    }

    const start = query.startDate;
    const end = query.endDate;
    const hasDateFilter = Boolean(start && end);

    const itemsWithAvail = await Promise.all(
      allModels.map(async (m) => {
        let isAvailable = true;
        if (hasDateFilter && start && end) {
          isAvailable = await this.inventoryService.checkModelAvailability(
            m.id,
            branchIdFilter ?? undefined,
            start,
            end,
          );
        } else if (branchIdFilter) {
          const unitCount = await this.prisma.rentalUnit.count({
            where: {
              modelId: m.id,
              branchId: branchIdFilter,
              status: 'AVAILABLE',
            },
          });
          isAvailable = unitCount > 0;
        }

        return {
          id: m.id,
          slug: m.slug,
          name: m.name,
          kind: m.kind,
          cameraType: m.cameraType,
          brand: m.brand,
          category: m.category,
          mount: m.mount,
          pricePerDay: m.pricePerDay,
          pricePerWeek: m.pricePerWeek,
          deposit: m.deposit,
          thumbnailUrl: m.images[0]
            ? this.getModelImageUrl(m.images[0].path)
            : null,
          isFeatured: m.isFeatured,
          badges: this.buildBadges(m.createdAt),
          isAvailable,
          isFavorite: favoriteModelIds.has(m.id),
        };
      }),
    );

    let filtered = itemsWithAvail;
    if (query.availableOnly) {
      filtered = filtered.filter((item) => item.isAvailable);
    }

    switch (query.sort) {
      case 'price_asc':
        filtered.sort((a, b) => a.pricePerDay - b.pricePerDay);
        break;
      case 'price_desc':
        filtered.sort((a, b) => b.pricePerDay - a.pricePerDay);
        break;
      case 'newest':
        break;
      case 'featured':
      default:
        filtered.sort((a, b) => (b.isFeatured ? 1 : 0) - (a.isFeatured ? 1 : 0));
        break;
    }

    const total = filtered.length;
    const paginated = filtered.slice((page - 1) * pageSize, page * pageSize);

    return {
      items: paginated,
      page,
      pageSize,
      total,
    };
  }

  async getPublicModelBySlug(slug: string, userId?: string) {
    const model = await this.prisma.rentalModel.findFirst({
      where: { slug, isActive: true },
      include: {
        brand: true,
        category: true,
        images: {
          orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        },
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

    let isFavorite = false;
    if (userId) {
      const fav = await this.prisma.favorite.findUnique({
        where: { userId_modelId: { userId, modelId: model.id } },
      });
      isFavorite = Boolean(fav);
    }

    const units = await this.prisma.rentalUnit.findMany({
      where: { modelId: model.id, status: 'AVAILABLE' },
      select: { branchId: true },
    });
    const branchIds = Array.from(new Set(units.map((u) => u.branchId)));
    const branches = await this.prisma.branch.findMany({
      where: { id: { in: branchIds }, isActive: true },
      select: { slug: true, name: true },
      orderBy: [{ name: 'asc' }],
    });

    return {
      id: model.id,
      slug: model.slug,
      name: model.name,
      kind: model.kind,
      cameraType: model.cameraType,
      brand: model.brand,
      category: model.category,
      mount: model.mount,
      filmFormat: model.filmFormat,
      description: model.description,
      pricePerDay: model.pricePerDay,
      pricePerWeek: model.pricePerWeek,
      deposit: model.deposit,
      isFeatured: model.isFeatured,
      badges: this.buildBadges(model.createdAt),
      isFavorite,
      images: model.images.map((img) => ({
        id: img.id,
        kind: img.kind,
        url: this.getModelImageUrl(img.path),
        caption: img.caption,
        sortOrder: img.sortOrder,
      })),
      specs: model.specs
        ? {
            power: model.specs.power,
            controls: model.specs.controls,
            quirks: model.specs.quirks,
            beginnerNotes: model.specs.beginnerNotes,
          }
        : null,
      availableAtBranches: branches,
    };
  }

  async getModelAvailability(
    modelId: string,
    branchSlug: string,
    month: string,
  ) {
    const branch = await this.prisma.branch.findUnique({
      where: { slug: branchSlug },
    });
    if (!branch) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Không tìm thấy chi nhánh.',
        details: {},
      });
    }

    const [yearStr, monthStr] = month.split('-');
    const year = parseInt(yearStr, 10);
    const m = parseInt(monthStr, 10);
    const daysInMonth = new Date(year, m, 0).getDate();

    const units = await this.prisma.rentalUnit.findMany({
      where: {
        modelId,
        branchId: branch.id,
        status: { in: ['AVAILABLE', 'MAINTENANCE'] },
      },
      select: { id: true },
    });
    const totalUnits = units.length;

    if (totalUnits === 0) {
      const allDates: string[] = [];
      for (let day = 1; day <= daysInMonth; day++) {
        allDates.push(
          `${year}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
        );
      }
      return {
        month,
        branch: branch.slug,
        totalUnits: 0,
        unavailableDates: allDates,
      };
    }

    const unavailableDates: string[] = [];
    for (let day = 1; day <= daysInMonth; day++) {
      const dayStr = `${year}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const isAvail = await this.inventoryService.checkModelAvailability(
        modelId,
        branch.id,
        dayStr,
        dayStr,
      );
      if (!isAvail) {
        unavailableDates.push(dayStr);
      }
    }

    return {
      month,
      branch: branch.slug,
      totalUnits,
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
        await writeAuditLog(tx, {
          actorId,
          action: 'MODEL_CREATED',
          targetType: 'RENTAL_MODEL',
          targetId: model.id,
          metadata: { slug: model.slug, pricePerDay: model.pricePerDay },
        });
        return model;
      });
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
            mount: dto.mount !== undefined ? dto.mount : undefined,
            filmFormat: dto.filmFormat !== undefined ? dto.filmFormat : undefined,
            pricePerDay: dto.pricePerDay,
            pricePerWeek: dto.pricePerWeek,
            deposit: dto.deposit,
            isActive: dto.isActive,
            isFeatured: dto.isFeatured,
            lastInspectedAt: dto.lastInspectedAt
              ? new Date(dto.lastInspectedAt)
              : undefined,
            inspectionNotes: dto.inspectionNotes
              ? (dto.inspectionNotes as unknown as Prisma.InputJsonValue)
              : undefined,
          },
        });
        await writeAuditLog(tx, {
          actorId,
          action: 'MODEL_UPDATED',
          targetType: 'RENTAL_MODEL',
          targetId: id,
          metadata: { id },
        });
      });
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
    });
    if (!existing) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Không tìm thấy mẫu máy.',
        details: {},
      });
    }

    const unitsCount = await this.prisma.rentalUnit.count({
      where: { modelId: id },
    });
    if (unitsCount > 0) {
      await this.prisma.rentalModel.update({
        where: { id },
        data: { isActive: false },
      });
      return { success: true, message: 'Mẫu máy có chứa thiết bị trong kho nên đã chuyển sang ẩn (isActive = false).' };
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.rentalModel.delete({ where: { id } });
      await writeAuditLog(tx, {
        actorId,
        action: 'MODEL_DELETED',
        targetType: 'RENTAL_MODEL',
        targetId: id,
        metadata: { slug: existing.slug },
      });
    });
    return { success: true };
  }

  async updateModelSpecs(
    modelId: string,
    dto: UpdateModelSpecsDto,
    actorId: string,
  ) {
    const model = await this.prisma.rentalModel.findUnique({
      where: { id: modelId },
    });
    if (!model) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Không tìm thấy mẫu máy.',
        details: {},
      });
    }

    return this.prisma.$transaction(async (tx) => {
      const specs = await tx.modelSpec.upsert({
        where: { modelId },
        update: {
          power: dto.power,
          controls: dto.controls,
          quirks: dto.quirks,
          beginnerNotes: dto.beginnerNotes,
        },
        create: {
          modelId,
          power: dto.power,
          controls: dto.controls ?? [],
          quirks: dto.quirks ?? [],
          beginnerNotes: dto.beginnerNotes ?? [],
        },
      });
      await writeAuditLog(tx, {
        actorId,
        action: 'MODEL_SPECS_UPDATED',
        targetType: 'RENTAL_MODEL',
        targetId: modelId,
        metadata: { modelId },
      });
      return specs;
    });
  }

  async presignModelImage(modelId: string, dto: ImagePresignDto) {
    const model = await this.prisma.rentalModel.findUnique({
      where: { id: modelId },
    });
    if (!model) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Không tìm thấy mẫu máy.',
        details: {},
      });
    }

    const ext = CONTENT_TYPE_EXTENSIONS[dto.contentType];
    const uuid = crypto.randomUUID();
    const objectPath = `models/${modelId}/${uuid}.${ext}`;
    const bucket = this.getRentalImagesBucket();

    const presigned = await this.storageService.createSignedUploadUrl(
      bucket,
      objectPath,
      600,
    );

    return {
      uploadUrl: presigned.signedUrl,
      path: objectPath,
      publicUrl: this.storageService.getPublicUrl(bucket, objectPath),
    };
  }

  async addModelImage(
    modelId: string,
    dto: CreateModelImageDto,
    actorId: string,
  ) {
    const model = await this.prisma.rentalModel.findUnique({
      where: { id: modelId },
    });
    if (!model) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Không tìm thấy mẫu máy.',
        details: {},
      });
    }

    return this.prisma.$transaction(async (tx) => {
      const img = await tx.modelImage.create({
        data: {
          modelId,
          path: dto.path,
          kind: dto.kind,
          caption: dto.caption?.trim() || null,
          sortOrder: dto.sortOrder ?? 0,
        },
      });
      await writeAuditLog(tx, {
        actorId,
        action: 'MODEL_IMAGE_ADDED',
        targetType: 'RENTAL_MODEL',
        targetId: modelId,
        metadata: { imageId: img.id, path: img.path },
      });
      return {
        ...img,
        url: this.getModelImageUrl(img.path),
      };
    });
  }

  async reorderModelImages(
    modelId: string,
    dto: ReorderImagesDto,
    actorId: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      for (const item of dto.items) {
        await tx.modelImage.updateMany({
          where: { id: item.id, modelId },
          data: { sortOrder: item.sortOrder },
        });
      }
      await writeAuditLog(tx, {
        actorId,
        action: 'MODEL_IMAGES_REORDERED',
        targetType: 'RENTAL_MODEL',
        targetId: modelId,
        metadata: { count: dto.items.length },
      });
      return { success: true };
    });
  }

  async deleteModelImage(modelId: string, imageId: string, actorId: string) {
    const img = await this.prisma.modelImage.findFirst({
      where: { id: imageId, modelId },
    });
    if (!img) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Không tìm thấy ảnh.',
        details: {},
      });
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.modelImage.delete({ where: { id: imageId } });
      await writeAuditLog(tx, {
        actorId,
        action: 'MODEL_IMAGE_DELETED',
        targetType: 'RENTAL_MODEL',
        targetId: modelId,
        metadata: { imageId, path: img.path },
      });
    });
    return { success: true };
  }
}

