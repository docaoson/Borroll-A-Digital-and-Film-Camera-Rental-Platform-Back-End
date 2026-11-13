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
import { writeAuditLog } from '../../common/utils/audit.util';
import { PrismaService } from '../../infra/database/prisma.service';
import {
  STORAGE_SERVICE,
  StorageService,
} from '../../infra/storage/storage.service';
import { InventoryService } from '../inventory';
import {
  CreateBranchDto,
  CreateBrandDto,
  CreateCategoryDto,
  CreateFilmProductDto,
  CreateModelDto,
  CreateModelImageDto,
  ImagePresignDto,
  ListModelsQueryDto,
  ModelAvailabilityQueryDto,
  PaginationQueryDto,
  ReorderImagesDto,
  UpdateBranchDto,
  UpdateBrandDto,
  UpdateCategoryDto,
  UpdateContactSettingsDto,
  UpdateFilmProductDto,
  UpdateModelDto,
  UpdateModelSpecsDto,
} from './dto/catalog.dto';

const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;
const CONTACT_SETTINGS_CACHE_TTL_MS = 5 * 60 * 1000;
const CONTACT_SETTINGS_DEFAULT_ID = 'default';

export interface PublicContactSettingsResponse {
  chatEnabled: boolean;
  welcomeMessage: string | null;
  zalo: {
    oaId: string | null;
    url: string | null;
  };
  messenger: {
    url: string | null;
  };
  instagram: {
    handle: string | null;
    url: string | null;
  };
  hotline: string | null;
  branches: Array<{
    slug: string;
    name: string;
    phone: string;
  }>;
}

const CONTENT_TYPE_EXTENSIONS: Record<ImagePresignDto['contentType'], string> =
  {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
  };

interface CategoryTreeNode {
  id: string;
  slug: string;
  name: string;
  parentId: string | null;
  sortOrder: number;
  children: CategoryTreeNode[];
}

@Injectable()
export class CatalogService {
  private contactSettingsCache: {
    data: PublicContactSettingsResponse;
    expiresAt: number;
  } | null = null;

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

  async getPublicBranches() {
    const items = await this.prisma.branch.findMany({
      where: { isActive: true },
      orderBy: [{ name: 'asc' }],
    });
    return {
      items: items.map((b) => ({
        id: b.id,
        slug: b.slug,
        name: b.name,
        address: b.address,
        phone: b.phone,
        openHours: b.openHours,
        mapUrl: b.mapUrl,
      })),
    };
  }

  private invalidateContactSettingsCache(): void {
    this.contactSettingsCache = null;
  }

  private containsUrlOrHtml(value: string): boolean {
    if (/[<>]|javascript:|vbscript:|data:text\/html|on\w+\s*=/i.test(value)) {
      return true;
    }
    if (
      /(https?:\/\/|www\.|:\/\/|zalo\.me|m\.me|facebook\.com|fb\.com)/i.test(
        value,
      )
    ) {
      return true;
    }
    return false;
  }

  async getPublicContactSettings(): Promise<PublicContactSettingsResponse> {
    const now = Date.now();
    if (
      this.contactSettingsCache &&
      now < this.contactSettingsCache.expiresAt
    ) {
      return this.contactSettingsCache.data;
    }

    const [row, branches] = await Promise.all([
      this.prisma.contactSetting.findUnique({
        where: { id: CONTACT_SETTINGS_DEFAULT_ID },
      }),
      this.prisma.branch.findMany({
        where: { isActive: true },
        orderBy: [{ name: 'asc' }],
        select: { slug: true, name: true, phone: true },
      }),
    ]);

    const zaloOaId = row?.zaloOaId?.trim() || null;
    const zaloPhone = row?.zaloPhone?.trim() || null;
    const messengerPage = row?.messengerPage?.trim() || null;
    const instagramHandle = row?.instagramHandle?.trim() || null;
    const hotline = row?.hotline?.trim() || null;
    const welcomeMessage = row?.welcomeMessage?.trim() || null;

    const data: PublicContactSettingsResponse = {
      chatEnabled: Boolean(row?.isChatEnabled),
      welcomeMessage,
      zalo: {
        oaId: zaloOaId,
        url: zaloPhone ? `https://zalo.me/${zaloPhone}` : null,
      },
      messenger: {
        url: messengerPage ? `https://m.me/${messengerPage}` : null,
      },
      instagram: {
        handle: instagramHandle,
        url: instagramHandle
          ? `https://instagram.com/${instagramHandle}`
          : null,
      },
      hotline,
      branches: branches.map((b) => ({
        slug: b.slug,
        name: b.name,
        phone: b.phone,
      })),
    };

    this.contactSettingsCache = {
      data,
      expiresAt: now + CONTACT_SETTINGS_CACHE_TTL_MS,
    };

    return data;
  }

  async updateContactSettings(
    dto: UpdateContactSettingsDto,
    actorId: string,
  ): Promise<PublicContactSettingsResponse> {
    const fields: Record<string, string> = {};

    const rawZaloOaId =
      dto.zaloOaId !== undefined ? dto.zaloOaId : dto.zalo_oa_id;
    const rawZaloPhone =
      dto.zaloPhone !== undefined ? dto.zaloPhone : dto.zalo_phone;
    const rawMessengerPage =
      dto.messengerPage !== undefined ? dto.messengerPage : dto.messenger_page;
    const rawInstagramHandle =
      dto.instagramHandle !== undefined
        ? dto.instagramHandle
        : dto.instagram_handle;
    const rawHotline = dto.hotline;
    const rawWelcomeMessage =
      dto.welcomeMessage !== undefined
        ? dto.welcomeMessage
        : dto.welcome_message;
    const rawChatEnabled =
      dto.isChatEnabled !== undefined
        ? dto.isChatEnabled
        : dto.is_chat_enabled !== undefined
          ? dto.is_chat_enabled
          : dto.chatEnabled;

    const normalizeNullable = (
      val: string | null | undefined,
    ): string | null | undefined => {
      if (val === undefined) return undefined;
      if (val === null) return null;
      const trimmed = val.trim();
      return trimmed.length === 0 ? null : trimmed;
    };

    const zaloOaId = normalizeNullable(rawZaloOaId);
    const zaloPhone = normalizeNullable(rawZaloPhone);
    const messengerPage = normalizeNullable(rawMessengerPage);
    const instagramHandle = normalizeNullable(rawInstagramHandle);
    const hotline = normalizeNullable(rawHotline);
    const welcomeMessage = normalizeNullable(rawWelcomeMessage);

    if (typeof zaloOaId === 'string') {
      if (this.containsUrlOrHtml(zaloOaId) || !/^\d{1,30}$/.test(zaloOaId)) {
        fields.zaloOaId = 'Zalo OA ID chỉ gồm chữ số (tối đa 30 ký tự).';
      }
    }

    if (typeof zaloPhone === 'string') {
      if (this.containsUrlOrHtml(zaloPhone) || !/^0\d{9}$/.test(zaloPhone)) {
        fields.zaloPhone =
          'Số điện thoại Zalo phải gồm 10 chữ số bắt đầu bằng 0.';
      }
    }

    if (typeof hotline === 'string') {
      if (this.containsUrlOrHtml(hotline) || !/^0\d{9}$/.test(hotline)) {
        fields.hotline = 'Số hotline phải gồm 10 chữ số bắt đầu bằng 0.';
      }
    }

    if (typeof messengerPage === 'string') {
      if (
        this.containsUrlOrHtml(messengerPage) ||
        !/^[A-Za-z0-9.]{5,50}$/.test(messengerPage)
      ) {
        fields.messengerPage =
          'Tên trang Messenger chỉ gồm chữ cái, chữ số hoặc dấu chấm (5-50 ký tự), không nhận URL.';
      }
    }

    if (typeof instagramHandle === 'string') {
      if (
        this.containsUrlOrHtml(instagramHandle) ||
        !/^[A-Za-z0-9._]{1,30}$/.test(instagramHandle)
      ) {
        fields.instagramHandle =
          'Tài khoản Instagram chỉ gồm chữ cái, chữ số, dấu gạch dưới hoặc dấu chấm (tối đa 30 ký tự), không nhận URL.';
      }
    }

    if (typeof welcomeMessage === 'string') {
      if (this.containsUrlOrHtml(welcomeMessage)) {
        fields.welcomeMessage =
          'Lời chào không được chứa đường dẫn URL hoặc mã HTML/script.';
      } else if (welcomeMessage.length > 120) {
        fields.welcomeMessage = 'Lời chào tối đa 120 ký tự.';
      }
    }

    if (Object.keys(fields).length > 0) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Dữ liệu cấu hình liên hệ không hợp lệ.',
        details: { fields },
      });
    }

    const updateData: Prisma.ContactSettingUncheckedUpdateInput = {
      updatedBy: actorId,
    };
    const createData: Prisma.ContactSettingUncheckedCreateInput = {
      id: CONTACT_SETTINGS_DEFAULT_ID,
      zaloOaId: zaloOaId ?? null,
      zaloPhone: zaloPhone ?? null,
      messengerPage: messengerPage ?? null,
      instagramHandle: instagramHandle ?? null,
      hotline: hotline ?? null,
      welcomeMessage: welcomeMessage ?? null,
      isChatEnabled: rawChatEnabled ?? false,
      updatedBy: actorId,
    };

    if (zaloOaId !== undefined) updateData.zaloOaId = zaloOaId;
    if (zaloPhone !== undefined) updateData.zaloPhone = zaloPhone;
    if (messengerPage !== undefined) updateData.messengerPage = messengerPage;
    if (instagramHandle !== undefined) {
      updateData.instagramHandle = instagramHandle;
    }
    if (hotline !== undefined) updateData.hotline = hotline;
    if (welcomeMessage !== undefined) {
      updateData.welcomeMessage = welcomeMessage;
    }
    if (rawChatEnabled !== undefined) {
      updateData.isChatEnabled = rawChatEnabled;
    }

    await this.prisma.$transaction(async (tx) => {
      const saved = await tx.contactSetting.upsert({
        where: { id: CONTACT_SETTINGS_DEFAULT_ID },
        update: updateData,
        create: createData,
      });

      await writeAuditLog(tx, {
        actorId,
        action: 'CONTACT_SETTINGS_UPDATED',
        targetType: 'CONTACT_SETTINGS',
        targetId: saved.id,
        metadata: {
          zaloOaId: saved.zaloOaId,
          zaloPhone: saved.zaloPhone,
          messengerPage: saved.messengerPage,
          instagramHandle: saved.instagramHandle,
          hotline: saved.hotline,
          welcomeMessage: saved.welcomeMessage,
          isChatEnabled: saved.isChatEnabled,
        },
      });
    });

    this.invalidateContactSettingsCache();
    return this.getPublicContactSettings();
  }

  async getPublicCategories() {
    const rows = await this.prisma.category.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });

    const nodeMap = new Map<string, CategoryTreeNode>();
    for (const row of rows) {
      nodeMap.set(row.id, {
        id: row.id,
        slug: row.slug,
        name: row.name,
        parentId: row.parentId,
        sortOrder: row.sortOrder,
        children: [],
      });
    }

    const roots: CategoryTreeNode[] = [];
    for (const node of nodeMap.values()) {
      if (!node.parentId) {
        roots.push(node);
      } else if (nodeMap.has(node.parentId)) {
        nodeMap.get(node.parentId)!.children.push(node);
      }
    }

    const stripMeta = (
      node: CategoryTreeNode,
    ): { id: string; slug: string; name: string; children: unknown[] } => ({
      id: node.id,
      slug: node.slug,
      name: node.name,
      children: node.children.map(stripMeta),
    });

    return { items: roots.map(stripMeta) };
  }

  async getPublicBrands() {
    const items = await this.prisma.brand.findMany({
      where: { isActive: true },
      orderBy: [{ name: 'asc' }],
    });
    return {
      items: items.map((b) => ({
        id: b.id,
        slug: b.slug,
        name: b.name,
      })),
    };
  }

  async getPublicFilmProducts() {
    const items = await this.prisma.filmProduct.findMany({
      where: { isActive: true, inStock: true },
      orderBy: [{ name: 'asc' }],
    });
    return {
      items: items.map((f) => ({
        id: f.id,
        name: f.name,
        iso: f.iso,
        format: f.format,
        price: f.price,
        inStock: f.inStock,
        imageUrl: f.imagePath ? this.getModelImageUrl(f.imagePath) : null,
      })),
    };
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

  async listPublicModels(query: ListModelsQueryDto, userId?: string) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    const [allCategories, qMatchedIds] = await Promise.all([
      this.prisma.category.findMany({
        select: { id: true, slug: true, name: true, parentId: true },
      }),
      query.q?.trim()
        ? this.findMatchingModelIdsByQuery(query.q)
        : Promise.resolve<string[] | null>(null),
    ]);
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

    const hasDateRange = Boolean(query.from && query.to);
    const activeBranchFilter = query.branch?.trim() || undefined;

    // Fetch all active models matching non-facet base constraints, then compute facets and final page cleanly
    const baseWhere: Prisma.RentalModelWhereInput = { isActive: true };
    if (qMatchedIds !== null) {
      baseWhere.id = { in: qMatchedIds };
    }
    if (query.kind) baseWhere.kind = query.kind;
    if (query.cameraType) baseWhere.cameraType = query.cameraType;
    if (query.mount) baseWhere.mount = query.mount;
    if (query.featured === 'true') baseWhere.isFeatured = true;
    if (query.excludeId) {
      baseWhere.AND = [{ id: { not: query.excludeId } }];
    }

    let orderBy: Prisma.RentalModelOrderByWithRelationInput[] = [
      { isFeatured: 'desc' },
      { createdAt: 'desc' },
    ];
    if (query.sort === 'price_asc') {
      orderBy = [{ pricePerDay: 'asc' }, { id: 'asc' }];
    } else if (query.sort === 'price_desc') {
      orderBy = [{ pricePerDay: 'desc' }, { id: 'asc' }];
    } else if (query.sort === 'newest') {
      orderBy = [{ createdAt: 'desc' }, { id: 'asc' }];
    }

    const candidates = await this.prisma.rentalModel.findMany({
      where: baseWhere,
      include: {
        brand: { select: { slug: true, name: true } },
        category: {
          select: { id: true, slug: true, name: true, parentId: true },
        },
        images: {
          where: { kind: 'PRODUCT' },
          orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
          take: 1,
        },
        units:
          activeBranchFilter && !hasDateRange
            ? {
                where: {
                  status: 'AVAILABLE',
                  branch: { slug: activeBranchFilter, isActive: true },
                },
                select: { id: true },
                take: 1,
              }
            : false,
      },
      orderBy,
    });

    let availabilityMap: Map<string, string[]> | null = null;
    if (hasDateRange) {
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
        return Array.isArray(model.units) && model.units.length > 0;
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

    // Facets: apply all OTHER filters except the facet's own group
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
          thumbnailUrl: m.images[0]
            ? this.getModelImageUrl(m.images[0].path)
            : null,
          isFeatured: m.isFeatured,
          badges: this.buildBadges(m.createdAt),
          isFavorite: favoriteSet.has(m.id),
          description: m.description,
        };
        if (hasDateRange) {
          baseItem.availableAtBranches = availabilityMap?.get(m.id) ?? [];
        }
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
    const model = await this.prisma.rentalModel.findFirst({
      where: { slug, isActive: true },
      include: {
        brand: { select: { slug: true, name: true } },
        category: { select: { slug: true, name: true } },
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

    const [availableAtBranches, favorite] = await Promise.all([
      this.inventoryService.getActiveUnitBranchSlugsForModel(model.id),
      userId
        ? this.prisma.favorite.findUnique({
            where: { userId_modelId: { userId, modelId: model.id } },
          })
        : Promise.resolve(null),
    ]);

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

    return {
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
      isFavorite: Boolean(favorite),
    };
  }

  async getModelAvailability(
    modelId: string,
    query: ModelAvailabilityQueryDto,
  ) {
    const [model, branch] = await Promise.all([
      this.prisma.rentalModel.findFirst({
        where: { id: modelId, isActive: true },
        select: { id: true },
      }),
      this.prisma.branch.findFirst({
        where: { slug: query.branch, isActive: true },
        select: { id: true, slug: true },
      }),
    ]);

    if (!model || !branch) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Không tìm thấy mẫu máy hoặc chi nhánh.',
        details: {},
      });
    }

    const unavailableDates =
      await this.inventoryService.getUnavailableDatesForModel({
        modelId: model.id,
        branchId: branch.id,
        month: query.month,
      });

    return {
      month: query.month,
      branch: branch.slug,
      unavailableDates,
    };
  }

  async addFavorite(userId: string, modelId: string): Promise<void> {
    const model = await this.prisma.rentalModel.findFirst({
      where: { id: modelId, isActive: true },
      select: { id: true },
    });
    if (!model) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Không tìm thấy mẫu máy.',
        details: {},
      });
    }

    await this.prisma.favorite.upsert({
      where: { userId_modelId: { userId, modelId } },
      update: {},
      create: { userId, modelId },
    });
  }

  async removeFavorite(userId: string, modelId: string): Promise<void> {
    await this.prisma.favorite.deleteMany({
      where: { userId, modelId },
    });
  }

  async listFavorites(userId: string, query: PaginationQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    const where: Prisma.FavoriteWhereInput = {
      userId,
      model: { isActive: true },
    };

    const [favs, total] = await Promise.all([
      this.prisma.favorite.findMany({
        where,
        include: {
          model: {
            include: {
              brand: { select: { slug: true, name: true } },
              category: { select: { slug: true, name: true } },
              images: {
                where: { kind: 'PRODUCT' },
                orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
                take: 1,
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.favorite.count({ where }),
    ]);

    return {
      items: favs.map(({ model: m }) => ({
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
        isFavorite: true,
      })),
      page,
      pageSize,
      total,
    };
  }

  // Exported helpers for BookingModule
  async findActiveBranchBySlug(slug: string) {
    return this.prisma.branch.findFirst({
      where: { slug, isActive: true },
    });
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

  async findFilmProductsByIds(ids: string[]) {
    return this.prisma.filmProduct.findMany({
      where: { id: { in: ids } },
    });
  }

  // Admin Catalog CRUD
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
    return { deleted: true };
  }

  // Categories, Brands, Branches, Film Products Admin CRUD
  async listAdminCategories(query: PaginationQueryDto) {
    const where: Prisma.CategoryWhereInput = query.q?.trim()
      ? { name: { contains: query.q.trim(), mode: 'insensitive' } }
      : {};
    const items = await this.prisma.category.findMany({
      where,
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    return {
      items,
      page: 1,
      pageSize: items.length || 20,
      total: items.length,
    };
  }

  async createCategory(dto: CreateCategoryDto, actorId: string) {
    const item = await this.prisma.category.create({
      data: {
        name: dto.name.trim(),
        slug: dto.slug.trim().toLowerCase(),
        parentId: dto.parentId ?? null,
        sortOrder: dto.sortOrder ?? 0,
        isActive: dto.isActive ?? true,
      },
    });
    await writeAuditLog(this.prisma, {
      actorId,
      action: 'CATEGORY_CREATED',
      targetType: 'CATEGORY',
      targetId: item.id,
    });
    return item;
  }

  async updateCategory(id: string, dto: UpdateCategoryDto, actorId: string) {
    const item = await this.prisma.category.update({
      where: { id },
      data: {
        name: dto.name?.trim(),
        slug: dto.slug?.trim().toLowerCase(),
        parentId: dto.parentId,
        sortOrder: dto.sortOrder,
        isActive: dto.isActive,
      },
    });
    await writeAuditLog(this.prisma, {
      actorId,
      action: 'CATEGORY_UPDATED',
      targetType: 'CATEGORY',
      targetId: id,
    });
    return item;
  }

  async deleteCategory(id: string, actorId: string) {
    const used = await this.prisma.rentalModel.count({
      where: { categoryId: id },
    });
    if (used > 0) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Không thể xóa danh mục đang có mẫu máy.',
        details: {},
      });
    }
    await this.prisma.category.delete({ where: { id } });
    await writeAuditLog(this.prisma, {
      actorId,
      action: 'CATEGORY_DELETED',
      targetType: 'CATEGORY',
      targetId: id,
    });
    return { deleted: true };
  }

  async listAdminBrands(query: PaginationQueryDto) {
    const where: Prisma.BrandWhereInput = query.q?.trim()
      ? { name: { contains: query.q.trim(), mode: 'insensitive' } }
      : {};
    const items = await this.prisma.brand.findMany({
      where,
      orderBy: [{ name: 'asc' }],
    });
    return {
      items,
      page: 1,
      pageSize: items.length || 20,
      total: items.length,
    };
  }

  async createBrand(dto: CreateBrandDto, actorId: string) {
    const item = await this.prisma.brand.create({
      data: {
        name: dto.name.trim(),
        slug: dto.slug.trim().toLowerCase(),
        isActive: dto.isActive ?? true,
      },
    });
    await writeAuditLog(this.prisma, {
      actorId,
      action: 'BRAND_CREATED',
      targetType: 'BRAND',
      targetId: item.id,
    });
    return item;
  }

  async updateBrand(id: string, dto: UpdateBrandDto, actorId: string) {
    const item = await this.prisma.brand.update({
      where: { id },
      data: {
        name: dto.name?.trim(),
        slug: dto.slug?.trim().toLowerCase(),
        isActive: dto.isActive,
      },
    });
    await writeAuditLog(this.prisma, {
      actorId,
      action: 'BRAND_UPDATED',
      targetType: 'BRAND',
      targetId: id,
    });
    return item;
  }

  async deleteBrand(id: string, actorId: string) {
    const used = await this.prisma.rentalModel.count({
      where: { brandId: id },
    });
    if (used > 0) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Không thể xóa hãng đang có mẫu máy.',
        details: {},
      });
    }
    await this.prisma.brand.delete({ where: { id } });
    await writeAuditLog(this.prisma, {
      actorId,
      action: 'BRAND_DELETED',
      targetType: 'BRAND',
      targetId: id,
    });
    return { deleted: true };
  }

  async listAdminBranches(query: PaginationQueryDto) {
    const where: Prisma.BranchWhereInput = query.q?.trim()
      ? { name: { contains: query.q.trim(), mode: 'insensitive' } }
      : {};
    const items = await this.prisma.branch.findMany({
      where,
      orderBy: [{ name: 'asc' }],
    });
    return {
      items,
      page: 1,
      pageSize: items.length || 20,
      total: items.length,
    };
  }

  async createBranch(dto: CreateBranchDto, actorId: string) {
    const item = await this.prisma.branch.create({
      data: {
        name: dto.name.trim(),
        slug: dto.slug.trim().toLowerCase(),
        address: dto.address.trim(),
        phone: dto.phone.trim(),
        openHours: dto.openHours.trim(),
        mapUrl: dto.mapUrl ?? null,
        isActive: dto.isActive ?? true,
      },
    });
    await writeAuditLog(this.prisma, {
      actorId,
      action: 'BRANCH_CREATED',
      targetType: 'BRANCH',
      targetId: item.id,
    });
    this.invalidateContactSettingsCache();
    return item;
  }

  async updateBranch(id: string, dto: UpdateBranchDto, actorId: string) {
    const item = await this.prisma.branch.update({
      where: { id },
      data: {
        name: dto.name?.trim(),
        slug: dto.slug?.trim().toLowerCase(),
        address: dto.address?.trim(),
        phone: dto.phone?.trim(),
        openHours: dto.openHours?.trim(),
        mapUrl: dto.mapUrl,
        isActive: dto.isActive,
      },
    });
    await writeAuditLog(this.prisma, {
      actorId,
      action: 'BRANCH_UPDATED',
      targetType: 'BRANCH',
      targetId: id,
    });
    this.invalidateContactSettingsCache();
    return item;
  }

  async deleteBranch(id: string, actorId: string) {
    const used = await this.prisma.rentalUnit.count({
      where: { branchId: id },
    });
    if (used > 0) {
      const updated = await this.prisma.branch.update({
        where: { id },
        data: { isActive: false },
      });
      await writeAuditLog(this.prisma, {
        actorId,
        action: 'BRANCH_DEACTIVATED',
        targetType: 'BRANCH',
        targetId: id,
      });
      this.invalidateContactSettingsCache();
      return updated;
    }
    await this.prisma.branch.delete({ where: { id } });
    await writeAuditLog(this.prisma, {
      actorId,
      action: 'BRANCH_DELETED',
      targetType: 'BRANCH',
      targetId: id,
    });
    this.invalidateContactSettingsCache();
    return { deleted: true };
  }

  async listAdminFilmProducts(query: PaginationQueryDto) {
    const where: Prisma.FilmProductWhereInput = query.q?.trim()
      ? { name: { contains: query.q.trim(), mode: 'insensitive' } }
      : {};
    const items = await this.prisma.filmProduct.findMany({
      where,
      orderBy: [{ name: 'asc' }],
    });
    return {
      items,
      page: 1,
      pageSize: items.length || 20,
      total: items.length,
    };
  }

  async createFilmProduct(dto: CreateFilmProductDto, actorId: string) {
    const item = await this.prisma.filmProduct.create({
      data: {
        name: dto.name.trim(),
        iso: dto.iso,
        format: dto.format.trim(),
        price: dto.price,
        inStock: dto.inStock ?? true,
        isActive: dto.isActive ?? true,
      },
    });
    await writeAuditLog(this.prisma, {
      actorId,
      action: 'FILM_PRODUCT_CREATED',
      targetType: 'FILM_PRODUCT',
      targetId: item.id,
    });
    return item;
  }

  async updateFilmProduct(
    id: string,
    dto: UpdateFilmProductDto,
    actorId: string,
  ) {
    const item = await this.prisma.filmProduct.update({
      where: { id },
      data: {
        name: dto.name?.trim(),
        iso: dto.iso,
        format: dto.format?.trim(),
        price: dto.price,
        inStock: dto.inStock,
        isActive: dto.isActive,
      },
    });
    await writeAuditLog(this.prisma, {
      actorId,
      action: 'FILM_PRODUCT_UPDATED',
      targetType: 'FILM_PRODUCT',
      targetId: id,
    });
    return item;
  }

  async deleteFilmProduct(id: string, actorId: string) {
    const used = await this.prisma.bookingAddon.count({
      where: { filmProductId: id },
    });
    if (used > 0) {
      const updated = await this.prisma.filmProduct.update({
        where: { id },
        data: { inStock: false, isActive: false },
      });
      await writeAuditLog(this.prisma, {
        actorId,
        action: 'FILM_PRODUCT_OUT_OF_STOCK',
        targetType: 'FILM_PRODUCT',
        targetId: id,
      });
      return updated;
    }
    await this.prisma.filmProduct.delete({ where: { id } });
    await writeAuditLog(this.prisma, {
      actorId,
      action: 'FILM_PRODUCT_DELETED',
      targetType: 'FILM_PRODUCT',
      targetId: id,
    });
    return { deleted: true };
  }
}
