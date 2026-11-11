import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  BookingStatus,
  HandoverKind,
  PaymentType,
  Prisma,
} from '@prisma/client';
import * as crypto from 'crypto';
import { writeAuditLog } from '../../common/utils/audit.util';
import {
  getTodayVietnamUtcDate,
  parseIsoDateToUtc,
} from '../../common/utils/date.util';
import { PrismaService } from '../../infra/database/prisma.service';
import {
  STORAGE_SERVICE,
  StorageService,
} from '../../infra/storage/storage.service';
import {
  assertValidBookingTransition,
  BOOKING_INCLUDE_DETAIL,
  BookingService,
} from '../booking';
import {
  CompleteBookingDto,
  HandoverPhotoPresignDto,
  PickupBookingDto,
  ReasonBodyDto,
  ReturnBookingDto,
  StaffBookingsQueryDto,
  StaffDashboardQueryDto,
} from './dto/operations.dto';

const CONTENT_TYPE_EXTENSIONS: Record<
  HandoverPhotoPresignDto['contentType'],
  string
> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

@Injectable()
export class OperationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly eventEmitter: EventEmitter2,
    private readonly bookingService: BookingService,
    @Inject(STORAGE_SERVICE)
    private readonly storageService: StorageService,
  ) {}

  private getHandoverBucket(): string {
    return this.configService.get<string>(
      'STORAGE_BUCKET_HANDOVER',
      'handover-photos',
    );
  }

  async getDashboard(query: StaffDashboardQueryDto, viewerRoles: string[]) {
    const todayDate = getTodayVietnamUtcDate();
    const branchWhere: Prisma.BookingWhereInput = query.branch
      ? { branch: { slug: query.branch } }
      : {};

    const [pendingCount, pickupsToday, returnsToday, overdue] =
      await Promise.all([
        this.prisma.booking.count({
          where: { ...branchWhere, status: BookingStatus.PENDING },
        }),
        this.prisma.booking.findMany({
          where: {
            ...branchWhere,
            status: BookingStatus.CONFIRMED,
            startDate: todayDate,
          },
          include: BOOKING_INCLUDE_DETAIL,
          orderBy: [{ createdAt: 'asc' }],
        }),
        this.prisma.booking.findMany({
          where: {
            ...branchWhere,
            status: BookingStatus.PICKED_UP,
            endDate: todayDate,
          },
          include: BOOKING_INCLUDE_DETAIL,
          orderBy: [{ createdAt: 'asc' }],
        }),
        this.prisma.booking.findMany({
          where: {
            ...branchWhere,
            status: BookingStatus.PICKED_UP,
            endDate: { lt: todayDate },
          },
          include: BOOKING_INCLUDE_DETAIL,
          orderBy: [{ endDate: 'asc' }],
        }),
      ]);

    return {
      pendingCount,
      pickupsToday: pickupsToday.map((b) =>
        this.bookingService.formatBookingSummary(b, viewerRoles),
      ),
      returnsToday: returnsToday.map((b) =>
        this.bookingService.formatBookingSummary(b, viewerRoles),
      ),
      overdue: overdue.map((b) =>
        this.bookingService.formatBookingSummary(b, viewerRoles),
      ),
    };
  }

  async listStaffBookings(query: StaffBookingsQueryDto, viewerRoles: string[]) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const todayDate = getTodayVietnamUtcDate();

    const where: Prisma.BookingWhereInput = {};
    if (query.status) {
      where.status = query.status;
    }
    if (query.branch) {
      where.branch = { slug: query.branch };
    }
    if (query.date) {
      const targetDate = parseIsoDateToUtc(query.date);
      where.AND = [
        ...(Array.isArray(where.AND) ? where.AND : []),
        { OR: [{ startDate: targetDate }, { endDate: targetDate }] },
      ];
    }
    if (query.overdue === 'true') {
      where.status = BookingStatus.PICKED_UP;
      where.endDate = { lt: todayDate };
    }
    if (query.q?.trim()) {
      const q = query.q.trim();
      where.AND = [
        ...(Array.isArray(where.AND) ? where.AND : []),
        {
          OR: [
            { code: { contains: q, mode: 'insensitive' } },
            { contactName: { contains: q, mode: 'insensitive' } },
            { contactPhone: { contains: q, mode: 'insensitive' } },
            { user: { fullName: { contains: q, mode: 'insensitive' } } },
            { user: { phone: { contains: q, mode: 'insensitive' } } },
          ],
        },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.booking.findMany({
        where,
        include: BOOKING_INCLUDE_DETAIL,
        orderBy: [{ createdAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.booking.count({ where }),
    ]);

    return {
      items: items.map((b) =>
        this.bookingService.formatBookingSummary(b, viewerRoles),
      ),
      page,
      pageSize,
      total,
    };
  }

  async confirmBooking(
    bookingId: string,
    actorId: string,
    viewerRoles: string[],
  ) {
    const existing = await this.prisma.booking.findUnique({
      where: { id: bookingId },
    });
    if (!existing) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Không tìm thấy đơn thuê.',
        details: {},
      });
    }

    assertValidBookingTransition(existing.status, BookingStatus.CONFIRMED);

    const updated = await this.prisma.$transaction(async (tx) => {
      const booking = await tx.booking.update({
        where: { id: bookingId },
        data: {
          status: BookingStatus.CONFIRMED,
          confirmedBy: actorId,
          confirmedAt: new Date(),
        },
        include: BOOKING_INCLUDE_DETAIL,
      });

      await tx.bookingStatusLog.create({
        data: {
          bookingId,
          fromStatus: existing.status,
          toStatus: BookingStatus.CONFIRMED,
          actorId,
          note: 'Nhân viên xác nhận đơn',
        },
      });

      await writeAuditLog(tx, {
        actorId,
        action: 'BOOKING_CONFIRMED',
        targetType: 'BOOKING',
        targetId: bookingId,
      });

      return booking;
    });

    this.eventEmitter.emit('booking.confirmed', { bookingId, actorId });
    return this.bookingService.formatBookingDetail(updated, viewerRoles);
  }

  async rejectBooking(
    bookingId: string,
    dto: ReasonBodyDto,
    actorId: string,
    viewerRoles: string[],
  ) {
    const existing = await this.prisma.booking.findUnique({
      where: { id: bookingId },
    });
    if (!existing) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Không tìm thấy đơn thuê.',
        details: {},
      });
    }

    assertValidBookingTransition(existing.status, BookingStatus.REJECTED);

    const reason = dto.reason.trim();
    const updated = await this.prisma.$transaction(async (tx) => {
      const booking = await tx.booking.update({
        where: { id: bookingId },
        data: {
          status: BookingStatus.REJECTED,
          rejectedReason: reason,
        },
        include: BOOKING_INCLUDE_DETAIL,
      });

      await tx.bookingUnit.updateMany({
        where: { bookingId },
        data: { active: false },
      });

      await tx.bookingStatusLog.create({
        data: {
          bookingId,
          fromStatus: existing.status,
          toStatus: BookingStatus.REJECTED,
          actorId,
          note: reason,
        },
      });

      await writeAuditLog(tx, {
        actorId,
        action: 'BOOKING_REJECTED',
        targetType: 'BOOKING',
        targetId: bookingId,
        metadata: { reason },
      });

      return booking;
    });

    this.eventEmitter.emit('booking.rejected', { bookingId, actorId });
    return this.bookingService.formatBookingDetail(updated, viewerRoles);
  }

  async cancelBooking(
    bookingId: string,
    dto: ReasonBodyDto,
    actorId: string,
    viewerRoles: string[],
  ) {
    const existing = await this.prisma.booking.findUnique({
      where: { id: bookingId },
    });
    if (!existing) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Không tìm thấy đơn thuê.',
        details: {},
      });
    }

    assertValidBookingTransition(existing.status, BookingStatus.CANCELLED);

    const reason = dto.reason.trim();
    const updated = await this.prisma.$transaction(async (tx) => {
      const booking = await tx.booking.update({
        where: { id: bookingId },
        data: {
          status: BookingStatus.CANCELLED,
          cancelledReason: reason,
        },
        include: BOOKING_INCLUDE_DETAIL,
      });

      await tx.bookingUnit.updateMany({
        where: { bookingId },
        data: { active: false },
      });

      await tx.bookingStatusLog.create({
        data: {
          bookingId,
          fromStatus: existing.status,
          toStatus: BookingStatus.CANCELLED,
          actorId,
          note: reason,
        },
      });

      await writeAuditLog(tx, {
        actorId,
        action: 'BOOKING_CANCELLED_BY_STAFF',
        targetType: 'BOOKING',
        targetId: bookingId,
        metadata: { fromStatus: existing.status, reason },
      });

      return booking;
    });

    this.eventEmitter.emit('booking.cancelled', { bookingId, actorId });
    return this.bookingService.formatBookingDetail(updated, viewerRoles);
  }

  async presignHandoverPhoto(dto: HandoverPhotoPresignDto) {
    const booking = await this.prisma.booking.findUnique({
      where: { id: dto.bookingId },
      select: { id: true },
    });
    if (!booking) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Không tìm thấy đơn thuê.',
        details: {},
      });
    }

    const ext = CONTENT_TYPE_EXTENSIONS[dto.contentType];
    const path = `handover/${dto.bookingId}/${crypto.randomUUID()}.${ext}`;
    return this.storageService.createUploadUrl(this.getHandoverBucket(), path);
  }

  async pickupBooking(
    bookingId: string,
    dto: PickupBookingDto,
    actorId: string,
    viewerRoles: string[],
  ) {
    const existing = await this.prisma.booking.findUnique({
      where: { id: bookingId },
    });
    if (!existing) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Không tìm thấy đơn thuê.',
        details: {},
      });
    }

    assertValidBookingTransition(existing.status, BookingStatus.PICKED_UP);

    if (!dto.idChecked) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Bắt buộc kiểm tra giấy tờ tùy thân trước khi giao máy.',
        details: {
          fields: { idChecked: 'Phải xác nhận đã kiểm tra giấy tờ' },
        },
      });
    }

    const bucket = this.getHandoverBucket();
    const expectedPrefix = `handover/${bookingId}/`;
    for (const path of dto.photoPaths) {
      await this.storageService.assertOwnedFile(bucket, path, expectedPrefix);
    }

    const depositReceived = dto.payments
      .filter((p) => p.type === PaymentType.DEPOSIT_RECEIVED)
      .reduce((sum, p) => sum + p.amount, 0);
    const rentalReceived = dto.payments
      .filter((p) => p.type === PaymentType.RENTAL_RECEIVED)
      .reduce((sum, p) => sum + p.amount, 0);

    const requiredRental = existing.rentalAmount + existing.addonsAmount;
    if (
      depositReceived < existing.depositAmount ||
      rentalReceived < requiredRental
    ) {
      throw new UnprocessableEntityException({
        code: 'PAYMENT_INCOMPLETE',
        message: 'Số tiền thu lúc giao máy chưa đủ theo giá trị đơn.',
        details: {
          requiredDeposit: existing.depositAmount,
          depositReceived,
          requiredRental,
          rentalReceived,
        },
      });
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const booking = await tx.booking.update({
        where: { id: bookingId },
        data: {
          status: BookingStatus.PICKED_UP,
          pickedUpAt: new Date(),
        },
        include: BOOKING_INCLUDE_DETAIL,
      });

      await tx.handoverRecord.create({
        data: {
          bookingId,
          kind: HandoverKind.PICKUP,
          checklist: dto.checklist as unknown as Prisma.InputJsonValue,
          conditionNotes: dto.conditionNotes?.trim() || null,
          photoPaths: dto.photoPaths,
          idChecked: true,
          recordedBy: actorId,
        },
      });

      for (const payment of dto.payments) {
        if (payment.amount > 0) {
          await tx.paymentRecord.create({
            data: {
              bookingId,
              type: payment.type,
              amount: payment.amount,
              method: payment.method,
              note: payment.note?.trim() || null,
              recordedBy: actorId,
            },
          });
        }
      }

      await tx.bookingStatusLog.create({
        data: {
          bookingId,
          fromStatus: existing.status,
          toStatus: BookingStatus.PICKED_UP,
          actorId,
          note: 'Giao máy cho khách',
        },
      });

      await writeAuditLog(tx, {
        actorId,
        action: 'BOOKING_PICKED_UP',
        targetType: 'BOOKING',
        targetId: bookingId,
        metadata: { depositReceived, rentalReceived },
      });

      return booking;
    });

    this.eventEmitter.emit('booking.picked_up', { bookingId, actorId });
    return this.bookingService.formatBookingDetail(updated, viewerRoles);
  }

  async returnBooking(
    bookingId: string,
    dto: ReturnBookingDto,
    actorId: string,
    viewerRoles: string[],
  ) {
    const existing = await this.prisma.booking.findUnique({
      where: { id: bookingId },
    });
    if (!existing) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Không tìm thấy đơn thuê.',
        details: {},
      });
    }

    assertValidBookingTransition(existing.status, BookingStatus.RETURNED);

    const bucket = this.getHandoverBucket();
    const expectedPrefix = `handover/${bookingId}/`;
    for (const path of dto.photoPaths) {
      await this.storageService.assertOwnedFile(bucket, path, expectedPrefix);
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const booking = await tx.booking.update({
        where: { id: bookingId },
        data: {
          status: BookingStatus.RETURNED,
          returnedAt: new Date(),
        },
        include: BOOKING_INCLUDE_DETAIL,
      });

      await tx.handoverRecord.create({
        data: {
          bookingId,
          kind: HandoverKind.RETURN,
          checklist: dto.checklist as unknown as Prisma.InputJsonValue,
          conditionNotes: dto.conditionNotes?.trim() || null,
          photoPaths: dto.photoPaths,
          idChecked: true,
          recordedBy: actorId,
        },
      });

      await tx.bookingStatusLog.create({
        data: {
          bookingId,
          fromStatus: existing.status,
          toStatus: BookingStatus.RETURNED,
          actorId,
          note: 'Khách đã trả máy',
        },
      });

      await writeAuditLog(tx, {
        actorId,
        action: 'BOOKING_RETURNED',
        targetType: 'BOOKING',
        targetId: bookingId,
      });

      return booking;
    });

    this.eventEmitter.emit('booking.returned', { bookingId, actorId });
    return this.bookingService.formatBookingDetail(updated, viewerRoles);
  }

  async completeBooking(
    bookingId: string,
    dto: CompleteBookingDto,
    actorId: string,
    viewerRoles: string[],
  ) {
    const existing = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: { payments: true },
    });
    if (!existing) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Không tìm thấy đơn thuê.',
        details: {},
      });
    }

    assertValidBookingTransition(existing.status, BookingStatus.COMPLETED);

    const depositCollected = existing.payments
      .filter((p) => p.type === PaymentType.DEPOSIT_RECEIVED)
      .reduce((sum, p) => sum + p.amount, 0);

    const charges = dto.charges ?? [];
    const totalCharges = charges.reduce((sum, c) => sum + c.amount, 0);

    if (totalCharges > depositCollected) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Tổng tiền khấu trừ không được vượt quá tiền cọc đã thu.',
        details: {
          depositCollected,
          totalCharges,
        },
      });
    }

    const refundAmount = depositCollected - totalCharges;

    const updated = await this.prisma.$transaction(async (tx) => {
      for (const charge of charges) {
        if (charge.amount > 0) {
          await tx.paymentRecord.create({
            data: {
              bookingId,
              type: charge.type,
              amount: charge.amount,
              method: dto.refundMethod,
              note: charge.note?.trim() || null,
              recordedBy: actorId,
            },
          });
        }
      }

      await tx.paymentRecord.create({
        data: {
          bookingId,
          type: PaymentType.DEPOSIT_REFUNDED,
          amount: refundAmount,
          method: dto.refundMethod,
          note: dto.note?.trim() || null,
          recordedBy: actorId,
        },
      });

      await tx.bookingUnit.updateMany({
        where: { bookingId },
        data: { active: false },
      });

      const booking = await tx.booking.update({
        where: { id: bookingId },
        data: {
          status: BookingStatus.COMPLETED,
          completedAt: new Date(),
        },
        include: BOOKING_INCLUDE_DETAIL,
      });

      await tx.bookingStatusLog.create({
        data: {
          bookingId,
          fromStatus: existing.status,
          toStatus: BookingStatus.COMPLETED,
          actorId,
          note: 'Hoàn tất đơn và hoàn cọc',
        },
      });

      await writeAuditLog(tx, {
        actorId,
        action: 'BOOKING_COMPLETED',
        targetType: 'BOOKING',
        targetId: bookingId,
        metadata: { depositCollected, totalCharges, refundAmount },
      });

      return booking;
    });

    this.eventEmitter.emit('booking.completed', { bookingId, actorId });
    return this.bookingService.formatBookingDetail(updated, viewerRoles);
  }
}
