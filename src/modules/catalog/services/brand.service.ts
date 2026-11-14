import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { writeAuditLog } from '../../../common/utils/audit.util';
import { PrismaService } from '../../../infra/database/prisma.service';
import {
  CreateBrandDto,
  PaginationQueryDto,
  UpdateBrandDto,
} from '../dto/catalog.dto';

const BRAND_CACHE_TTL_MS = 5 * 60 * 1000;

@Injectable()
export class BrandService {
  private publicBrandsCache: {
    data: { items: Array<{ id: string; slug: string; name: string }> };
    expiresAt: number;
  } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  public invalidateBrandCache(): void {
    this.publicBrandsCache = null;
  }

  async getPublicBrands() {
    const now = Date.now();
    if (this.publicBrandsCache && now < this.publicBrandsCache.expiresAt) {
      return this.publicBrandsCache.data;
    }

    const items = await this.prisma.brand.findMany({
      where: { isActive: true },
      orderBy: [{ name: 'asc' }],
    });
    const data = {
      items: items.map((b) => ({
        id: b.id,
        slug: b.slug,
        name: b.name,
      })),
    };
    this.publicBrandsCache = {
      data,
      expiresAt: now + BRAND_CACHE_TTL_MS,
    };
    return data;
  }

  async listAdminBrands(query: PaginationQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 50;

    const [items, total] = await Promise.all([
      this.prisma.brand.findMany({
        orderBy: [{ name: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.brand.count(),
    ]);

    return { items, page, pageSize, total };
  }

  async createBrand(dto: CreateBrandDto, actorId: string) {
    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const brand = await tx.brand.create({
          data: {
            name: dto.name.trim(),
            slug: dto.slug.trim().toLowerCase(),
            isActive: dto.isActive ?? true,
          },
        });
        await writeAuditLog(tx, {
          actorId,
          action: 'BRAND_CREATED',
          targetType: 'BRAND',
          targetId: brand.id,
          metadata: { slug: brand.slug },
        });
        return brand;
      });
      this.invalidateBrandCache();
      return created;
    } catch (err: unknown) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException({
          code: 'VALIDATION_ERROR',
          message: 'Slug thương hiệu đã tồn tại.',
          details: { fields: { slug: 'Slug đã được sử dụng' } },
        });
      }
      throw err;
    }
  }

  async updateBrand(id: string, dto: UpdateBrandDto, actorId: string) {
    const existing = await this.prisma.brand.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Không tìm thấy thương hiệu.',
        details: {},
      });
    }

    try {
      const updated = await this.prisma.$transaction(async (tx) => {
        const updated = await tx.brand.update({
          where: { id },
          data: {
            name: dto.name?.trim(),
            slug: dto.slug?.trim().toLowerCase(),
            isActive: dto.isActive,
          },
        });
        await writeAuditLog(tx, {
          actorId,
          action: 'BRAND_UPDATED',
          targetType: 'BRAND',
          targetId: id,
          metadata: { slug: updated.slug },
        });
        return updated;
      });
      this.invalidateBrandCache();
      return updated;
    } catch (err: unknown) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException({
          code: 'VALIDATION_ERROR',
          message: 'Slug thương hiệu đã tồn tại.',
          details: { fields: { slug: 'Slug đã được sử dụng' } },
        });
      }
      throw err;
    }
  }

  async deleteBrand(id: string, actorId: string) {
    const existing = await this.prisma.brand.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Không tìm thấy thương hiệu.',
        details: {},
      });
    }

    const modelsCount = await this.prisma.rentalModel.count({
      where: { brandId: id },
    });
    if (modelsCount > 0) {
      await this.prisma.brand.update({
        where: { id },
        data: { isActive: false },
      });
      this.invalidateBrandCache();
      return { success: true, message: 'Hãng có mẫu máy nên đã chuyển sang ẩn (isActive = false).' };
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.brand.delete({ where: { id } });
      await writeAuditLog(tx, {
        actorId,
        action: 'BRAND_DELETED',
        targetType: 'BRAND',
        targetId: id,
        metadata: { slug: existing.slug },
      });
    });
    this.invalidateBrandCache();
    return { success: true };
  }
}

