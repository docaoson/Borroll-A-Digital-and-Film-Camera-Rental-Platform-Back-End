import {
  BadRequestException,
  INestApplication,
  ValidationError,
  ValidationPipe,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import {
  BookingStatus,
  CameraType,
  ModelKind,
  PaymentMethod,
  PaymentType,
  Role,
  UnitStatus,
  UserStatus,
} from '@prisma/client';
import * as argon2 from 'argon2';
import cookieParser from 'cookie-parser';
import type { Server } from 'http';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { HttpExceptionFilter } from '../../src/common/filters/http-exception.filter';
import { getTodayVietnamIso } from '../../src/common/utils/date.util';
import {
  assertSafeE2eDatabase,
  cleanupE2eData,
} from '../../src/common/utils/e2e-cleanup.util';
import { PrismaService } from '../../src/infra/database/prisma.service';
import { STORAGE_SERVICE } from '../../src/infra/storage/storage.service';
import { BookingService } from '../../src/modules/booking';

jest.setTimeout(60000);

interface ErrorBody {
  error: { code: string; message: string; details: Record<string, unknown> };
}
interface QuoteBody {
  days: number;
  available: boolean;
  rentalAmount: number;
  addonsAmount: number;
  depositAmount: number;
  totalDueAtPickup: number;
}
interface BookingBody {
  id: string;
  status: string;
  allowedActions: string[];
  payments: Array<{ type: string; amount: number }>;
}
interface PresignBody {
  path: string;
}
interface ModelsBody {
  items: Array<{ name: string }>;
  facets: { price: unknown[] };
}

function addDaysIso(baseIso: string, deltaDays: number): string {
  const [y, m, d] = baseIso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + deltaDays));
  return dt.toISOString().slice(0, 10);
}

describe('Store Operations, Catalog, Inventory & Booking (e2e)', () => {
  let app: INestApplication;
  let httpServer: Server;
  let prisma: PrismaService;
  let jwtService: JwtService;
  let configService: ConfigService;
  let bookingService: BookingService;

  const ts = Date.now();
  const prefix = `e2e_${ts}`;
  const todayIso = getTodayVietnamIso();

  let branchId = '';
  const branchSlug = `${prefix}-branch`;
  const inactiveBranchSlug = `${prefix}-branch-inactive`;
  let parentCatId = '';
  let childCatId = '';
  let lensCatId = '';
  const inactiveCatSlug = `${prefix}-cat-inactive`;
  let brandId = '';
  const inactiveBrandSlug = `${prefix}-brand-inactive`;
  let model1UnitId = '';
  let model2UnitId = '';
  let inactiveModelId = '';
  let lensWrongMountId = '';
  let unit1Id = '';
  let filmId = '';
  let inactiveFilmId = '';
  let initialContactSetting: {
    zaloOaId: string | null;
    zaloPhone: string | null;
    messengerPage: string | null;
    instagramHandle: string | null;
    hotline: string | null;
    welcomeMessage: string | null;
    isChatEnabled: boolean;
    updatedBy: string | null;
  } | null = null;

  let adminId = '';
  let customer1Token = '';
  let customer2Token = '';
  let staffToken = '';
  let adminToken = '';

  const uploadedMockPaths = new Set<string>();

  const mockStorageService = {
    createUploadUrl: (bucket: string, path: string) => {
      uploadedMockPaths.add(path);
      return Promise.resolve({
        uploadUrl: `https://mock.storage/${bucket}/${path}`,
        path,
        token: 'mock-token',
      });
    },
    getPublicUrl: (bucket: string, path: string) =>
      `https://mock.storage/public/${bucket}/${path}`,
    createSignedUrl: (bucket: string, path: string) =>
      Promise.resolve(`https://mock.storage/signed/${bucket}/${path}`),
    assertOwnedFile: (
      _bucket: string,
      path: string,
      expectedPrefix: string,
    ) => {
      if (!path.startsWith(expectedPrefix)) {
        return Promise.reject(
          new BadRequestException({
            code: 'VALIDATION_ERROR',
            message: 'Đường dẫn tệp tin không hợp lệ.',
            details: {},
          }),
        );
      }
      return Promise.resolve();
    },
    remove: () => Promise.resolve(),
  };

  beforeAll(async () => {
    assertSafeE2eDatabase();
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(STORAGE_SERVICE)
      .useValue(mockStorageService)
      .compile();

    app = moduleFixture.createNestApplication();
    prisma = app.get(PrismaService);
    jwtService = app.get(JwtService);
    configService = app.get(ConfigService);
    bookingService = app.get(BookingService);

    app.use(cookieParser());
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        exceptionFactory: (errors: ValidationError[]) => {
          const fields: Record<string, string> = {};
          for (const err of errors) {
            if (err.constraints) {
              fields[err.property] = Object.values(err.constraints)[0];
            }
          }
          return new BadRequestException({
            code: 'VALIDATION_ERROR',
            message: 'Dữ liệu gửi lên không hợp lệ.',
            details: { fields },
          });
        },
      }),
    );
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
    httpServer = app.getHttpServer() as Server;

    const secret = configService.get<string>('JWT_ACCESS_SECRET');
    const pwHash = await argon2.hash('Password123!');

    const createTestUser = async (suffix: string, roles: Role[]) => {
      const email = `${prefix}_${suffix}@example.test`;
      const user = await prisma.user.create({
        data: {
          email,
          fullName: `${prefix} User ${suffix}`,
          phone: '0912345678',
          passwordHash: pwHash,
          status: UserStatus.ACTIVE,
          roles: { create: roles.map((role) => ({ role })) },
        },
      });
      const token = await jwtService.signAsync(
        { sub: user.id, roles, email },
        { secret, expiresIn: '15m' },
      );
      return { id: user.id, token };
    };

    initialContactSetting = await prisma.contactSetting.findUnique({
      where: { id: 'default' },
      select: {
        zaloOaId: true,
        zaloPhone: true,
        messengerPage: true,
        instagramHandle: true,
        hotline: true,
        welcomeMessage: true,
        isChatEnabled: true,
        updatedBy: true,
      },
    });

    const [c1, c2, st, ad] = await Promise.all([
      createTestUser('c1', [Role.RENTER]),
      createTestUser('c2', [Role.RENTER]),
      createTestUser('st', [Role.STAFF]),
      createTestUser('ad', [Role.ADMIN]),
    ]);
    customer1Token = c1.token;
    customer2Token = c2.token;
    staffToken = st.token;
    adminId = ad.id;
    adminToken = ad.token;

    const branch = await prisma.branch.create({
      data: {
        name: `${prefix} Branch Active`,
        slug: branchSlug,
        address: 'Ha Noi',
        phone: '0900000000',
        openHours: '09:00 - 21:00',
        isActive: true,
      },
    });
    branchId = branch.id;

    await prisma.branch.create({
      data: {
        name: `${prefix} Branch Inactive`,
        slug: inactiveBranchSlug,
        address: 'Ha Noi',
        phone: '0900000001',
        openHours: '09:00 - 21:00',
        isActive: false,
      },
    });

    const pCat = await prisma.category.create({
      data: {
        name: `${prefix} Máy ảnh`,
        slug: `${prefix}-root-cam`,
        isActive: true,
      },
    });
    parentCatId = pCat.id;
    const cCat = await prisma.category.create({
      data: {
        name: `${prefix} Film SLR`,
        slug: `${prefix}-film-slr`,
        parentId: parentCatId,
        isActive: true,
      },
    });
    childCatId = cCat.id;
    const lCat = await prisma.category.create({
      data: {
        name: `${prefix} Ống kính`,
        slug: `${prefix}-lens`,
        isActive: true,
      },
    });
    lensCatId = lCat.id;

    await prisma.category.create({
      data: {
        name: `${prefix} Danh mục ẩn`,
        slug: inactiveCatSlug,
        isActive: false,
      },
    });

    const brand = await prisma.brand.create({
      data: {
        name: `${prefix} Fujifilm`,
        slug: `${prefix}-fuji`,
        isActive: true,
      },
    });
    brandId = brand.id;

    await prisma.brand.create({
      data: {
        name: `${prefix} Hãng ẩn`,
        slug: inactiveBrandSlug,
        isActive: false,
      },
    });

    const m1 = await prisma.rentalModel.create({
      data: {
        kind: ModelKind.CAMERA,
        cameraType: CameraType.FILM,
        categoryId: childCatId,
        brandId,
        slug: `${prefix}-m1`,
        name: `${prefix} Máy ảnh Fuji Single`,
        description: 'Single unit model',
        mount: 'X',
        pricePerDay: 200000,
        pricePerWeek: 1000000,
        deposit: 2000000,
      },
    });
    model1UnitId = m1.id;

    const m2 = await prisma.rentalModel.create({
      data: {
        kind: ModelKind.CAMERA,
        cameraType: CameraType.DIGITAL,
        categoryId: childCatId,
        brandId,
        slug: `${prefix}-m2`,
        name: `${prefix} Máy ảnh Fuji Double`,
        description: 'Two unit model',
        mount: 'E',
        pricePerDay: 350000,
        pricePerWeek: 2000000,
        deposit: 3000000,
      },
    });
    model2UnitId = m2.id;

    const mHidden = await prisma.rentalModel.create({
      data: {
        kind: ModelKind.CAMERA,
        cameraType: CameraType.DIGITAL,
        categoryId: childCatId,
        brandId,
        slug: `${prefix}-hidden`,
        name: `${prefix} Hidden`,
        description: 'Hidden',
        isActive: false,
        pricePerDay: 100000,
        deposit: 1000000,
      },
    });
    inactiveModelId = mHidden.id;

    const lensWrong = await prisma.rentalModel.create({
      data: {
        kind: ModelKind.LENS,
        categoryId: lensCatId,
        brandId,
        slug: `${prefix}-lens-rf`,
        name: `${prefix} Lens RF`,
        description: 'RF Lens',
        mount: 'RF',
        pricePerDay: 150000,
        deposit: 1500000,
      },
    });
    lensWrongMountId = lensWrong.id;

    const u1 = await prisma.rentalUnit.create({
      data: {
        modelId: model1UnitId,
        branchId,
        serialNumber: `${prefix}-U1`,
        status: UnitStatus.AVAILABLE,
      },
    });
    unit1Id = u1.id;

    await prisma.rentalUnit.create({
      data: {
        modelId: model2UnitId,
        branchId,
        serialNumber: `${prefix}-U2A`,
        status: UnitStatus.AVAILABLE,
      },
    });

    await prisma.rentalUnit.create({
      data: {
        modelId: model2UnitId,
        branchId,
        serialNumber: `${prefix}-U2B`,
        status: UnitStatus.AVAILABLE,
      },
    });

    const film = await prisma.filmProduct.create({
      data: {
        name: `${prefix} Kodak Gold`,
        iso: 200,
        format: '35mm',
        price: 180000,
        inStock: true,
        isActive: true,
      },
    });
    filmId = film.id;

    const inactiveFilm = await prisma.filmProduct.create({
      data: {
        name: `${prefix} Kodak Inactive`,
        iso: 400,
        format: '35mm',
        price: 220000,
        inStock: true,
        isActive: false,
      },
    });
    inactiveFilmId = inactiveFilm.id;
  });

  afterAll(async () => {
    try {
      if (prisma) {
        if (initialContactSetting) {
          await prisma.contactSetting.upsert({
            where: { id: 'default' },
            update: {
              ...initialContactSetting,
            },
            create: {
              id: 'default',
              ...initialContactSetting,
            },
          });
        }
        await cleanupE2eData(prisma, { prefix });
      }
    } finally {
      if (app) {
        await app.close();
      }
    }
  });

  it('calculates pricing (1d, 3d, 7d, 8d weekly rate + addons) and validates quote vs booking', async () => {
    const start = addDaysIso(todayIso, 20);
    const end8 = addDaysIso(todayIso, 28); // 8 days => 1 week (1,000,000) + 1 day (200,000) = 1,200,000

    const quoteRes = await request(httpServer)
      .post('/api/v1/bookings/quote')
      .send({
        branchSlug,
        startDate: start,
        endDate: end8,
        items: [{ modelId: model1UnitId }],
        addons: [{ filmProductId: filmId, quantity: 2 }],
      })
      .expect(200);

    const quoteBody = quoteRes.body as QuoteBody;
    expect(quoteBody.days).toBe(8);
    expect(quoteBody.rentalAmount).toBe(1200000);
    expect(quoteBody.addonsAmount).toBe(360000);
    expect(quoteBody.depositAmount).toBe(2000000);
    expect(quoteBody.totalDueAtPickup).toBe(3560000);
    expect(quoteBody.available).toBe(true);
  });

  it('rejects INCOMPATIBLE_ITEMS (422) and MODEL_NOT_BOOKABLE (422)', async () => {
    const start = addDaysIso(todayIso, 30);
    const end = addDaysIso(todayIso, 32);

    const incompatible = await request(httpServer)
      .post('/api/v1/bookings/quote')
      .send({
        branchSlug,
        startDate: start,
        endDate: end,
        items: [{ modelId: model1UnitId }, { modelId: lensWrongMountId }],
      })
      .expect(422);
    expect((incompatible.body as ErrorBody).error.code).toBe(
      'INCOMPATIBLE_ITEMS',
    );

    const hidden = await request(httpServer)
      .post('/api/v1/bookings/quote')
      .send({
        branchSlug,
        startDate: start,
        endDate: end,
        items: [{ modelId: inactiveModelId }],
      })
      .expect(422);
    expect((hidden.body as ErrorBody).error.code).toBe('MODEL_NOT_BOOKABLE');
  });

  it('handles concurrent bookings for 1-unit and 2-unit models without double-booking', async () => {
    const start = addDaysIso(todayIso, 40);
    const end = addDaysIso(todayIso, 43);

    // 2 concurrent requests on 1-unit model
    const singleResults = await Promise.all([
      request(httpServer)
        .post('/api/v1/bookings')
        .set('Authorization', `Bearer ${customer1Token}`)
        .send({
          branchSlug,
          startDate: start,
          endDate: end,
          items: [{ modelId: model1UnitId }],
          addons: [],
          contactName: `${prefix} C1`,
          contactPhone: '0912345678',
        }),
      request(httpServer)
        .post('/api/v1/bookings')
        .set('Authorization', `Bearer ${customer2Token}`)
        .send({
          branchSlug,
          startDate: start,
          endDate: end,
          items: [{ modelId: model1UnitId }],
          addons: [],
          contactName: `${prefix} C2`,
          contactPhone: '0912345679',
        }),
    ]);

    const statuses1 = singleResults.map((r) => r.status).sort();
    expect(statuses1).toEqual([201, 409]);

    // Adjacent booking starting exactly on endDate must succeed (half-open [start, end))
    const adjacentRes = await request(httpServer)
      .post('/api/v1/bookings')
      .set('Authorization', `Bearer ${customer2Token}`)
      .send({
        branchSlug,
        startDate: end,
        endDate: addDaysIso(end, 2),
        items: [{ modelId: model1UnitId }],
        addons: [],
        contactName: `${prefix} C2 Adj`,
        contactPhone: '0912345679',
      })
      .expect(201);
    expect((adjacentRes.body as BookingBody).status).toBe('PENDING');

    // 3 concurrent requests on 2-unit model => 2 succeed, 1 fails with 409
    const doubleResults = await Promise.all([
      request(httpServer)
        .post('/api/v1/bookings')
        .set('Authorization', `Bearer ${customer1Token}`)
        .send({
          branchSlug,
          startDate: start,
          endDate: end,
          items: [{ modelId: model2UnitId }],
          addons: [],
          contactName: `${prefix} D1`,
          contactPhone: '0912345678',
        }),
      request(httpServer)
        .post('/api/v1/bookings')
        .set('Authorization', `Bearer ${customer2Token}`)
        .send({
          branchSlug,
          startDate: start,
          endDate: end,
          items: [{ modelId: model2UnitId }],
          addons: [],
          contactName: `${prefix} D2`,
          contactPhone: '0912345679',
        }),
      request(httpServer)
        .post('/api/v1/bookings')
        .set('Authorization', `Bearer ${customer1Token}`)
        .send({
          branchSlug,
          startDate: start,
          endDate: end,
          items: [{ modelId: model2UnitId }],
          addons: [],
          contactName: `${prefix} D3`,
          contactPhone: '0912345678',
        }),
    ]);

    const statuses2 = doubleResults.map((r) => r.status).sort();
    expect(statuses2).toEqual([201, 201, 409]);
  });

  it('enforces RBAC, ownership (404), state machine, pickup/return/complete & ledger rules', async () => {
    const start = addDaysIso(todayIso, 60);
    const end = addDaysIso(todayIso, 62);

    const createRes = await request(httpServer)
      .post('/api/v1/bookings')
      .set('Authorization', `Bearer ${customer1Token}`)
      .send({
        branchSlug,
        startDate: start,
        endDate: end,
        items: [{ modelId: model1UnitId }],
        addons: [{ filmProductId: filmId, quantity: 1 }],
        contactName: `${prefix} Customer One`,
        contactPhone: '0912345678',
      })
      .expect(201);

    const createdBody = createRes.body as BookingBody;
    const bookingId = createdBody.id;
    expect(createdBody.allowedActions).toEqual(['cancel']);

    // Customer 2 cannot view Customer 1's booking => 404
    await request(httpServer)
      .get(`/api/v1/bookings/${bookingId}`)
      .set('Authorization', `Bearer ${customer2Token}`)
      .expect(404);

    // Customer cannot access /staff/* or /admin/*
    await request(httpServer)
      .get('/api/v1/staff/dashboard')
      .set('Authorization', `Bearer ${customer1Token}`)
      .expect(403);
    await request(httpServer)
      .get('/api/v1/admin/users')
      .set('Authorization', `Bearer ${staffToken}`)
      .expect(403);

    // Invalid transition: pickup while PENDING => 409
    const presignRes = await request(httpServer)
      .post('/api/v1/staff/handover-photos/presign')
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ bookingId, contentType: 'image/jpeg' })
      .expect(200);
    const photoPath = (presignRes.body as PresignBody).path;

    await request(httpServer)
      .post(`/api/v1/staff/bookings/${bookingId}/pickup`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({
        checklist: [{ item: 'Body', ok: true }],
        photoPaths: [photoPath],
        idChecked: true,
        payments: [],
      })
      .expect(409);

    // Confirm PENDING -> CONFIRMED
    const confirmRes = await request(httpServer)
      .post(`/api/v1/staff/bookings/${bookingId}/confirm`)
      .set('Authorization', `Bearer ${staffToken}`)
      .expect(200);
    const confirmBody = confirmRes.body as BookingBody;
    expect(confirmBody.status).toBe('CONFIRMED');
    expect(confirmBody.allowedActions).toEqual(['pickup', 'cancel']);

    // Pickup missing idChecked => 400
    await request(httpServer)
      .post(`/api/v1/staff/bookings/${bookingId}/pickup`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({
        checklist: [{ item: 'Body', ok: true }],
        photoPaths: [photoPath],
        idChecked: false,
        payments: [
          {
            type: PaymentType.DEPOSIT_RECEIVED,
            amount: 2000000,
            method: PaymentMethod.CASH,
          },
          {
            type: PaymentType.RENTAL_RECEIVED,
            amount: 580000,
            method: PaymentMethod.CASH,
          },
        ],
      })
      .expect(400);

    // Pickup underpaid => 422 PAYMENT_INCOMPLETE
    const underpaid = await request(httpServer)
      .post(`/api/v1/staff/bookings/${bookingId}/pickup`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({
        checklist: [{ item: 'Body', ok: true }],
        photoPaths: [photoPath],
        idChecked: true,
        payments: [
          {
            type: PaymentType.DEPOSIT_RECEIVED,
            amount: 1000000,
            method: PaymentMethod.CASH,
          },
          {
            type: PaymentType.RENTAL_RECEIVED,
            amount: 580000,
            method: PaymentMethod.CASH,
          },
        ],
      })
      .expect(422);
    expect((underpaid.body as ErrorBody).error.code).toBe('PAYMENT_INCOMPLETE');

    // Valid pickup
    const pickupRes = await request(httpServer)
      .post(`/api/v1/staff/bookings/${bookingId}/pickup`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({
        checklist: [{ item: 'Body', ok: true }],
        photoPaths: [photoPath],
        idChecked: true,
        payments: [
          {
            type: PaymentType.DEPOSIT_RECEIVED,
            amount: 2000000,
            method: PaymentMethod.CASH,
          },
          {
            type: PaymentType.RENTAL_RECEIVED,
            amount: 580000,
            method: PaymentMethod.BANK_TRANSFER,
          },
        ],
      })
      .expect(200);
    const pickupBody = pickupRes.body as BookingBody;
    expect(pickupBody.status).toBe('PICKED_UP');
    expect(pickupBody.allowedActions).toEqual(['return']);

    // Return
    const returnRes = await request(httpServer)
      .post(`/api/v1/staff/bookings/${bookingId}/return`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({
        checklist: [{ item: 'Body', ok: true }],
        photoPaths: [photoPath],
      })
      .expect(200);
    const returnBody = returnRes.body as BookingBody;
    expect(returnBody.status).toBe('RETURNED');
    expect(returnBody.allowedActions).toEqual(['complete']);

    // Complete with charges > deposit => 400
    await request(httpServer)
      .post(`/api/v1/staff/bookings/${bookingId}/complete`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({
        charges: [
          { type: PaymentType.DAMAGE_CHARGE, amount: 2500000, note: 'Broken' },
        ],
        refundMethod: PaymentMethod.CASH,
      })
      .expect(400);

    // Complete with valid charge => refund = 2,000,000 - 200,000 = 1,800,000
    const completeRes = await request(httpServer)
      .post(`/api/v1/staff/bookings/${bookingId}/complete`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({
        charges: [
          { type: PaymentType.DAMAGE_CHARGE, amount: 200000, note: 'Scratch' },
        ],
        refundMethod: PaymentMethod.CASH,
      })
      .expect(200);
    const completeBody = completeRes.body as BookingBody;
    expect(completeBody.status).toBe('COMPLETED');
    expect(completeBody.allowedActions).toEqual([]);
    const refundPayment = completeBody.payments.find(
      (p) => p.type === 'DEPOSIT_REFUNDED',
    );
    expect(refundPayment?.amount).toBe(1800000);

    // Unit is now released and can be booked again on the same dates
    await request(httpServer)
      .post('/api/v1/bookings')
      .set('Authorization', `Bearer ${customer2Token}`)
      .send({
        branchSlug,
        startDate: start,
        endDate: end,
        items: [{ modelId: model1UnitId }],
        addons: [],
        contactName: `${prefix} Customer Two`,
        contactPhone: '0912345679',
      })
      .expect(201);
  });

  it('prevents overlapping maintenance block and handles concurrent booking vs unit-block', async () => {
    const start = addDaysIso(todayIso, 80);
    const end = addDaysIso(todayIso, 83);

    const raceResults = await Promise.all([
      request(httpServer)
        .post('/api/v1/bookings')
        .set('Authorization', `Bearer ${customer1Token}`)
        .send({
          branchSlug,
          startDate: start,
          endDate: end,
          items: [{ modelId: model1UnitId }],
          addons: [],
          contactName: `${prefix} Race User`,
          contactPhone: '0912345678',
        }),
      request(httpServer)
        .post('/api/v1/staff/unit-blocks')
        .set('Authorization', `Bearer ${staffToken}`)
        .send({
          unitId: unit1Id,
          startDate: start,
          endDate: end,
          reason: `${prefix} Bảo trì race test`,
        }),
    ]);

    const successCount = raceResults.filter((r) => r.status === 201).length;
    const conflictCount = raceResults.filter((r) => r.status === 409).length;
    expect(successCount).toBe(1);
    expect(conflictCount).toBe(1);
  });

  it('supports unaccented search, parent category filtering, facets, and expires pending bookings', async () => {
    const searchRes = await request(httpServer)
      .get('/api/v1/models')
      .query({ q: 'may anh fuji', category: `${prefix}-root-cam` })
      .expect(200);

    const searchBody = searchRes.body as ModelsBody;
    const names = searchBody.items.map((i) => i.name);
    expect(names).toContain(`${prefix} Máy ảnh Fuji Single`);
    expect(searchBody.facets.price.length).toBe(4);

    // Expire pending booking test
    const start = addDaysIso(todayIso, 95);
    const end = addDaysIso(todayIso, 97);
    const bkRes = await request(httpServer)
      .post('/api/v1/bookings')
      .set('Authorization', `Bearer ${customer1Token}`)
      .send({
        branchSlug,
        startDate: start,
        endDate: end,
        items: [{ modelId: model1UnitId }],
        addons: [],
        contactName: `${prefix} Expire Test`,
        contactPhone: '0912345678',
      })
      .expect(201);

    const bkId = (bkRes.body as BookingBody).id;
    await prisma.booking.update({
      where: { id: bkId },
      data: { expiresAt: new Date(Date.now() - 60000) },
    });

    const expired = await bookingService.expirePendingBookings();
    expect(expired).toBeGreaterThanOrEqual(1);

    const afterExpire = await prisma.booking.findUnique({
      where: { id: bkId },
    });
    expect(afterExpire?.status).toBe(BookingStatus.CANCELLED);

    // Admin cannot remove own ADMIN role
    await request(httpServer)
      .patch(`/api/v1/admin/users/${adminId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ roles: [Role.STAFF] })
      .expect(400);
  });

  it('returns only active (is_active = true) records for GET /branches, /categories, /brands, and /film-products', async () => {
    const [branchesRes, categoriesRes, brandsRes, filmsRes] = await Promise.all(
      [
        request(httpServer).get('/api/v1/branches').expect(200),
        request(httpServer).get('/api/v1/categories').expect(200),
        request(httpServer).get('/api/v1/brands').expect(200),
        request(httpServer).get('/api/v1/film-products').expect(200),
      ],
    );

    const branchSlugs = (
      branchesRes.body as { items: Array<{ slug: string }> }
    ).items.map((b) => b.slug);
    expect(branchSlugs).toContain(branchSlug);
    expect(branchSlugs).not.toContain(inactiveBranchSlug);

    const flattenCategorySlugs = (
      nodes: Array<{ slug: string; children?: Array<{ slug: string }> }>,
    ): string[] =>
      nodes.flatMap((n) => [
        n.slug,
        ...(n.children ? flattenCategorySlugs(n.children) : []),
      ]);
    const categorySlugs = flattenCategorySlugs(
      (
        categoriesRes.body as {
          items: Array<{ slug: string; children?: Array<{ slug: string }> }>;
        }
      ).items,
    );
    expect(categorySlugs).toContain(`${prefix}-root-cam`);
    expect(categorySlugs).toContain(`${prefix}-film-slr`);
    expect(categorySlugs).not.toContain(inactiveCatSlug);

    const brandSlugs = (
      brandsRes.body as { items: Array<{ slug: string }> }
    ).items.map((b) => b.slug);
    expect(brandSlugs).toContain(`${prefix}-fuji`);
    expect(brandSlugs).not.toContain(inactiveBrandSlug);

    const filmIds = (
      filmsRes.body as { items: Array<{ id: string }> }
    ).items.map((f) => f.id);
    expect(filmIds).toContain(filmId);
    expect(filmIds).not.toContain(inactiveFilmId);
  });

  it('enforces RBAC, URL/script validation, cache invalidation, and null handling on contact-settings', async () => {
    const validPayload = {
      zaloOaId: '123456789012345',
      zaloPhone: '0912345678',
      messengerPage: 'borroll.camera',
      instagramHandle: 'borroll.camera',
      hotline: '0912345678',
      welcomeMessage: 'Xin chào! BORROLL hỗ trợ thuê máy ảnh.',
      isChatEnabled: true,
    };

    // Guest (unauthenticated) => 401
    await request(httpServer)
      .put('/api/v1/admin/contact-settings')
      .send(validPayload)
      .expect(401);

    // Renter => 403
    await request(httpServer)
      .put('/api/v1/admin/contact-settings')
      .set('Authorization', `Bearer ${customer1Token}`)
      .send(validPayload)
      .expect(403);

    // Staff => 403
    await request(httpServer)
      .put('/api/v1/admin/contact-settings')
      .set('Authorization', `Bearer ${staffToken}`)
      .send(validPayload)
      .expect(403);

    // Reject URL in input => 400
    await request(httpServer)
      .put('/api/v1/admin/contact-settings')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        ...validPayload,
        messengerPage: 'https://m.me/borroll.camera',
      })
      .expect(400);

    await request(httpServer)
      .put('/api/v1/admin/contact-settings')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        ...validPayload,
        zaloPhone: 'https://zalo.me/0912345678',
      })
      .expect(400);

    await request(httpServer)
      .put('/api/v1/admin/contact-settings')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        ...validPayload,
        welcomeMessage: 'Truy cập https://evil.example.com ngay',
      })
      .expect(400);

    // Reject HTML / script characters => 400
    await request(httpServer)
      .put('/api/v1/admin/contact-settings')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        ...validPayload,
        welcomeMessage: '<script>alert("xss")</script>',
      })
      .expect(400);

    // Admin valid PUT => 200 and GET reflects immediately
    await request(httpServer)
      .put('/api/v1/admin/contact-settings')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(validPayload)
      .expect(200);

    const getRes = await request(httpServer)
      .get('/api/v1/contact-settings')
      .expect(200);

    const getBody = getRes.body as {
      chatEnabled: boolean;
      welcomeMessage: string | null;
      zalo: { oaId: string | null; url: string | null };
      messenger: { url: string | null };
      instagram: { handle: string | null; url: string | null };
      hotline: string | null;
      branches: Array<{ slug: string; name: string; phone: string }>;
    };

    expect(getBody.chatEnabled).toBe(true);
    expect(getBody.welcomeMessage).toBe(
      'Xin chào! BORROLL hỗ trợ thuê máy ảnh.',
    );
    expect(getBody.zalo).toEqual({
      oaId: '123456789012345',
      url: 'https://zalo.me/0912345678',
    });
    expect(getBody.messenger).toEqual({
      url: 'https://m.me/borroll.camera',
    });
    expect(getBody.instagram).toEqual({
      handle: 'borroll.camera',
      url: 'https://instagram.com/borroll.camera',
    });
    expect(getBody.hotline).toBe('0912345678');
    expect(Array.isArray(getBody.branches)).toBe(true);
    expect(
      getBody.branches.some(
        (b) => b.slug === branchSlug && b.phone === '0900000000',
      ),
    ).toBe(true);

    // Null fields return null
    await request(httpServer)
      .put('/api/v1/admin/contact-settings')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        zaloOaId: null,
        zaloPhone: null,
        messengerPage: null,
        instagramHandle: null,
        hotline: null,
        welcomeMessage: null,
        isChatEnabled: false,
      })
      .expect(200);

    const nullRes = await request(httpServer)
      .get('/api/v1/contact-settings')
      .expect(200);

    const nullBody = nullRes.body as typeof getBody;
    expect(nullBody.chatEnabled).toBe(false);
    expect(nullBody.welcomeMessage).toBeNull();
    expect(nullBody.zalo).toEqual({ oaId: null, url: null });
    expect(nullBody.messenger).toEqual({ url: null });
    expect(nullBody.instagram).toEqual({ handle: null, url: null });
    expect(nullBody.hotline).toBeNull();
  });
});
