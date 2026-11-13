import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { writeAuditLog } from '../../../common/utils/audit.util';
import { PrismaService } from '../../../infra/database/prisma.service';
import {
  CreateBranchDto,
  PaginationQueryDto,
  UpdateBranchDto,
} from '../dto/catalog.dto';

@Injectable()
export class BranchService {
  constructor(private readonly prisma: PrismaService) {}

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

  async findActiveBranchBySlug(slug: string) {
    return this.prisma.branch.findFirst({
      where: { slug, isActive: true },
    });
  }

  async listAdminBranches(query: PaginationQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    const [items, total] = await Promise.all([
      this.prisma.branch.findMany({
        orderBy: [{ name: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.branch.count(),
    ]);

    return { items, page, pageSize, total };
  }

  async createBranch(dto: CreateBranchDto, actorId: string) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const branch = await tx.branch.create({
          data: {
            name: dto.name.trim(),
            slug: dto.slug.trim().toLowerCase(),
            address: dto.address.trim(),
            phone: dto.phone.trim(),
            openHours: dto.openHours.trim(),
            mapUrl: dto.mapUrl?.trim() || null,
            isActive: dto.isActive ?? true,
          },
        });
        await writeAuditLog(tx, {
          actorId,
          action: 'BRANCH_CREATED',
          targetType: 'BRANCH',
          targetId: branch.id,
          metadata: { slug: branch.slug },
        });
        return branch;
      });
    } catch (err: unknown) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException({
          code: 'VALIDATION_ERROR',
          message: 'Slug chi nhánh đã tồn tại.',
          details: { fields: { slug: 'Slug đã được sử dụng' } },
        });
      }
      throw err;
    }
  }

  async updateBranch(id: string, dto: UpdateBranchDto, actorId: string) {
    const existing = await this.prisma.branch.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Không tìm thấy chi nhánh.',
        details: {},
      });
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const updated = await tx.branch.update({
          where: { id },
          data: {
            name: dto.name?.trim(),
            slug: dto.slug?.trim().toLowerCase(),
            address: dto.address?.trim(),
            phone: dto.phone?.trim(),
            openHours: dto.openHours?.trim(),
            mapUrl: dto.mapUrl !== undefined ? dto.mapUrl?.trim() || null : undefined,
            isActive: dto.isActive,
          },
        });
        await writeAuditLog(tx, {
          actorId,
          action: 'BRANCH_UPDATED',
          targetType: 'BRANCH',
          targetId: id,
          metadata: { slug: updated.slug },
        });
        return updated;
      });
    } catch (err: unknown) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException({
          code: 'VALIDATION_ERROR',
          message: 'Slug chi nhánh đã tồn tại.',
          details: { fields: { slug: 'Slug đã được sử dụng' } },
        });
      }
      throw err;
    }
  }

  async deleteBranch(id: string, actorId: string) {
    const existing = await this.prisma.branch.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Không tìm thấy chi nhánh.',
        details: {},
      });
    }

    const unitsCount = await this.prisma.rentalUnit.count({
      where: { branchId: id },
    });
    if (unitsCount > 0) {
      await this.prisma.branch.update({
        where: { id },
        data: { isActive: false },
      });
      return { success: true, message: 'Chi nhánh có máy nên đã chuyển sang ẩn (isActive = false).' };
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.branch.delete({ where: { id } });
      await writeAuditLog(tx, {
        actorId,
        action: 'BRANCH_DELETED',
        targetType: 'BRANCH',
        targetId: id,
        metadata: { slug: existing.slug },
      });
    });
    return { success: true };
  }
}

