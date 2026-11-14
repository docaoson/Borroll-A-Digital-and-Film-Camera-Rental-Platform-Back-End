import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  BookingStatus,
  ManualPaymentStatus,
  PaymentProofStatus,
  Role,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { writeAuditLog } from '../../common/utils/audit.util';
import { PrismaService } from '../../infra/database/prisma.service';
import {
  STORAGE_SERVICE,
  StorageService,
} from '../../infra/storage/storage.service';
import {
  PaymentProofPresignDto,
  RejectPaymentDto,
  SubmitPaymentProofDto,
} from './dto/payment.dto';

const IMAGE_TYPES = ['image/jpeg', 'image/png'] as const;
const EXTENSIONS = { 'image/jpeg': 'jpg', 'image/png': 'png' } as const;

@Injectable()
export class PaymentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly eventEmitter: EventEmitter2,
    @Inject(STORAGE_SERVICE) private readonly storage: StorageService,
  ) {}

  private get bucket() {
    return this.config.get<string>(
      'STORAGE_BUCKET_PAYMENT_PROOFS',
      'payment-proofs',
    );
  }

  async presign(
    bookingId: string,
    userId: string,
    dto: PaymentProofPresignDto,
  ) {
    if (
      !Number.isSafeInteger(dto.fileSize) ||
      dto.fileSize < 1 ||
      dto.fileSize > 5 * 1024 * 1024
    ) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Ảnh minh chứng phải có dung lượng từ 1 byte đến 5 MB.',
        details: {},
      });
    }
    const booking = await this.prisma.booking.findFirst({
      where: { id: bookingId, userId },
      include: { manualPayment: true },
    });
    if (!booking)
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Không tìm thấy đơn thuê.',
        details: {},
      });
    if (
      booking.status === BookingStatus.CANCELLED ||
      booking.status === BookingStatus.REJECTED ||
      booking.status === BookingStatus.COMPLETED
    ) {
      throw new ConflictException({
        code: 'PAYMENT_NOT_AVAILABLE',
        message: 'Đơn thuê này không thể thanh toán.',
        details: {},
      });
    }
    if (booking.manualPayment?.status === ManualPaymentStatus.PAID) {
      throw new ConflictException({
        code: 'PAYMENT_ALREADY_PAID',
        message: 'Đơn thuê đã được xác nhận thanh toán.',
        details: {},
      });
    }
    if (
      booking.manualPayment?.status === ManualPaymentStatus.PENDING_VERIFICATION
    ) {
      throw new ConflictException({
        code: 'PAYMENT_ALREADY_PENDING',
        message: 'Minh chứng đang chờ cửa hàng xác nhận.',
        details: {},
      });
    }
    const ext = EXTENSIONS[dto.contentType];
    const path = `${userId}/${bookingId}/${randomUUID()}.${ext}`;
    return this.storage.createUploadUrl(this.bucket, path);
  }

  async submit(bookingId: string, userId: string, dto: SubmitPaymentProofDto) {
    const booking = await this.prisma.booking.findFirst({
      where: { id: bookingId, userId },
      include: {
        manualPayment: {
          include: { proofs: { orderBy: { submittedAt: 'desc' }, take: 1 } },
        },
      },
    });
    if (!booking)
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Không tìm thấy đơn thuê.',
        details: {},
      });
    if (
      booking.status === BookingStatus.CANCELLED ||
      booking.status === BookingStatus.REJECTED ||
      booking.status === BookingStatus.COMPLETED
    ) {
      throw new ConflictException({
        code: 'PAYMENT_NOT_AVAILABLE',
        message: 'Đơn thuê này không thể thanh toán.',
        details: {},
      });
    }
    if (booking.manualPayment?.status === ManualPaymentStatus.PAID) {
      throw new ConflictException({
        code: 'PAYMENT_ALREADY_PAID',
        message: 'Đơn thuê đã được xác nhận thanh toán.',
        details: {},
      });
    }
    if (
      booking.manualPayment?.status === ManualPaymentStatus.PENDING_VERIFICATION
    ) {
      throw new ConflictException({
        code: 'PAYMENT_ALREADY_PENDING',
        message: 'Minh chứng đang chờ cửa hàng xác nhận.',
        details: {},
      });
    }
    const prefix = `${userId}/${bookingId}/`;
    if (
      !IMAGE_TYPES.some((type) =>
        dto.path.toLowerCase().endsWith(EXTENSIONS[type]),
      )
    ) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Chỉ hỗ trợ ảnh JPG, JPEG hoặc PNG.',
        details: {},
      });
    }
    await this.storage.assertOwnedFile(this.bucket, dto.path, prefix, {
      maxBytes: 5 * 1024 * 1024,
      allowedMimeTypes: IMAGE_TYPES,
    });

    const payment = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.manualPayment.findUnique({
        where: { bookingId },
      });
      let saved;
      if (existing) {
        const claimed = await tx.manualPayment.updateMany({
          where: {
            id: existing.id,
            status: {
              in: [ManualPaymentStatus.UNPAID, ManualPaymentStatus.REJECTED],
            },
          },
          data: {
            amount: booking.totalAmount,
            status: ManualPaymentStatus.PENDING_VERIFICATION,
          },
        });
        if (claimed.count !== 1)
          throw new ConflictException({
            code: 'PAYMENT_ALREADY_PENDING',
            message: 'Minh chứng đang chờ cửa hàng xác nhận.',
            details: {},
          });
        saved = existing;
      } else {
        saved = await tx.manualPayment.create({
          data: {
            bookingId,
            amount: booking.totalAmount,
            status: ManualPaymentStatus.PENDING_VERIFICATION,
          },
        });
      }
      await tx.paymentProof.create({
        data: { paymentId: saved.id, path: dto.path },
      });
      await writeAuditLog(tx, {
        actorId: userId,
        action: 'PAYMENT_PROOF_SUBMITTED',
        targetType: 'PAYMENT',
        targetId: saved.id,
        metadata: { bookingId, amount: booking.totalAmount },
      });
      return saved;
    });
    return { id: payment.id, amount: payment.amount, status: payment.status };
  }

  async listAdmin(status?: ManualPaymentStatus) {
    const payments = await this.prisma.manualPayment.findMany({
      where: status ? { status } : {},
      include: {
        booking: {
          select: {
            id: true,
            code: true,
            totalAmount: true,
            contactName: true,
            user: { select: { fullName: true, email: true } },
          },
        },
        proofs: { orderBy: { submittedAt: 'desc' }, take: 1 },
      },
      orderBy: { updatedAt: 'desc' },
    });
    return Promise.all(
      payments.map(async (p) => ({
        id: p.id,
        booking: p.booking,
        amount: p.amount,
        status: p.status,
        latestProof: p.proofs[0]
          ? {
              id: p.proofs[0].id,
              status: p.proofs[0].status,
              submittedAt: p.proofs[0].submittedAt.toISOString(),
              imageUrl: await this.storage.createSignedUrl(
                this.bucket,
                p.proofs[0].path,
                300,
              ),
              rejectionReason: p.proofs[0].rejectionReason,
            }
          : null,
      })),
    );
  }

  async history(bookingId: string, userId: string, roles: string[]) {
    const staff = roles.includes(Role.ADMIN) || roles.includes(Role.STAFF);
    const payment = await this.prisma.manualPayment.findFirst({
      where: { booking: { id: bookingId, ...(staff ? {} : { userId }) } },
      include: {
        proofs: { orderBy: { submittedAt: 'asc' } },
        booking: { select: { code: true, totalAmount: true } },
      },
    });
    if (!payment)
      return {
        amount:
          (
            await this.prisma.booking.findFirst({
              where: { id: bookingId, ...(staff ? {} : { userId }) },
              select: { totalAmount: true },
            })
          )?.totalAmount ?? null,
        status: 'UNPAID',
        proofs: [],
      };
    return {
      id: payment.id,
      amount: payment.amount,
      status: payment.status,
      booking: payment.booking,
      proofs: await Promise.all(
        payment.proofs.map(async (p) => ({
          id: p.id,
          status: p.status,
          submittedAt: p.submittedAt.toISOString(),
          reviewedAt: p.reviewedAt?.toISOString() ?? null,
          reviewedBy: p.reviewedBy,
          rejectionReason: p.rejectionReason,
          imageUrl: await this.storage.createSignedUrl(
            this.bucket,
            p.path,
            300,
          ),
        })),
      ),
    };
  }

  private async decide(
    paymentId: string,
    actorId: string,
    approve: boolean,
    reason?: string,
  ) {
    const result = await this.prisma.$transaction(async (tx) => {
      const payment = await tx.manualPayment.findUnique({
        where: { id: paymentId },
        include: {
          booking: true,
          proofs: { orderBy: { submittedAt: 'desc' }, take: 1 },
        },
      });
      if (!payment)
        throw new NotFoundException({
          code: 'NOT_FOUND',
          message: 'Không tìm thấy thanh toán.',
          details: {},
        });
      const proof = payment.proofs[0];
      if (
        payment.booking.status === BookingStatus.CANCELLED ||
        payment.booking.status === BookingStatus.REJECTED ||
        payment.booking.status === BookingStatus.COMPLETED
      ) {
        throw new ConflictException({
          code: 'INVALID_BOOKING_STATE',
          message: 'Đơn thuê đã kết thúc và không thể xử lý thanh toán.',
          details: {},
        });
      }
      if (
        payment.status !== ManualPaymentStatus.PENDING_VERIFICATION ||
        !proof ||
        proof.status !== PaymentProofStatus.PENDING
      ) {
        throw new ConflictException({
          code: 'INVALID_PAYMENT_STATE',
          message: 'Thanh toán không còn chờ xác nhận.',
          details: {},
        });
      }
      if (
        approve &&
        payment.booking.status !== BookingStatus.PENDING &&
        payment.booking.status !== BookingStatus.CONFIRMED
      ) {
        throw new ConflictException({
          code: 'INVALID_BOOKING_STATE',
          message:
            'Đơn thuê không còn ở trạng thái có thể xác nhận thanh toán.',
          details: {},
        });
      }
      const paymentUpdate = await tx.manualPayment.updateMany({
        where: {
          id: paymentId,
          status: ManualPaymentStatus.PENDING_VERIFICATION,
        },
        data: approve
          ? {
              status: ManualPaymentStatus.PAID,
              confirmedBy: actorId,
              confirmedAt: new Date(),
            }
          : { status: ManualPaymentStatus.REJECTED },
      });
      if (paymentUpdate.count !== 1)
        throw new ConflictException({
          code: 'INVALID_PAYMENT_STATE',
          message: 'Thanh toán vừa được xử lý bởi nhân viên khác.',
          details: {},
        });
      await tx.paymentProof.update({
        where: { id: proof.id },
        data: {
          status: approve
            ? PaymentProofStatus.APPROVED
            : PaymentProofStatus.REJECTED,
          reviewedBy: actorId,
          reviewedAt: new Date(),
          rejectionReason: approve ? null : reason,
        },
      });
      if (approve && payment.booking.status === BookingStatus.PENDING) {
        const changed = await tx.booking.updateMany({
          where: { id: payment.bookingId, status: BookingStatus.PENDING },
          data: {
            status: BookingStatus.CONFIRMED,
            confirmedBy: actorId,
            confirmedAt: new Date(),
          },
        });
        if (changed.count !== 1)
          throw new ConflictException({
            code: 'INVALID_BOOKING_STATE',
            message: 'Đơn thuê vừa được cập nhật bởi nhân viên khác.',
            details: {},
          });
        await tx.bookingStatusLog.create({
          data: {
            bookingId: payment.bookingId,
            fromStatus: BookingStatus.PENDING,
            toStatus: BookingStatus.CONFIRMED,
            actorId,
            note: 'Xác nhận đơn sau khi xác nhận thanh toán chuyển khoản',
          },
        });
      }
      await writeAuditLog(tx, {
        actorId,
        action: approve ? 'PAYMENT_CONFIRMED' : 'PAYMENT_REJECTED',
        targetType: 'PAYMENT',
        targetId: paymentId,
        metadata: {
          bookingId: payment.bookingId,
          proofId: proof.id,
          reason: reason ?? null,
        },
      });
      return {
        bookingId: payment.bookingId,
        status: approve
          ? ManualPaymentStatus.PAID
          : ManualPaymentStatus.REJECTED,
        bookingConfirmed:
          approve && payment.booking.status === BookingStatus.PENDING,
      };
    });
    if (result.bookingConfirmed)
      this.eventEmitter.emit('booking.confirmed', {
        bookingId: result.bookingId,
        actorId,
      });
    return result;
  }

  confirm(paymentId: string, actorId: string) {
    return this.decide(paymentId, actorId, true);
  }

  reject(paymentId: string, actorId: string, dto: RejectPaymentDto) {
    const reason = dto.reason.trim();
    if (reason.length < 3)
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Vui lòng nhập lý do từ chối.',
        details: {},
      });
    return this.decide(paymentId, actorId, false, reason);
  }
}
