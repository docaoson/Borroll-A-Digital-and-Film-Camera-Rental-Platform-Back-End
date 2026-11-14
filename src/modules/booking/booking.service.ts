import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { BookingStatus, Prisma, Role } from '@prisma/client';
import * as crypto from 'crypto';
import { writeAuditLog } from '../../common/utils/audit.util';
import {
  formatUtcDateToIso,
  getTodayVietnamIso,
} from '../../common/utils/date.util';
import { PrismaService } from '../../infra/database/prisma.service';
import {
  STORAGE_SERVICE,
  StorageService,
} from '../../infra/storage/storage.service';
import { InventoryService } from '../inventory';
import {
  assertValidBookingTransition,
  computeViewerContext,
} from './booking.state-machine';
import {
  CancelBookingDto,
  CreateBookingDto,
  ListMyBookingsQueryDto,
  QuoteBookingDto,
} from './dto/booking.dto';
import { PricingService } from './pricing.service';

export const BOOKING_INCLUDE_SUMMARY = {
  branch: {
    select: { id: true, slug: true, name: true, address: true, phone: true },
  },
  user: {
    select: { id: true, fullName: true, email: true, phone: true },
  },
  units: {
    include: {
      unit: { select: { serialNumber: true } },
      model: {
        select: {
          id: true,
          name: true,
          kind: true,
          images: {
            where: { kind: 'PRODUCT' as const },
            orderBy: [{ sortOrder: 'asc' as const }, { id: 'asc' as const }],
            take: 1,
          },
        },
      },
    },
    orderBy: [{ id: 'asc' as const }],
  },
  addons: {
    include: {
      filmProduct: { select: { id: true, name: true } },
    },
  },
  manualPayment: {
    include: {
      proofs: { orderBy: [{ submittedAt: 'desc' as const }], take: 1 },
    },
  },
} satisfies Prisma.BookingInclude;

export const BOOKING_INCLUDE_DETAIL = {
  ...BOOKING_INCLUDE_SUMMARY,
  manualPayment: {
    include: { proofs: { orderBy: [{ submittedAt: 'asc' as const }] } },
  },
  handovers: {
    orderBy: [{ createdAt: 'asc' as const }],
  },
  payments: {
    orderBy: [{ createdAt: 'asc' as const }],
  },
} satisfies Prisma.BookingInclude;

export type BookingWithSummary = Prisma.BookingGetPayload<{
  include: typeof BOOKING_INCLUDE_SUMMARY;
}>;

export type BookingWithDetail = Prisma.BookingGetPayload<{
  include: typeof BOOKING_INCLUDE_DETAIL;
}>;

interface IdempotencyRecord {
  status: 'IN_FLIGHT' | 'COMPLETED';
  promise?: Promise<any>;
  response?: any;
  createdAt: number;
}

@Injectable()
export class BookingService {
  private readonly logger = new Logger(BookingService.name);
  private readonly idempotencyMap = new Map<string, IdempotencyRecord>();
  private readonly IDEMPOTENCY_TTL_MS = 15 * 60 * 1000; // 15 phút

  private cleanExpiredIdempotencyKeys() {
    const now = Date.now();
    if (this.idempotencyMap.size > 100) {
      for (const [key, entry] of this.idempotencyMap.entries()) {
        if (now - entry.createdAt > this.IDEMPOTENCY_TTL_MS) {
          this.idempotencyMap.delete(key);
        }
      }
    }
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly eventEmitter: EventEmitter2,
    private readonly pricingService: PricingService,
    private readonly inventoryService: InventoryService,
    @Inject(STORAGE_SERVICE)
    private readonly storageService: StorageService,
  ) {}

  private getHandoverBucket(): string {
    return this.configService.get<string>(
      'STORAGE_BUCKET_HANDOVER',
      'handover-photos',
    );
  }

  private getRentalImagesBucket(): string {
    return this.configService.get<string>(
      'STORAGE_BUCKET_RENTAL_IMAGES',
      'rental-images',
    );
  }

  isBookingOverdue(
    status: BookingStatus,
    endDate: Date,
    todayIso = getTodayVietnamIso(),
  ): boolean {
    return (
      status === BookingStatus.PICKED_UP &&
      formatUtcDateToIso(endDate) < todayIso
    );
  }

  private generateBookingCode(): string {
    const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
    const bytes = crypto.randomBytes(5);
    let code = 'BR-';
    for (let i = 0; i < 5; i++) {
      code += alphabet[bytes[i] % alphabet.length];
    }
    return code;
  }

  private isExclusionConstraintError(err: unknown): boolean {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      const metaCode = err.meta?.code;
      if (metaCode === '23P01') return true;
      if (typeof err.message === 'string' && err.message.includes('23P01')) {
        return true;
      }
      if (
        typeof err.message === 'string' &&
        err.message.includes('booking_units_no_overlap')
      ) {
        return true;
      }
    }
    return false;
  }

  formatBookingSummary(
    booking: BookingWithSummary | BookingWithDetail,
    viewerRoles: string[],
  ) {
    const { viewerRole, allowedActions } = computeViewerContext(
      booking.status,
      viewerRoles,
    );
    const isStaff =
      viewerRoles.includes(Role.STAFF) || viewerRoles.includes(Role.ADMIN);

    const summary: Record<string, unknown> = {
      id: booking.id,
      code: booking.code,
      status: booking.status,
      isOverdue: this.isBookingOverdue(booking.status, booking.endDate),
      branch: booking.branch,
      startDate: formatUtcDateToIso(booking.startDate),
      endDate: formatUtcDateToIso(booking.endDate),
      days: booking.days,
      items: booking.units.map((bu) => ({
        modelId: bu.modelId,
        name: bu.model.name,
        kind: bu.model.kind,
        thumbnailUrl: bu.model.images[0]
          ? this.storageService.getPublicUrl(
              this.getRentalImagesBucket(),
              bu.model.images[0].path,
            )
          : null,
        pricePerDay: bu.pricePerDay,
        rentalAmount: bu.rentalAmount,
        depositAmount: bu.depositAmount,
      })),
      addons: booking.addons.map((addon) => ({
        name: addon.filmProduct.name,
        quantity: addon.quantity,
        unitPrice: addon.unitPrice,
        amount: addon.unitPrice * addon.quantity,
      })),
      rentalAmount: booking.rentalAmount,
      addonsAmount: booking.addonsAmount,
      depositAmount: booking.depositAmount,
      totalDueAtPickup: booking.totalAmount,
      payment: booking.manualPayment
        ? {
            id: booking.manualPayment.id,
            amount: booking.manualPayment.amount,
            status: booking.manualPayment.status,
            rejectionReason:
              booking.manualPayment.proofs[0]?.rejectionReason ?? null,
          }
        : {
            amount: booking.totalAmount,
            status: 'UNPAID',
            rejectionReason: null,
          },
      contactName: booking.contactName,
      contactPhone: booking.contactPhone,
      note: booking.note,
      createdAt: booking.createdAt.toISOString(),
      expiresAt: booking.expiresAt.toISOString(),
      confirmedAt: booking.confirmedAt
        ? booking.confirmedAt.toISOString()
        : null,
      pickedUpAt: booking.pickedUpAt ? booking.pickedUpAt.toISOString() : null,
      returnedAt: booking.returnedAt ? booking.returnedAt.toISOString() : null,
      completedAt: booking.completedAt
        ? booking.completedAt.toISOString()
        : null,
      rejectedReason: booking.rejectedReason,
      cancelledReason: booking.cancelledReason,
      viewerRole,
      allowedActions,
    };

    if (isStaff) {
      summary.customer = booking.user;
      summary.units = booking.units.map((bu) => ({
        modelId: bu.modelId,
        serialNumber: bu.unit.serialNumber,
      }));
    }

    return summary;
  }

  async formatBookingDetail(booking: BookingWithDetail, viewerRoles: string[]) {
    const base = this.formatBookingSummary(booking, viewerRoles);
    const isStaff =
      viewerRoles.includes(Role.STAFF) || viewerRoles.includes(Role.ADMIN);
    const handoverBucket = this.getHandoverBucket();

    const handovers = await Promise.all(
      booking.handovers.map(async (h) => {
        const photoUrls = await Promise.all(
          h.photoPaths.map((p) =>
            this.storageService.createSignedUrl(handoverBucket, p, 300),
          ),
        );
        return {
          kind: h.kind,
          checklist: h.checklist,
          conditionNotes: h.conditionNotes,
          photoUrls,
          idChecked: h.idChecked,
          createdAt: h.createdAt.toISOString(),
        };
      }),
    );

    const payments = booking.payments.map((p) => {
      const entry: Record<string, unknown> = {
        type: p.type,
        amount: p.amount,
        method: p.method,
        note: p.note,
        createdAt: p.createdAt.toISOString(),
      };
      if (isStaff) {
        entry.recordedBy = p.recordedBy;
      }
      return entry;
    });

    const manualPayment = booking.manualPayment
      ? {
          id: booking.manualPayment.id,
          amount: booking.manualPayment.amount,
          status: booking.manualPayment.status,
          proofs: await Promise.all(
            booking.manualPayment.proofs.map(async (proof) => ({
              id: proof.id,
              status: proof.status,
              submittedAt: proof.submittedAt.toISOString(),
              reviewedAt: proof.reviewedAt?.toISOString() ?? null,
              reviewedBy: isStaff ? proof.reviewedBy : undefined,
              rejectionReason: proof.rejectionReason,
              imageUrl: await this.storageService.createSignedUrl(
                this.configService.get<string>(
                  'STORAGE_BUCKET_PAYMENT_PROOFS',
                  'payment-proofs',
                ),
                proof.path,
                300,
              ),
            })),
          ),
        }
      : { amount: booking.totalAmount, status: 'UNPAID', proofs: [] };

    return {
      ...base,
      payments,
      payment: manualPayment,
      handovers,
      setupPlan: null,
    };
  }

  async quote(dto: QuoteBookingDto) {
    const calculated = await this.pricingService.calculateQuote(dto);

    const requestedCounts = new Map<string, number>();
    for (const line of calculated.lines) {
      requestedCounts.set(
        line.modelId,
        (requestedCounts.get(line.modelId) ?? 0) + 1,
      );
    }

    const availableCountsMap =
      await this.inventoryService.countAvailableUnitsForModels({
        modelIds: Array.from(requestedCounts.keys()),
        branchId: calculated.branch.id,
        startDate: dto.startDate,
        endDate: dto.endDate,
      });

    const unavailableModelIds: string[] = [];
    for (const [modelId, neededCount] of requestedCounts.entries()) {
      const availableCount = availableCountsMap.get(modelId) ?? 0;
      if (availableCount < neededCount) {
        unavailableModelIds.push(modelId);
      }
    }

    return {
      days: calculated.days,
      available: unavailableModelIds.length === 0,
      unavailableModelIds,
      lines: calculated.lines.map((l) => ({
        modelId: l.modelId,
        name: l.name,
        pricePerDay: l.pricePerDay,
        rentalAmount: l.rentalAmount,
        depositAmount: l.depositAmount,
      })),
      addons: calculated.addons,
      rentalAmount: calculated.rentalAmount,
      addonsAmount: calculated.addonsAmount,
      depositAmount: calculated.depositAmount,
      totalDueAtPickup: calculated.totalDueAtPickup,
    };
  }

  async createBooking(
    userId: string,
    dto: CreateBookingDto,
    idempotencyKey?: string,
  ) {
    if (idempotencyKey) {
      const scopedKey = `${userId}:${idempotencyKey.trim()}`;
      this.cleanExpiredIdempotencyKeys();

      const existing = this.idempotencyMap.get(scopedKey);
      if (existing) {
        if (existing.status === 'COMPLETED' && existing.response) {
          this.logger.log(
            '[Idempotency] Returning cached booking response for duplicate request',
          );
          return existing.response;
        }
        if (existing.status === 'IN_FLIGHT' && existing.promise) {
          this.logger.log(
            '[Idempotency] Awaiting in-flight booking transaction for duplicate request',
          );
          return await existing.promise;
        }
      }

      let resolvePromise!: (val: any) => void;
      let rejectPromise!: (err: any) => void;
      const inFlightPromise = new Promise((resolve, reject) => {
        resolvePromise = resolve;
        rejectPromise = reject;
      });

      this.idempotencyMap.set(scopedKey, {
        status: 'IN_FLIGHT',
        promise: inFlightPromise,
        createdAt: Date.now(),
      });

      try {
        const result = await this.executeCreateBooking(userId, dto);
        this.idempotencyMap.set(scopedKey, {
          status: 'COMPLETED',
          response: result,
          createdAt: Date.now(),
        });
        resolvePromise(result);
        return result;
      } catch (error) {
        this.idempotencyMap.delete(scopedKey);
        rejectPromise(error);
        throw error;
      }
    }

    return this.executeCreateBooking(userId, dto);
  }

  private async executeCreateBooking(userId: string, dto: CreateBookingDto) {
    const calculated = await this.pricingService.calculateQuote(dto);
    const ttlHours = this.configService.get<number>(
      'BOOKING_PENDING_TTL_HOURS',
      24,
    );
    const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);

    const uniqueModelIdsSorted = Array.from(
      new Set(calculated.lines.map((l) => l.modelId)),
    ).sort();

    let createdBooking: BookingWithDetail;
    try {
      createdBooking = await this.prisma.$transaction(async (tx) => {
        // Lock model rows in deterministic ascending order in a single query to prevent deadlocks
        if (uniqueModelIdsSorted.length > 0) {
          await tx.$queryRaw`
            SELECT id
            FROM rental_models
            WHERE id IN (${Prisma.join(uniqueModelIdsSorted)})
            ORDER BY id ASC
            FOR UPDATE
          `;
        }

        const assignedUnitIds: string[] = [];
        const unitAssignments: Array<{
          unitId: string;
          modelId: string;
          pricePerDay: number;
          rentalAmount: number;
          depositAmount: number;
        }> = [];

        for (const line of calculated.lines) {
          const unit = await this.inventoryService.findAndLockAvailableUnit(
            tx,
            {
              modelId: line.modelId,
              branchId: calculated.branch.id,
              startDate: dto.startDate,
              endDate: dto.endDate,
              excludeUnitIds: assignedUnitIds,
            },
          );

          if (!unit) {
            throw new ConflictException({
              code: 'NO_UNIT_AVAILABLE',
              message: 'Hết máy trong khoảng ngày ở chi nhánh đã chọn.',
              details: { modelId: line.modelId },
            });
          }

          assignedUnitIds.push(unit.id);
          unitAssignments.push({
            unitId: unit.id,
            modelId: line.modelId,
            pricePerDay: line.pricePerDay,
            rentalAmount: line.rentalAmount,
            depositAmount: line.depositAmount,
          });
        }

        const booking = await tx.booking.create({
          data: {
            code: this.generateBookingCode(),
            userId,
            branchId: calculated.branch.id,
            startDate: calculated.startDateObj,
            endDate: calculated.endDateObj,
            days: calculated.days,
            status: BookingStatus.PENDING,
            contactName: dto.contactName.trim(),
            contactPhone: dto.contactPhone.trim(),
            note: dto.note?.trim() || null,
            rentalAmount: calculated.rentalAmount,
            addonsAmount: calculated.addonsAmount,
            depositAmount: calculated.depositAmount,
            totalAmount: calculated.totalDueAtPickup,
            expiresAt,
            setupPlanId: dto.setupPlanId ?? null,
            units: {
              create: unitAssignments.map((u) => ({
                unitId: u.unitId,
                modelId: u.modelId,
                active: true,
                startDate: calculated.startDateObj,
                endDate: calculated.endDateObj,
                pricePerDay: u.pricePerDay,
                rentalAmount: u.rentalAmount,
                depositAmount: u.depositAmount,
              })),
            },
            addons: {
              create: calculated.addons.map((a) => ({
                filmProductId: a.filmProductId,
                quantity: a.quantity,
                unitPrice: a.unitPrice,
              })),
            },
            statusLogs: {
              create: {
                fromStatus: null,
                toStatus: BookingStatus.PENDING,
                actorId: userId,
                note: 'Tạo yêu cầu đặt thuê',
              },
            },
          },
          include: BOOKING_INCLUDE_DETAIL,
        });

        await writeAuditLog(tx, {
          actorId: userId,
          action: 'BOOKING_CREATED',
          targetType: 'BOOKING',
          targetId: booking.id,
          metadata: {
            code: booking.code,
            branchId: calculated.branch.id,
            totalAmount: booking.totalAmount,
          },
        });

        return booking;
      });
    } catch (err: unknown) {
      if (this.isExclusionConstraintError(err)) {
        throw new ConflictException({
          code: 'NO_UNIT_AVAILABLE',
          message: 'Hết máy trong khoảng ngày ở chi nhánh đã chọn.',
          details: {},
        });
      }
      throw err;
    }

    this.eventEmitter.emit('booking.created', {
      bookingId: createdBooking.id,
      userId,
    });

    return this.formatBookingDetail(createdBooking, [Role.RENTER]);
  }

  async listMyBookings(userId: string, query: ListMyBookingsQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    const where: Prisma.BookingWhereInput = { userId };
    if (query.status) {
      where.status = query.status;
    }

    const [items, total] = await Promise.all([
      this.prisma.booking.findMany({
        where,
        include: BOOKING_INCLUDE_SUMMARY,
        orderBy: [{ createdAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.booking.count({ where }),
    ]);

    return {
      items: items.map((b) => this.formatBookingSummary(b, [Role.RENTER])),
      page,
      pageSize,
      total,
    };
  }

  async getBookingDetail(
    bookingId: string,
    userId: string,
    userRoles: string[],
  ) {
    const isStaff =
      userRoles.includes(Role.STAFF) || userRoles.includes(Role.ADMIN);

    const booking = await this.prisma.booking.findFirst({
      where: isStaff ? { id: bookingId } : { id: bookingId, userId },
      include: BOOKING_INCLUDE_DETAIL,
    });

    if (!booking) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Không tìm thấy đơn thuê.',
        details: {},
      });
    }

    return this.formatBookingDetail(booking, userRoles);
  }

  async cancelMyBooking(
    bookingId: string,
    userId: string,
    dto: CancelBookingDto,
  ) {
    const existing = await this.prisma.booking.findFirst({
      where: { id: bookingId, userId },
    });

    if (!existing) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Không tìm thấy đơn thuê.',
        details: {},
      });
    }

    assertValidBookingTransition(existing.status, BookingStatus.CANCELLED);

    const updated = await this.prisma.$transaction(async (tx) => {
      const booking = await tx.booking.update({
        where: { id: bookingId },
        data: {
          status: BookingStatus.CANCELLED,
          cancelledReason: dto.reason?.trim() || 'Khách hàng hủy đơn',
        },
        include: BOOKING_INCLUDE_DETAIL,
      });

      await Promise.all([
        tx.bookingUnit.updateMany({
          where: { bookingId },
          data: { active: false },
        }),
        tx.bookingStatusLog.create({
          data: {
            bookingId,
            fromStatus: existing.status,
            toStatus: BookingStatus.CANCELLED,
            actorId: userId,
            note: dto.reason?.trim() || 'Khách hàng hủy đơn',
          },
        }),
        writeAuditLog(tx, {
          actorId: userId,
          action: 'BOOKING_CANCELLED_BY_CUSTOMER',
          targetType: 'BOOKING',
          targetId: bookingId,
          metadata: { fromStatus: existing.status, reason: dto.reason ?? null },
        }),
      ]);

      return booking;
    });

    this.eventEmitter.emit('booking.cancelled', { bookingId, userId });
    return this.formatBookingDetail(updated, [Role.RENTER]);
  }

  async expirePendingBookings(): Promise<number> {
    const now = new Date();
    const expiredBookings = await this.prisma.booking.findMany({
      where: {
        status: BookingStatus.PENDING,
        expiresAt: { lt: now },
      },
      select: { id: true },
      orderBy: { expiresAt: 'asc' },
      take: 100,
    });

    if (expiredBookings.length === 0) {
      return 0;
    }

    let expiredCount = 0;
    for (const item of expiredBookings) {
      const changed = await this.prisma.$transaction(async (tx) => {
        const res = await tx.booking.updateMany({
          where: { id: item.id, status: BookingStatus.PENDING },
          data: {
            status: BookingStatus.CANCELLED,
            cancelledReason: 'Hết hạn chờ xác nhận',
          },
        });
        if (res.count === 0) {
          return false;
        }

        await Promise.all([
          tx.bookingUnit.updateMany({
            where: { bookingId: item.id },
            data: { active: false },
          }),
          tx.bookingStatusLog.create({
            data: {
              bookingId: item.id,
              fromStatus: BookingStatus.PENDING,
              toStatus: BookingStatus.CANCELLED,
              actorId: null,
              note: 'Hết hạn chờ xác nhận',
            },
          }),
          writeAuditLog(tx, {
            actorId: null,
            action: 'BOOKING_EXPIRED',
            targetType: 'BOOKING',
            targetId: item.id,
          }),
        ]);

        return true;
      });
      if (changed) expiredCount += 1;
    }

    if (expiredCount > 0) {
      this.logger.log(`Expired ${expiredCount} pending bookings.`);
    }
    return expiredCount;
  }
}
