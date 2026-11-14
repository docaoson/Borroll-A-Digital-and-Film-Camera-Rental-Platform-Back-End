import { BadRequestException, ConflictException } from '@nestjs/common';
import { PaymentService } from './payment.service';

describe('PaymentService', () => {
  it('rejects an oversized proof before issuing an upload URL', async () => {
    const prisma = { booking: { findFirst: jest.fn() } };
    const storage = { createUploadUrl: jest.fn() };
    const service = new PaymentService(
      prisma as never,
      { get: jest.fn() } as never,
      { emit: jest.fn() } as never,
      storage as never,
    );

    await expect(
      service.presign('booking-1', 'renter-1', {
        contentType: 'image/jpeg',
        fileSize: 5 * 1024 * 1024 + 1,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.booking.findFirst).not.toHaveBeenCalled();
    expect(storage.createUploadUrl).not.toHaveBeenCalled();
  });

  it('blocks duplicate proof submissions while one is awaiting review', async () => {
    const prisma = {
      booking: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'booking-1',
          status: 'PENDING',
          totalAmount: 12500,
          manualPayment: { status: 'PENDING_VERIFICATION' },
        }),
      },
    };
    const storage = { assertOwnedFile: jest.fn() };
    const service = new PaymentService(
      prisma as never,
      {} as never,
      { emit: jest.fn() } as never,
      storage as never,
    );

    await expect(
      service.submit('booking-1', 'renter-1', {
        path: 'renter-1/booking-1/duplicate.jpg',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(storage.assertOwnedFile).not.toHaveBeenCalled();
  });

  it('returns private signed proof URLs only for a renter-owned booking', async () => {
    const prisma = {
      manualPayment: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'payment-1',
          amount: 12500,
          status: 'PENDING_VERIFICATION',
          booking: { code: 'BR-1', totalAmount: 12500 },
          proofs: [
            {
              id: 'proof-1',
              path: 'renter-1/booking-1/proof.jpg',
              status: 'PENDING',
              submittedAt: new Date('2026-01-01T00:00:00.000Z'),
              reviewedAt: null,
              reviewedBy: null,
              rejectionReason: null,
            },
          ],
        }),
      },
    };
    const storage = {
      createSignedUrl: jest.fn().mockResolvedValue('https://signed.example/proof'),
    };
    const service = new PaymentService(
      prisma as never,
      { get: jest.fn().mockReturnValue('payment-proofs') } as never,
      { emit: jest.fn() } as never,
      storage as never,
    );

    const history = await service.history('booking-1', 'renter-1', ['RENTER']);

    expect(prisma.manualPayment.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { booking: { id: 'booking-1', userId: 'renter-1' } },
      }),
    );
    expect(storage.createSignedUrl).toHaveBeenCalledWith(
      'payment-proofs',
      'renter-1/booking-1/proof.jpg',
      300,
    );
    expect(history.proofs[0].imageUrl).toBe('https://signed.example/proof');
  });

  it('does not return proof history for a booking owned by another renter', async () => {
    const prisma = {
      manualPayment: { findFirst: jest.fn().mockResolvedValue(null) },
      booking: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const storage = { createSignedUrl: jest.fn() };
    const service = new PaymentService(
      prisma as never,
      {} as never,
      { emit: jest.fn() } as never,
      storage as never,
    );

    await expect(
      service.history('booking-1', 'renter-2', ['RENTER']),
    ).resolves.toEqual({ amount: null, status: 'UNPAID', proofs: [] });
    expect(prisma.manualPayment.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { booking: { id: 'booking-1', userId: 'renter-2' } },
      }),
    );
    expect(storage.createSignedUrl).not.toHaveBeenCalled();
  });

  it('uses the persisted booking total and validates the uploaded file', async () => {
    const tx = {
      manualPayment: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest
          .fn()
          .mockResolvedValue({
            id: 'payment-1',
            amount: 12500,
            status: 'PENDING_VERIFICATION',
          }),
      },
      paymentProof: { create: jest.fn().mockResolvedValue({}) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      booking: {
        findFirst: jest
          .fn()
          .mockResolvedValue({
            id: 'booking-1',
            status: 'PENDING',
            totalAmount: 12500,
            manualPayment: null,
          }),
      },
      $transaction: jest.fn((callback) => callback(tx)),
    };
    const storage = { assertOwnedFile: jest.fn().mockResolvedValue(undefined) };
    const service = new PaymentService(
      prisma as never,
      { get: jest.fn().mockReturnValue('payment-proofs') } as never,
      { emit: jest.fn() } as never,
      storage as never,
    );

    await expect(
      service.submit('booking-1', 'renter-1', {
        path: 'renter-1/booking-1/proof.jpg',
      }),
    ).resolves.toEqual({
      id: 'payment-1',
      amount: 12500,
      status: 'PENDING_VERIFICATION',
    });

    expect(prisma.booking.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'booking-1', userId: 'renter-1' },
      }),
    );
    expect(storage.assertOwnedFile).toHaveBeenCalledWith(
      'payment-proofs',
      'renter-1/booking-1/proof.jpg',
      'renter-1/booking-1/',
      expect.objectContaining({ maxBytes: 5 * 1024 * 1024 }),
    );
    expect(tx.manualPayment.create).toHaveBeenCalledWith({
      data: {
        bookingId: 'booking-1',
        amount: 12500,
        status: 'PENDING_VERIFICATION',
      },
    });
  });

  it('rejects a proof path outside JPG and PNG before saving it', async () => {
    const prisma = {
      booking: {
        findFirst: jest
          .fn()
          .mockResolvedValue({
            id: 'booking-1',
            status: 'PENDING',
            totalAmount: 1,
            manualPayment: null,
          }),
      },
    };
    const storage = { assertOwnedFile: jest.fn() };
    const service = new PaymentService(
      prisma as never,
      { get: jest.fn() } as never,
      { emit: jest.fn() } as never,
      storage as never,
    );

    await expect(
      service.submit('booking-1', 'renter-1', {
        path: 'renter-1/booking-1/proof.webp',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(storage.assertOwnedFile).not.toHaveBeenCalled();
  });

  it('requires a rejection reason', async () => {
    const service = new PaymentService(
      {} as never,
      {} as never,
      { emit: jest.fn() } as never,
      {} as never,
    );
    expect(() =>
      service.reject('payment-1', 'admin-1', { reason: '   ' }),
    ).toThrow(BadRequestException);
  });
});
