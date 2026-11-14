import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, UnitStatus } from '@prisma/client';
import { writeAuditLog } from '../../common/utils/audit.util';
import {
  formatUtcDateToIso,
  getMonthRange,
  parseIsoDateToUtc,
} from '../../common/utils/date.util';
import { PrismaService } from '../../infra/database/prisma.service';
import {
  CreateUnitBlockDto,
  CreateUnitDto,
  ListUnitBlocksQueryDto,
  ListUnitsQueryDto,
  UpdateUnitDto,
} from './dto/unit.dto';

@Injectable()
export class InventoryService {
  private unitsCacheVersion = 0;

  constructor(private readonly prisma: PrismaService) {}

  public getUnitsCacheVersion(): number {
    return this.unitsCacheVersion;
  }

  public bumpUnitsCacheVersion(): void {
    this.unitsCacheVersion += 1;
  }

  async getAvailableBranchSlugsByModel(params: {
    modelIds: string[];
    branchSlug?: string;
    startDate: string;
    endDate: string;
  }): Promise<Map<string, string[]>> {
    const result = new Map<string, string[]>();
    if (params.modelIds.length === 0) {
      return result;
    }

    const start = parseIsoDateToUtc(params.startDate);
    const end = parseIsoDateToUtc(params.endDate);
    if (end <= start) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Ngày trả phải sau ngày nhận.',
        details: {},
      });
    }

    const branchFilterSql = params.branchSlug
      ? Prisma.sql`AND b.slug = ${params.branchSlug}`
      : Prisma.empty;

    const rows = await this.prisma.$queryRaw<
      Array<{ model_id: string; branch_slug: string }>
    >(Prisma.sql`
      SELECT DISTINCT ru.model_id, b.slug AS branch_slug
      FROM rental_units ru
      INNER JOIN branches b ON b.id = ru.branch_id
      WHERE ru.model_id IN (${Prisma.join(params.modelIds)})
        AND ru.status = 'AVAILABLE'::"UnitStatus"
        AND b.is_active = true
        ${branchFilterSql}
        AND NOT EXISTS (
          SELECT 1 FROM unit_blocks ub
          WHERE ub.unit_id = ru.id
            AND ub.during && daterange(${params.startDate}::date, ${params.endDate}::date, '[)')
        )
        AND NOT EXISTS (
          SELECT 1 FROM booking_units bu
          WHERE bu.unit_id = ru.id
            AND bu.active = true
            AND bu.during && daterange(${params.startDate}::date, ${params.endDate}::date, '[)')
        )
      ORDER BY b.slug ASC
    `);

    for (const row of rows) {
      const existing = result.get(row.model_id) ?? [];
      existing.push(row.branch_slug);
      result.set(row.model_id, existing);
    }

    return result;
  }

  async getActiveUnitBranchSlugsForModel(modelId: string): Promise<string[]> {
    const rows = await this.prisma.rentalUnit.findMany({
      where: {
        modelId,
        status: UnitStatus.AVAILABLE,
        branch: { isActive: true },
      },
      select: { branch: { select: { slug: true } } },
      distinct: ['branchId'],
    });
    return rows.map((r) => r.branch.slug).sort();
  }

  async getUnavailableDatesForModel(params: {
    modelId: string;
    branchId?: string;
    branchSlug?: string;
    month: string;
  }): Promise<string[]> {
    const { startDate, endExclusiveDate, daysInMonth, year, month } =
      getMonthRange(params.month);

    const unitFilter: Prisma.RentalUnitWhereInput = {
      modelId: params.modelId,
      status: UnitStatus.AVAILABLE,
      ...(params.branchId
        ? { branchId: params.branchId }
        : { branch: { slug: params.branchSlug, isActive: true } }),
    };

    const [units, blocks, bookingUnits] = await Promise.all([
      this.prisma.rentalUnit.findMany({
        where: unitFilter,
        select: { id: true },
      }),
      this.prisma.unitBlock.findMany({
        where: {
          unit: unitFilter,
          startDate: { lt: endExclusiveDate },
          endDate: { gt: startDate },
        },
        select: { unitId: true, startDate: true, endDate: true },
      }),
      this.prisma.bookingUnit.findMany({
        where: {
          unit: unitFilter,
          active: true,
          startDate: { lt: endExclusiveDate },
          endDate: { gt: startDate },
        },
        select: { unitId: true, startDate: true, endDate: true },
      }),
    ]);

    if (units.length === 0) {
      const allDates: string[] = [];
      for (let day = 1; day <= daysInMonth; day++) {
        allDates.push(
          `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
        );
      }
      return allDates;
    }

    const unitIds = units.map((u) => u.id);

    const busyByUnit = new Map<
      string,
      Array<{ startMs: number; endMs: number }>
    >();
    for (const unitId of unitIds) {
      busyByUnit.set(unitId, []);
    }
    for (const b of [...blocks, ...bookingUnits]) {
      const list = busyByUnit.get(b.unitId);
      if (list) {
        list.push({
          startMs: b.startDate.getTime(),
          endMs: b.endDate.getTime(),
        });
      }
    }

    const unavailableDates: string[] = [];
    for (let day = 1; day <= daysInMonth; day++) {
      const dayStartMs = Date.UTC(year, month - 1, day);
      const dayEndMs = Date.UTC(year, month - 1, day + 1);

      const hasFreeUnit = unitIds.some((unitId) => {
        const intervals = busyByUnit.get(unitId) ?? [];
        return !intervals.some(
          (iv) => iv.startMs < dayEndMs && iv.endMs > dayStartMs,
        );
      });

      if (!hasFreeUnit) {
        unavailableDates.push(
          `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
        );
      }
    }

    return unavailableDates;
  }

  async findAndLockAvailableUnit(
    tx: Prisma.TransactionClient,
    params: {
      modelId: string;
      branchId: string;
      startDate: string;
      endDate: string;
      excludeUnitIds: string[];
    },
  ): Promise<{ id: string; serialNumber: string } | null> {
    const excludeSql =
      params.excludeUnitIds.length > 0
        ? Prisma.sql`AND ru.id NOT IN (${Prisma.join(params.excludeUnitIds)})`
        : Prisma.empty;

    const rows = await tx.$queryRaw<
      Array<{ id: string; serial_number: string }>
    >(Prisma.sql`
      SELECT ru.id, ru.serial_number
      FROM rental_units ru
      WHERE ru.model_id = ${params.modelId}
        AND ru.branch_id = ${params.branchId}
        AND ru.status = 'AVAILABLE'::"UnitStatus"
        ${excludeSql}
        AND NOT EXISTS (
          SELECT 1 FROM unit_blocks ub
          WHERE ub.unit_id = ru.id
            AND ub.during && daterange(${params.startDate}::date, ${params.endDate}::date, '[)')
        )
        AND NOT EXISTS (
          SELECT 1 FROM booking_units bu
          WHERE bu.unit_id = ru.id
            AND bu.active = true
            AND bu.during && daterange(${params.startDate}::date, ${params.endDate}::date, '[)')
        )
      ORDER BY ru.id ASC
      FOR UPDATE OF ru
      LIMIT 1
    `);

    if (rows.length === 0) {
      return null;
    }
    return { id: rows[0].id, serialNumber: rows[0].serial_number };
  }

  async countAvailableUnitsForModel(params: {
    modelId: string;
    branchId: string;
    startDate: string;
    endDate: string;
  }): Promise<number> {
    const rows = await this.prisma.$queryRaw<Array<{ count: bigint }>>(
      Prisma.sql`
        SELECT COUNT(*)::bigint AS count
        FROM rental_units ru
        WHERE ru.model_id = ${params.modelId}
          AND ru.branch_id = ${params.branchId}
          AND ru.status = 'AVAILABLE'::"UnitStatus"
          AND NOT EXISTS (
            SELECT 1 FROM unit_blocks ub
            WHERE ub.unit_id = ru.id
              AND ub.during && daterange(${params.startDate}::date, ${params.endDate}::date, '[)')
          )
          AND NOT EXISTS (
            SELECT 1 FROM booking_units bu
            WHERE bu.unit_id = ru.id
              AND bu.active = true
              AND bu.during && daterange(${params.startDate}::date, ${params.endDate}::date, '[)')
          )
      `,
    );
    return Number(rows[0]?.count ?? 0);
  }

  async countAvailableUnitsForModels(params: {
    modelIds: string[];
    branchId: string;
    startDate: string;
    endDate: string;
  }): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    if (params.modelIds.length === 0) {
      return counts;
    }

    const rows = await this.prisma.$queryRaw<
      Array<{ model_id: string; count: bigint }>
    >(
      Prisma.sql`
        SELECT ru.model_id, COUNT(*)::bigint AS count
        FROM rental_units ru
        WHERE ru.model_id IN (${Prisma.join(params.modelIds)})
          AND ru.branch_id = ${params.branchId}
          AND ru.status = 'AVAILABLE'::"UnitStatus"
          AND NOT EXISTS (
            SELECT 1 FROM unit_blocks ub
            WHERE ub.unit_id = ru.id
              AND ub.during && daterange(${params.startDate}::date, ${params.endDate}::date, '[)')
          )
          AND NOT EXISTS (
            SELECT 1 FROM booking_units bu
            WHERE bu.unit_id = ru.id
              AND bu.active = true
              AND bu.during && daterange(${params.startDate}::date, ${params.endDate}::date, '[)')
          )
        GROUP BY ru.model_id
      `,
    );

    for (const row of rows) {
      counts.set(row.model_id, Number(row.count));
    }
    return counts;
  }

  async listStaffUnits(query: ListUnitsQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    const where: Prisma.RentalUnitWhereInput = {};
    if (query.branch) {
      where.branch = { slug: query.branch };
    }
    if (query.model) {
      where.modelId = query.model;
    }
    if (query.status) {
      where.status = query.status;
    }
    if (query.q?.trim()) {
      const q = query.q.trim();
      where.OR = [
        { serialNumber: { contains: q, mode: 'insensitive' } },
        { model: { name: { contains: q, mode: 'insensitive' } } },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.rentalUnit.findMany({
        where,
        include: {
          model: { select: { id: true, name: true } },
          branch: { select: { slug: true, name: true } },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.rentalUnit.count({ where }),
    ]);

    return {
      items: items.map((u) => ({
        id: u.id,
        serialNumber: u.serialNumber,
        model: u.model,
        branch: u.branch,
        condition: u.condition,
        status: u.status,
        notes: u.notes,
        purchasedAt: u.purchasedAt ? u.purchasedAt.toISOString() : null,
      })),
      page,
      pageSize,
      total,
    };
  }

  async listUnitBlocks(query: ListUnitBlocksQueryDto) {
    const where: Prisma.UnitBlockWhereInput = {};
    if (query.unitId) {
      where.unitId = query.unitId;
    }
    if (query.from) {
      where.endDate = { gt: parseIsoDateToUtc(query.from) };
    }
    if (query.to) {
      where.startDate = { lt: parseIsoDateToUtc(query.to) };
    }

    const items = await this.prisma.unitBlock.findMany({
      where,
      orderBy: [{ startDate: 'asc' }, { id: 'asc' }],
    });

    return {
      items: items.map((b) => ({
        id: b.id,
        unitId: b.unitId,
        startDate: formatUtcDateToIso(b.startDate),
        endDate: formatUtcDateToIso(b.endDate),
        reason: b.reason,
      })),
    };
  }

  async createUnitBlock(dto: CreateUnitBlockDto, actorId: string) {
    const start = parseIsoDateToUtc(dto.startDate);
    const end = parseIsoDateToUtc(dto.endDate);
    if (end <= start) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Ngày kết thúc khóa phải sau ngày bắt đầu.',
        details: { fields: { endDate: 'Ngày kết thúc phải sau ngày bắt đầu' } },
      });
    }

    const block = await this.prisma.$transaction(async (tx) => {
      const lockedUnits = await tx.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`SELECT id FROM rental_units WHERE id = ${dto.unitId} FOR UPDATE`,
      );
      if (lockedUnits.length === 0) {
        throw new NotFoundException({
          code: 'NOT_FOUND',
          message: 'Không tìm thấy chiếc máy.',
          details: {},
        });
      }

      const conflictingBookings = await tx.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`
          SELECT id
          FROM booking_units
          WHERE unit_id = ${dto.unitId}
            AND active = true
            AND during && daterange(${dto.startDate}::date, ${dto.endDate}::date, '[)')
          LIMIT 1
        `,
      );

      if (conflictingBookings.length > 0) {
        throw new ConflictException({
          code: 'BOOKING_DATE_UNAVAILABLE',
          message: 'Khóa bảo trì trùng với đơn đang hoạt động.',
          details: {},
        });
      }

      const created = await tx.unitBlock.create({
        data: {
          unitId: dto.unitId,
          startDate: start,
          endDate: end,
          reason: dto.reason.trim(),
          createdBy: actorId,
        },
      });

      await writeAuditLog(tx, {
        actorId,
        action: 'UNIT_BLOCK_CREATED',
        targetType: 'UNIT_BLOCK',
        targetId: created.id,
        metadata: {
          unitId: dto.unitId,
          startDate: dto.startDate,
          endDate: dto.endDate,
          reason: created.reason,
        },
      });

      return created;
    });

    return {
      id: block.id,
      unitId: block.unitId,
      startDate: formatUtcDateToIso(block.startDate),
      endDate: formatUtcDateToIso(block.endDate),
      reason: block.reason,
    };
  }

  async deleteUnitBlock(id: string, actorId: string): Promise<void> {
    const existing = await this.prisma.unitBlock.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Không tìm thấy lịch khóa bảo trì.',
        details: {},
      });
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.unitBlock.delete({ where: { id } });
      await writeAuditLog(tx, {
        actorId,
        action: 'UNIT_BLOCK_DELETED',
        targetType: 'UNIT_BLOCK',
        targetId: id,
        metadata: { unitId: existing.unitId },
      });
    });
  }

  async getAdminUnit(id: string) {
    const unit = await this.prisma.rentalUnit.findUnique({
      where: { id },
      include: {
        model: { select: { id: true, name: true, slug: true } },
        branch: { select: { id: true, slug: true, name: true } },
      },
    });
    if (!unit) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Không tìm thấy chiếc máy.',
        details: {},
      });
    }
    return {
      id: unit.id,
      modelId: unit.modelId,
      branchId: unit.branchId,
      serialNumber: unit.serialNumber,
      condition: unit.condition,
      status: unit.status,
      notes: unit.notes,
      purchasedAt: unit.purchasedAt ? unit.purchasedAt.toISOString() : null,
      model: unit.model,
      branch: unit.branch,
      createdAt: unit.createdAt.toISOString(),
      updatedAt: unit.updatedAt.toISOString(),
    };
  }

  async createAdminUnit(dto: CreateUnitDto, actorId: string) {
    const [model, branch] = await Promise.all([
      this.prisma.rentalModel.findUnique({ where: { id: dto.modelId } }),
      this.prisma.branch.findUnique({ where: { id: dto.branchId } }),
    ]);

    if (!model) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Mẫu máy không tồn tại.',
        details: { fields: { modelId: 'Mẫu máy không tồn tại' } },
      });
    }
    if (!branch) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Chi nhánh không tồn tại.',
        details: { fields: { branchId: 'Chi nhánh không tồn tại' } },
      });
    }

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const unit = await tx.rentalUnit.create({
          data: {
            modelId: dto.modelId,
            branchId: dto.branchId,
            serialNumber: dto.serialNumber.trim(),
            condition: dto.condition,
            status: dto.status,
            notes: dto.notes ?? null,
            purchasedAt: dto.purchasedAt ? new Date(dto.purchasedAt) : null,
          },
        });
        await writeAuditLog(tx, {
          actorId,
          action: 'UNIT_CREATED',
          targetType: 'RENTAL_UNIT',
          targetId: unit.id,
          metadata: { serialNumber: unit.serialNumber },
        });
        return unit;
      });
      this.bumpUnitsCacheVersion();
      return this.getAdminUnit(created.id);
    } catch (err: unknown) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException({
          code: 'VALIDATION_ERROR',
          message: 'Số serial đã tồn tại trong kho.',
          details: { fields: { serialNumber: 'Số serial đã tồn tại' } },
        });
      }
      throw err;
    }
  }

  async updateAdminUnit(id: string, dto: UpdateUnitDto, actorId: string) {
    const existing = await this.prisma.rentalUnit.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Không tìm thấy chiếc máy.',
        details: {},
      });
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.rentalUnit.update({
          where: { id },
          data: {
            modelId: dto.modelId,
            branchId: dto.branchId,
            serialNumber: dto.serialNumber?.trim(),
            condition: dto.condition,
            status: dto.status,
            notes: dto.notes,
            purchasedAt:
              dto.purchasedAt === undefined
                ? undefined
                : dto.purchasedAt === null
                  ? null
                  : new Date(dto.purchasedAt),
          },
        });
        await writeAuditLog(tx, {
          actorId,
          action: 'UNIT_UPDATED',
          targetType: 'RENTAL_UNIT',
          targetId: id,
          metadata: dto as unknown as Prisma.InputJsonValue,
        });
      });
      this.bumpUnitsCacheVersion();
      return this.getAdminUnit(id);
    } catch (err: unknown) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException({
          code: 'VALIDATION_ERROR',
          message: 'Số serial đã tồn tại trong kho.',
          details: { fields: { serialNumber: 'Số serial đã tồn tại' } },
        });
      }
      throw err;
    }
  }

  async deleteAdminUnit(id: string, actorId: string) {
    const existing = await this.prisma.rentalUnit.findUnique({
      where: { id },
      include: { _count: { select: { bookingUnits: true } } },
    });
    if (!existing) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Không tìm thấy chiếc máy.',
        details: {},
      });
    }

    if (existing._count.bookingUnits > 0) {
      await this.prisma.$transaction(async (tx) => {
        await tx.rentalUnit.update({
          where: { id },
          data: { status: UnitStatus.RETIRED },
        });
        await writeAuditLog(tx, {
          actorId,
          action: 'UNIT_RETIRED',
          targetType: 'RENTAL_UNIT',
          targetId: id,
          metadata: { reason: 'Unit has booking history' },
        });
      });
      this.bumpUnitsCacheVersion();
      return { id, status: UnitStatus.RETIRED, retired: true };
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.rentalUnit.delete({ where: { id } });
      await writeAuditLog(tx, {
        actorId,
        action: 'UNIT_DELETED',
        targetType: 'RENTAL_UNIT',
        targetId: id,
      });
    });
    this.bumpUnitsCacheVersion();
    return { id, deleted: true };
  }
}
