import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

export interface E2eCleanupOptions {
  prefix?: string;
  includeExampleTestEmails?: boolean;
}

export interface E2eTargetIds {
  userIds: string[];
  branchIds: string[];
  categoryIds: string[];
  brandIds: string[];
  modelIds: string[];
  unitIds: string[];
  unitBlockIds: string[];
  filmProductIds: string[];
  bookingIds: string[];
  auditLogIds: string[];
}

export interface E2eRecordCounts {
  bookings: number;
  unitBlocks: number;
  rentalUnits: number;
  rentalModels: number;
  filmProducts: number;
  categories: number;
  brands: number;
  branches: number;
  users: number;
  auditLogs: number;
  total: number;
}

export function isRemoteSupabaseDatabaseUrl(rawUrl?: string): boolean {
  if (!rawUrl) return false;
  try {
    const parsed = new URL(rawUrl);
    return /(^|\.)supabase\.com$/i.test(parsed.hostname);
  } catch {
    return /supabase\.com/i.test(rawUrl);
  }
}

function readDotEnvKey(key: string): string | undefined {
  try {
    const envPath = path.resolve(process.cwd(), '.env');
    if (!fs.existsSync(envPath)) return undefined;
    const content = fs.readFileSync(envPath, 'utf8');
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const eqIdx = line.indexOf('=');
      if (eqIdx <= 0) continue;
      const k = line.slice(0, eqIdx).trim();
      if (k !== key) continue;
      let val = line.slice(eqIdx + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      return val;
    }
  } catch {
    // ignore read error
  }
  return undefined;
}

export function assertSafeE2eDatabase(
  env: NodeJS.ProcessEnv = process.env,
): void {
  const dbUrl =
    env.DATABASE_URL ??
    (env === process.env ? readDotEnvKey('DATABASE_URL') : undefined);
  const directUrl =
    env.DIRECT_URL ??
    (env === process.env ? readDotEnvKey('DIRECT_URL') : undefined);
  const allowRemote =
    env.ALLOW_E2E_ON_REMOTE ??
    (env === process.env ? readDotEnvKey('ALLOW_E2E_ON_REMOTE') : undefined);

  const isRemote =
    isRemoteSupabaseDatabaseUrl(dbUrl) ||
    isRemoteSupabaseDatabaseUrl(directUrl);

  if (isRemote && allowRemote !== 'true') {
    throw new Error(
      'Dừng chạy E2E: DATABASE_URL đang trỏ tới host supabase.com nhưng biến môi trường ALLOW_E2E_ON_REMOTE chưa được đặt là "true". Để tránh ghi hoặc xóa nhầm dữ liệu trên database thật, hãy dùng database test cục bộ hoặc đặt ALLOW_E2E_ON_REMOTE="true" nếu bạn chắc chắn.',
    );
  }
}

export async function collectE2eTargetIds(
  prisma: PrismaClient,
  options: E2eCleanupOptions = {},
): Promise<E2eTargetIds> {
  const prefix = options.prefix ?? 'e2e_';
  const includeExampleTestEmails = options.includeExampleTestEmails ?? false;

  const userOrConditions: Array<Record<string, unknown>> = [
    { email: { startsWith: prefix, mode: 'insensitive' } },
    { email: { contains: prefix, mode: 'insensitive' } },
    { fullName: { startsWith: prefix, mode: 'insensitive' } },
  ];
  if (includeExampleTestEmails) {
    userOrConditions.push({
      email: { endsWith: '@example.test', mode: 'insensitive' },
    });
  }

  const [users, branches, categories, brands, filmProducts] = await Promise.all(
    [
      prisma.user.findMany({
        where: { OR: userOrConditions },
        select: { id: true },
      }),
      prisma.branch.findMany({
        where: {
          OR: [
            { slug: { startsWith: prefix, mode: 'insensitive' } },
            { name: { startsWith: prefix, mode: 'insensitive' } },
            { name: { contains: prefix, mode: 'insensitive' } },
          ],
        },
        select: { id: true },
      }),
      prisma.category.findMany({
        where: {
          OR: [
            { slug: { startsWith: prefix, mode: 'insensitive' } },
            { name: { startsWith: prefix, mode: 'insensitive' } },
            { name: { contains: prefix, mode: 'insensitive' } },
          ],
        },
        select: { id: true },
      }),
      prisma.brand.findMany({
        where: {
          OR: [
            { slug: { startsWith: prefix, mode: 'insensitive' } },
            { name: { startsWith: prefix, mode: 'insensitive' } },
            { name: { contains: prefix, mode: 'insensitive' } },
          ],
        },
        select: { id: true },
      }),
      prisma.filmProduct.findMany({
        where: {
          OR: [
            { name: { startsWith: prefix, mode: 'insensitive' } },
            { name: { contains: prefix, mode: 'insensitive' } },
          ],
        },
        select: { id: true },
      }),
    ],
  );

  const userIds = users.map((u) => u.id);
  const branchIds = branches.map((b) => b.id);
  const categoryIds = categories.map((c) => c.id);
  const brandIds = brands.map((b) => b.id);
  const filmProductIds = filmProducts.map((f) => f.id);

  const models = await prisma.rentalModel.findMany({
    where: {
      OR: [
        { slug: { startsWith: prefix, mode: 'insensitive' } },
        { name: { startsWith: prefix, mode: 'insensitive' } },
        { name: { contains: prefix, mode: 'insensitive' } },
        ...(categoryIds.length > 0
          ? [{ categoryId: { in: categoryIds } }]
          : []),
        ...(brandIds.length > 0 ? [{ brandId: { in: brandIds } }] : []),
      ],
    },
    select: { id: true },
  });
  const modelIds = models.map((m) => m.id);

  const units = await prisma.rentalUnit.findMany({
    where: {
      OR: [
        { serialNumber: { startsWith: prefix, mode: 'insensitive' } },
        ...(branchIds.length > 0 ? [{ branchId: { in: branchIds } }] : []),
        ...(modelIds.length > 0 ? [{ modelId: { in: modelIds } }] : []),
      ],
    },
    select: { id: true },
  });
  const unitIds = units.map((u) => u.id);

  const unitBlocks = await prisma.unitBlock.findMany({
    where: {
      OR: [
        { reason: { startsWith: prefix, mode: 'insensitive' } },
        ...(unitIds.length > 0 ? [{ unitId: { in: unitIds } }] : []),
        ...(userIds.length > 0 ? [{ createdBy: { in: userIds } }] : []),
      ],
    },
    select: { id: true },
  });
  const unitBlockIds = unitBlocks.map((ub) => ub.id);

  const bookings = await prisma.booking.findMany({
    where: {
      OR: [
        { contactName: { startsWith: prefix, mode: 'insensitive' } },
        ...(userIds.length > 0 ? [{ userId: { in: userIds } }] : []),
        ...(branchIds.length > 0 ? [{ branchId: { in: branchIds } }] : []),
        ...(unitIds.length > 0
          ? [{ units: { some: { unitId: { in: unitIds } } } }]
          : []),
        ...(modelIds.length > 0
          ? [{ units: { some: { modelId: { in: modelIds } } } }]
          : []),
        ...(filmProductIds.length > 0
          ? [{ addons: { some: { filmProductId: { in: filmProductIds } } } }]
          : []),
      ],
    },
    select: { id: true },
  });
  const bookingIds = bookings.map((b) => b.id);

  const allEntityIds = [
    ...userIds,
    ...branchIds,
    ...categoryIds,
    ...brandIds,
    ...modelIds,
    ...unitIds,
    ...unitBlockIds,
    ...filmProductIds,
    ...bookingIds,
  ];

  const auditLogs =
    userIds.length > 0 || allEntityIds.length > 0
      ? await prisma.auditLog.findMany({
          where: {
            OR: [
              ...(userIds.length > 0 ? [{ actorId: { in: userIds } }] : []),
              ...(allEntityIds.length > 0
                ? [{ targetId: { in: allEntityIds } }]
                : []),
            ],
          },
          select: { id: true },
        })
      : [];
  const auditLogIds = auditLogs.map((a) => a.id);

  return {
    userIds,
    branchIds,
    categoryIds,
    brandIds,
    modelIds,
    unitIds,
    unitBlockIds,
    filmProductIds,
    bookingIds,
    auditLogIds,
  };
}

export async function countE2eData(
  prisma: PrismaClient,
  options: E2eCleanupOptions = {},
): Promise<{ counts: E2eRecordCounts; ids: E2eTargetIds }> {
  const ids = await collectE2eTargetIds(prisma, options);
  const counts: E2eRecordCounts = {
    bookings: ids.bookingIds.length,
    unitBlocks: ids.unitBlockIds.length,
    rentalUnits: ids.unitIds.length,
    rentalModels: ids.modelIds.length,
    filmProducts: ids.filmProductIds.length,
    categories: ids.categoryIds.length,
    brands: ids.brandIds.length,
    branches: ids.branchIds.length,
    users: ids.userIds.length,
    auditLogs: ids.auditLogIds.length,
    total:
      ids.bookingIds.length +
      ids.unitBlockIds.length +
      ids.unitIds.length +
      ids.modelIds.length +
      ids.filmProductIds.length +
      ids.categoryIds.length +
      ids.brandIds.length +
      ids.branchIds.length +
      ids.userIds.length +
      ids.auditLogIds.length,
  };
  return { counts, ids };
}

export async function cleanupE2eData(
  prisma: PrismaClient,
  options: E2eCleanupOptions = {},
): Promise<E2eRecordCounts> {
  const { counts, ids } = await countE2eData(prisma, options);

  // 1. Booking child records
  if (ids.bookingIds.length > 0 || ids.userIds.length > 0) {
    await prisma.paymentRecord.deleteMany({
      where: {
        OR: [
          ...(ids.bookingIds.length > 0
            ? [{ bookingId: { in: ids.bookingIds } }]
            : []),
          ...(ids.userIds.length > 0
            ? [{ recordedBy: { in: ids.userIds } }]
            : []),
        ],
      },
    });
    await prisma.handoverRecord.deleteMany({
      where: {
        OR: [
          ...(ids.bookingIds.length > 0
            ? [{ bookingId: { in: ids.bookingIds } }]
            : []),
          ...(ids.userIds.length > 0
            ? [{ recordedBy: { in: ids.userIds } }]
            : []),
        ],
      },
    });
    await prisma.bookingStatusLog.deleteMany({
      where: {
        OR: [
          ...(ids.bookingIds.length > 0
            ? [{ bookingId: { in: ids.bookingIds } }]
            : []),
          ...(ids.userIds.length > 0 ? [{ actorId: { in: ids.userIds } }] : []),
        ],
      },
    });
  }

  if (ids.bookingIds.length > 0 || ids.filmProductIds.length > 0) {
    await prisma.bookingAddon.deleteMany({
      where: {
        OR: [
          ...(ids.bookingIds.length > 0
            ? [{ bookingId: { in: ids.bookingIds } }]
            : []),
          ...(ids.filmProductIds.length > 0
            ? [{ filmProductId: { in: ids.filmProductIds } }]
            : []),
        ],
      },
    });
  }

  if (
    ids.bookingIds.length > 0 ||
    ids.unitIds.length > 0 ||
    ids.modelIds.length > 0
  ) {
    await prisma.bookingUnit.deleteMany({
      where: {
        OR: [
          ...(ids.bookingIds.length > 0
            ? [{ bookingId: { in: ids.bookingIds } }]
            : []),
          ...(ids.unitIds.length > 0 ? [{ unitId: { in: ids.unitIds } }] : []),
          ...(ids.modelIds.length > 0
            ? [{ modelId: { in: ids.modelIds } }]
            : []),
        ],
      },
    });
  }

  // 2. Bookings
  if (ids.bookingIds.length > 0) {
    await prisma.booking.deleteMany({
      where: { id: { in: ids.bookingIds } },
    });
  }

  // 3. UnitBlocks & Favorites
  if (ids.unitBlockIds.length > 0 || ids.unitIds.length > 0) {
    await prisma.unitBlock.deleteMany({
      where: {
        OR: [
          ...(ids.unitBlockIds.length > 0
            ? [{ id: { in: ids.unitBlockIds } }]
            : []),
          ...(ids.unitIds.length > 0 ? [{ unitId: { in: ids.unitIds } }] : []),
        ],
      },
    });
  }

  if (ids.userIds.length > 0 || ids.modelIds.length > 0) {
    await prisma.favorite.deleteMany({
      where: {
        OR: [
          ...(ids.userIds.length > 0 ? [{ userId: { in: ids.userIds } }] : []),
          ...(ids.modelIds.length > 0
            ? [{ modelId: { in: ids.modelIds } }]
            : []),
        ],
      },
    });
  }

  // 4. RentalUnits
  if (ids.unitIds.length > 0) {
    await prisma.rentalUnit.deleteMany({
      where: { id: { in: ids.unitIds } },
    });
  }

  // 5. RentalModel children & RentalModels
  if (ids.modelIds.length > 0) {
    await prisma.rentalModelImage.deleteMany({
      where: { modelId: { in: ids.modelIds } },
    });
    await prisma.rentalModelSpecs.deleteMany({
      where: { modelId: { in: ids.modelIds } },
    });
    await prisma.rentalModel.deleteMany({
      where: { id: { in: ids.modelIds } },
    });
  }

  // 6. FilmProducts
  if (ids.filmProductIds.length > 0) {
    await prisma.filmProduct.deleteMany({
      where: { id: { in: ids.filmProductIds } },
    });
  }

  // 7. Categories (children first, then parents)
  if (ids.categoryIds.length > 0) {
    await prisma.category.deleteMany({
      where: {
        id: { in: ids.categoryIds },
        parentId: { not: null },
      },
    });
    await prisma.category.deleteMany({
      where: { id: { in: ids.categoryIds } },
    });
  }

  // 8. Brands & Branches
  if (ids.brandIds.length > 0) {
    await prisma.brand.deleteMany({
      where: { id: { in: ids.brandIds } },
    });
  }

  if (ids.branchIds.length > 0) {
    await prisma.branch.deleteMany({
      where: { id: { in: ids.branchIds } },
    });
  }

  // 9. AuditLogs
  if (ids.auditLogIds.length > 0) {
    await prisma.auditLog.deleteMany({
      where: { id: { in: ids.auditLogIds } },
    });
  }

  // 10. Users & User child records
  if (ids.userIds.length > 0) {
    await prisma.contactSetting.updateMany({
      where: { updatedBy: { in: ids.userIds } },
      data: { updatedBy: null },
    });
    await prisma.refreshToken.deleteMany({
      where: { userId: { in: ids.userIds } },
    });
    await prisma.kycSubmission.deleteMany({
      where: {
        OR: [
          { userId: { in: ids.userIds } },
          { reviewedBy: { in: ids.userIds } },
        ],
      },
    });
    await prisma.userRole.deleteMany({
      where: { userId: { in: ids.userIds } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: ids.userIds } },
    });
  }

  return counts;
}
