import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { writeAuditLog } from '../../../common/utils/audit.util';
import { PrismaService } from '../../../infra/database/prisma.service';
import {
  CreateCategoryDto,
  PaginationQueryDto,
  UpdateCategoryDto,
} from '../dto/catalog.dto';

interface CategoryTreeNode {
  id: string;
  slug: string;
  name: string;
  parentId: string | null;
  sortOrder: number;
  children: CategoryTreeNode[];
}

const CATEGORY_CACHE_TTL_MS = 5 * 60 * 1000;

@Injectable()
export class CategoryService {
  private publicCategoriesCache: {
    data: { items: Array<{ id: string; slug: string; name: string; children: unknown[] }> };
    expiresAt: number;
  } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  public invalidateCategoryCache(): void {
    this.publicCategoriesCache = null;
  }

  async getPublicCategories() {
    const now = Date.now();
    if (
      this.publicCategoriesCache &&
      now < this.publicCategoriesCache.expiresAt
    ) {
      return this.publicCategoriesCache.data;
    }

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

    const data = { items: roots.map(stripMeta) };
    this.publicCategoriesCache = {
      data,
      expiresAt: now + CATEGORY_CACHE_TTL_MS,
    };
    return data;
  }

  async listAdminCategories(query: PaginationQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 50;

    const [items, total] = await Promise.all([
      this.prisma.category.findMany({
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.category.count(),
    ]);

    return { items, page, pageSize, total };
  }

  async createCategory(dto: CreateCategoryDto, actorId: string) {
    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const cat = await tx.category.create({
          data: {
            name: dto.name.trim(),
            slug: dto.slug.trim().toLowerCase(),
            parentId: dto.parentId || null,
            sortOrder: dto.sortOrder ?? 0,
            isActive: dto.isActive ?? true,
          },
        });
        await writeAuditLog(tx, {
          actorId,
          action: 'CATEGORY_CREATED',
          targetType: 'CATEGORY',
          targetId: cat.id,
          metadata: { slug: cat.slug },
        });
        return cat;
      });
      this.invalidateCategoryCache();
      return created;
    } catch (err: unknown) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException({
          code: 'VALIDATION_ERROR',
          message: 'Slug danh mục đã tồn tại.',
          details: { fields: { slug: 'Slug đã được sử dụng' } },
        });
      }
      throw err;
    }
  }

  async updateCategory(id: string, dto: UpdateCategoryDto, actorId: string) {
    const existing = await this.prisma.category.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Không tìm thấy danh mục.',
        details: {},
      });
    }

    try {
      const updated = await this.prisma.$transaction(async (tx) => {
        const updated = await tx.category.update({
          where: { id },
          data: {
            name: dto.name?.trim(),
            slug: dto.slug?.trim().toLowerCase(),
            parentId: dto.parentId !== undefined ? dto.parentId || null : undefined,
            sortOrder: dto.sortOrder,
            isActive: dto.isActive,
          },
        });
        await writeAuditLog(tx, {
          actorId,
          action: 'CATEGORY_UPDATED',
          targetType: 'CATEGORY',
          targetId: id,
          metadata: { slug: updated.slug },
        });
        return updated;
      });
      this.invalidateCategoryCache();
      return updated;
    } catch (err: unknown) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException({
          code: 'VALIDATION_ERROR',
          message: 'Slug danh mục đã tồn tại.',
          details: { fields: { slug: 'Slug đã được sử dụng' } },
        });
      }
      throw err;
    }
  }

  async deleteCategory(id: string, actorId: string) {
    const existing = await this.prisma.category.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Không tìm thấy danh mục.',
        details: {},
      });
    }

    const modelsCount = await this.prisma.rentalModel.count({
      where: { categoryId: id },
    });
    if (modelsCount > 0) {
      await this.prisma.category.update({
        where: { id },
        data: { isActive: false },
      });
      this.invalidateCategoryCache();
      return { success: true, message: 'Danh mục có mẫu máy nên đã chuyển sang ẩn (isActive = false).' };
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.category.delete({ where: { id } });
      await writeAuditLog(tx, {
        actorId,
        action: 'CATEGORY_DELETED',
        targetType: 'CATEGORY',
        targetId: id,
        metadata: { slug: existing.slug },
      });
    });
    this.invalidateCategoryCache();
    return { success: true };
  }
}

