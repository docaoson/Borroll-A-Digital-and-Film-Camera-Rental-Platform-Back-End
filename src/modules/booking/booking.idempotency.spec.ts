import { BookingService } from './booking.service';
import { CreateBookingDto } from './dto/booking.dto';

describe('BookingService - Idempotency Key', () => {
  let service: BookingService;
  let mockPrisma: any;
  let mockConfigService: any;
  let mockEventEmitter: any;
  let mockPricingService: any;
  let mockInventoryService: any;
  let mockStorageService: any;
  let executionCount = 0;

  beforeEach(() => {
    executionCount = 0;
    mockPrisma = {
      $transaction: jest.fn().mockImplementation(async (cb) => {
        executionCount++;
        const tx = {
          $queryRaw: jest.fn().mockResolvedValue([]),
          booking: {
            create: jest.fn().mockResolvedValue({
              id: `booking-${executionCount}`,
              code: `BK-TEST-${executionCount}`,
              handovers: [],
              payments: [],
              units: [],
              addons: [],
              statusLogs: [],
            }),
          },
          auditLog: {
            create: jest.fn().mockResolvedValue({ id: 'audit-1' }),
          },
        };
        return cb(tx);
      }),
    };

    mockConfigService = {
      get: jest.fn().mockReturnValue(24),
    };

    mockEventEmitter = {
      emit: jest.fn(),
    };

    mockPricingService = {
      calculateQuote: jest.fn().mockResolvedValue({
        branch: { id: 'branch-1' },
        lines: [{ modelId: 'm1', rentalAmount: 100000, depositAmount: 500000, pricePerDay: 100000 }],
        addons: [],
        days: 3,
        rentalAmount: 100000,
        addonsAmount: 0,
        depositAmount: 500000,
        totalDueAtPickup: 600000,
        startDateObj: new Date('2026-12-01'),
        endDateObj: new Date('2026-12-04'),
      }),
    };

    mockInventoryService = {
      findAndLockAvailableUnit: jest.fn().mockResolvedValue({ id: 'unit-1' }),
    };

    mockStorageService = {
      createSignedUrl: jest.fn().mockResolvedValue('https://example.com/photo.jpg'),
    };

    service = new BookingService(
      mockPrisma,
      mockConfigService,
      mockEventEmitter,
      mockPricingService,
      mockInventoryService,
      mockStorageService,
    );

    // Mock formatBookingDetail to return booking with its id
    jest.spyOn(service, 'formatBookingDetail').mockImplementation(async (booking: any) => ({
      ...booking,
      formatted: true,
    }));
  });

  it('reuses identical booking and prevents duplicate database transactions when called with the same idempotency key', async () => {
    const dto: CreateBookingDto = {
      branchSlug: 'tay-ho',
      startDate: '2026-12-01',
      endDate: '2026-12-04',
      items: [{ modelId: 'm1' }],
      addons: [],
      contactName: 'Nguyen Van A',
      contactPhone: '0912345678',
      note: 'Giao giờ hành chính',
      setupPlanId: null,
      idempotencyKey: 'test-idemp-12345',
    };

    // Simulate 2 rapid concurrent clicks with the exact same idempotency key
    const [res1, res2] = await Promise.all([
      service.createBooking('user-1', dto, 'test-idemp-12345'),
      service.createBooking('user-1', dto, 'test-idemp-12345'),
    ]);

    // Both should receive the exact same booking
    expect(res1.id).toBe('booking-1');
    expect(res2.id).toBe('booking-1');
    expect(res1.code).toBe(res2.code);

    // Database transaction should only execute ONCE
    expect(executionCount).toBe(1);

    // A third call after completion should also return the cached booking
    const res3 = await service.createBooking('user-1', dto, 'test-idemp-12345');
    expect(res3.id).toBe('booking-1');
    expect(executionCount).toBe(1);
  });

  it('executes separate transactions when idempotency keys differ', async () => {
    const dto1: CreateBookingDto = {
      branchSlug: 'tay-ho',
      startDate: '2026-12-01',
      endDate: '2026-12-04',
      items: [{ modelId: 'm1' }],
      addons: [],
      contactName: 'Nguyen Van A',
      contactPhone: '0912345678',
      note: null,
      setupPlanId: null,
    };

    const res1 = await service.createBooking('user-1', dto1, 'key-A');
    const res2 = await service.createBooking('user-1', dto1, 'key-B');

    expect(res1.id).toBe('booking-1');
    expect(res2.id).toBe('booking-2');
    expect(executionCount).toBe(2);
  });
});
