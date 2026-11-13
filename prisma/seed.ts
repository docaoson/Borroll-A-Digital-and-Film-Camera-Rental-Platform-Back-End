import {
  CameraType,
  ModelKind,
  PrismaClient,
  Role,
  UnitCondition,
  UnitStatus,
  UserStatus,
} from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

async function main() {
  if (process.env.NODE_ENV === 'production') {
    console.error('Refusing to seed in production environment!');
    process.exit(1);
  }

  console.log('Seeding Borroll store data...');

  // 1. Users
  const defaultPassword = 'Password123!';
  const passwordHash = await argon2.hash(defaultPassword);

  const usersData = [
    {
      email: 'admin@borroll.vn',
      fullName: 'Quản trị viên Borroll',
      phone: '0901000001',
      roles: [Role.ADMIN],
    },
    {
      email: 'staff1@borroll.vn',
      fullName: 'Nhân viên Tây Hồ',
      phone: '0902000002',
      roles: [Role.STAFF],
    },
    {
      email: 'staff2@borroll.vn',
      fullName: 'Nhân viên Thanh Xuân',
      phone: '0903000003',
      roles: [Role.STAFF],
    },
    {
      email: 'renter1@borroll.vn',
      fullName: 'Khách hàng Trần Tuấn Anh',
      phone: '0904000004',
      roles: [Role.RENTER],
    },
    {
      email: 'renter2@borroll.vn',
      fullName: 'Khách hàng Phạm Minh Đức',
      phone: '0905000005',
      roles: [Role.RENTER],
    },
  ];

  for (const item of usersData) {
    const user = await prisma.user.upsert({
      where: { email: item.email },
      update: { fullName: item.fullName, phone: item.phone },
      create: {
        email: item.email,
        fullName: item.fullName,
        phone: item.phone,
        passwordHash,
        status: UserStatus.ACTIVE,
      },
    });

    for (const role of item.roles) {
      await prisma.userRole.upsert({
        where: { userId_role: { userId: user.id, role } },
        update: {},
        create: { userId: user.id, role },
      });
    }
  }

  // 2. Branches
  const branchesData = [
    {
      slug: 'tay-ho',
      name: 'Chi nhánh Tây Hồ',
      address: 'Số 18 Xuân Diệu, Tây Hồ, Hà Nội',
      phone: '0866747114',
      openHours: '09:00 – 21:00',
      mapUrl: 'https://maps.google.com/?q=Tay+Ho+Ha+Noi',
    },
    {
      slug: 'thanh-xuan',
      name: 'Chi nhánh Thanh Xuân',
      address: 'Số 42 Nguyễn Trãi, Thanh Xuân, Hà Nội',
      phone: '0866747115',
      openHours: '09:00 – 21:00',
      mapUrl: 'https://maps.google.com/?q=Thanh+Xuan+Ha+Noi',
    },
  ];

  const branchBySlug = new Map<string, string>();
  for (const b of branchesData) {
    const branch = await prisma.branch.upsert({
      where: { slug: b.slug },
      update: b,
      create: b,
    });
    branchBySlug.set(b.slug, branch.id);
  }

  // 3. Categories
  const rootFilm = await prisma.category.upsert({
    where: { slug: 'may-film' },
    update: { name: 'Máy ảnh Film', sortOrder: 1 },
    create: { slug: 'may-film', name: 'Máy ảnh Film', sortOrder: 1 },
  });
  const rootDigital = await prisma.category.upsert({
    where: { slug: 'may-digital' },
    update: { name: 'Máy ảnh Digital', sortOrder: 2 },
    create: { slug: 'may-digital', name: 'Máy ảnh Digital', sortOrder: 2 },
  });
  await prisma.category.upsert({
    where: { slug: 'may-instant' },
    update: { name: 'Máy ảnh Instant', sortOrder: 3 },
    create: { slug: 'may-instant', name: 'Máy ảnh Instant', sortOrder: 3 },
  });
  const rootLens = await prisma.category.upsert({
    where: { slug: 'ong-kinh' },
    update: { name: 'Ống kính', sortOrder: 4 },
    create: { slug: 'ong-kinh', name: 'Ống kính', sortOrder: 4 },
  });

  const subCategories = [
    { slug: 'film-slr', name: 'SLR 35mm', parentId: rootFilm.id, sortOrder: 1 },
    {
      slug: 'film-compact',
      name: 'Compact 35mm',
      parentId: rootFilm.id,
      sortOrder: 2,
    },
    {
      slug: 'film-rangefinder',
      name: 'Rangefinder',
      parentId: rootFilm.id,
      sortOrder: 3,
    },
    {
      slug: 'digital-mirrorless',
      name: 'Mirrorless',
      parentId: rootDigital.id,
      sortOrder: 1,
    },
    {
      slug: 'digital-compact',
      name: 'Compact Digital',
      parentId: rootDigital.id,
      sortOrder: 2,
    },
  ];

  const catBySlug = new Map<string, string>([
    ['may-film', rootFilm.id],
    ['may-digital', rootDigital.id],
    ['ong-kinh', rootLens.id],
  ]);

  for (const sc of subCategories) {
    const cat = await prisma.category.upsert({
      where: { slug: sc.slug },
      update: { name: sc.name, parentId: sc.parentId, sortOrder: sc.sortOrder },
      create: sc,
    });
    catBySlug.set(sc.slug, cat.id);
  }

  // 4. Brands
  const brandsList = [
    { slug: 'canon', name: 'Canon' },
    { slug: 'nikon', name: 'Nikon' },
    { slug: 'sony', name: 'Sony' },
    { slug: 'fujifilm', name: 'Fujifilm' },
    { slug: 'pentax', name: 'Pentax' },
    { slug: 'olympus', name: 'Olympus' },
  ];
  const brandBySlug = new Map<string, string>();
  for (const br of brandsList) {
    const brand = await prisma.brand.upsert({
      where: { slug: br.slug },
      update: { name: br.name },
      create: br,
    });
    brandBySlug.set(br.slug, brand.id);
  }

  // 5. Rental Models & Units
  const modelsData: Array<{
    slug: string;
    name: string;
    kind: ModelKind;
    cameraType: CameraType | null;
    categorySlug: string;
    brandSlug: string;
    mount: string | null;
    filmFormat: string | null;
    pricePerDay: number;
    pricePerWeek: number | null;
    deposit: number;
    isFeatured: boolean;
    description: string;
    units: Array<{
      serialNumber: string;
      branchSlug: string;
      status?: UnitStatus;
    }>;
  }> = [
    {
      slug: 'canon-ae-1-program',
      name: 'Canon AE-1 Program',
      kind: ModelKind.CAMERA,
      cameraType: CameraType.FILM,
      categorySlug: 'film-slr',
      brandSlug: 'canon',
      mount: 'FD',
      filmFormat: '35mm',
      pricePerDay: 550000,
      pricePerWeek: 3000000,
      deposit: 3000000,
      isFeatured: true,
      description:
        'Máy ảnh film kinh điển cho phong cách chụp cổ điển, rõ nét và giàu cảm xúc.',
      units: [
        { serialNumber: 'CA1-TH-001', branchSlug: 'tay-ho' },
        { serialNumber: 'CA1-TH-002', branchSlug: 'tay-ho' },
        { serialNumber: 'CA1-TX-001', branchSlug: 'thanh-xuan' },
      ],
    },
    {
      slug: 'nikon-fm2',
      name: 'Nikon FM2',
      kind: ModelKind.CAMERA,
      cameraType: CameraType.FILM,
      categorySlug: 'film-slr',
      brandSlug: 'nikon',
      mount: 'F',
      filmFormat: '35mm',
      pricePerDay: 480000,
      pricePerWeek: 2600000,
      deposit: 3500000,
      isFeatured: false,
      description:
        'Thiết kế đơn giản, bền bỉ và phù hợp cho nhiếp ảnh gia yêu thích chụp tự do.',
      units: [
        { serialNumber: 'NFM2-TH-001', branchSlug: 'tay-ho' },
        { serialNumber: 'NFM2-TX-001', branchSlug: 'thanh-xuan' },
      ],
    },
    {
      slug: 'sony-a7-iii',
      name: 'Sony A7 III',
      kind: ModelKind.CAMERA,
      cameraType: CameraType.DIGITAL,
      categorySlug: 'digital-mirrorless',
      brandSlug: 'sony',
      mount: 'E',
      filmFormat: null,
      pricePerDay: 900000,
      pricePerWeek: 5000000,
      deposit: 8000000,
      isFeatured: true,
      description:
        'Cân bằng giữa hiệu suất, độ mượt và khả năng chụp trong nhiều điều kiện sáng khác nhau.',
      units: [
        { serialNumber: 'SA73-TH-001', branchSlug: 'tay-ho' },
        { serialNumber: 'SA73-TX-001', branchSlug: 'thanh-xuan' },
      ],
    },
    {
      slug: 'fujifilm-x-t4',
      name: 'Fujifilm X-T4',
      kind: ModelKind.CAMERA,
      cameraType: CameraType.DIGITAL,
      categorySlug: 'digital-mirrorless',
      brandSlug: 'fujifilm',
      mount: 'X',
      filmFormat: null,
      pricePerDay: 850000,
      pricePerWeek: 4700000,
      deposit: 7000000,
      isFeatured: true,
      description:
        'Phù hợp cho quay video và chụp đời sống với màu sắc ấm, nổi bật và dễ làm việc.',
      units: [
        { serialNumber: 'FXT4-TH-001', branchSlug: 'tay-ho' },
        {
          serialNumber: 'FXT4-TX-001',
          branchSlug: 'thanh-xuan',
          status: UnitStatus.MAINTENANCE,
        },
      ],
    },
    {
      slug: 'pentax-k1000',
      name: 'Pentax K1000',
      kind: ModelKind.CAMERA,
      cameraType: CameraType.FILM,
      categorySlug: 'film-slr',
      brandSlug: 'pentax',
      mount: 'K',
      filmFormat: '35mm',
      pricePerDay: 470000,
      pricePerWeek: 2500000,
      deposit: 2500000,
      isFeatured: true,
      description:
        'Dễ sử dụng, phù hợp cho người mới bắt đầu với phong cách chụp cổ điển.',
      units: [
        { serialNumber: 'PK1K-TH-001', branchSlug: 'tay-ho' },
        { serialNumber: 'PK1K-TX-001', branchSlug: 'thanh-xuan' },
      ],
    },
    {
      slug: 'canon-r6',
      name: 'Canon R6',
      kind: ModelKind.CAMERA,
      cameraType: CameraType.DIGITAL,
      categorySlug: 'digital-mirrorless',
      brandSlug: 'canon',
      mount: 'RF',
      filmFormat: null,
      pricePerDay: 1100000,
      pricePerWeek: 6200000,
      deposit: 9000000,
      isFeatured: false,
      description:
        'Thiết bị linh hoạt cho dự án tạo hình, quay cổ và chụp chân dung chuyên nghiệp.',
      units: [{ serialNumber: 'CR6-TX-001', branchSlug: 'thanh-xuan' }],
    },
    {
      slug: 'olympus-xa',
      name: 'Olympus XA',
      kind: ModelKind.CAMERA,
      cameraType: CameraType.FILM,
      categorySlug: 'film-rangefinder',
      brandSlug: 'olympus',
      mount: null,
      filmFormat: '35mm',
      pricePerDay: 250000,
      pricePerWeek: 1400000,
      deposit: 3000000,
      isFeatured: false,
      description:
        'Máy film 35mm rangefinder siêu nhỏ gọn, phù hợp chụp đường phố và du lịch.',
      units: [
        { serialNumber: 'OXA-0042', branchSlug: 'tay-ho' },
        { serialNumber: 'OXA-0043', branchSlug: 'thanh-xuan' },
      ],
    },
    {
      slug: 'sony-fe-35mm-f18',
      name: 'Sony FE 35mm f/1.8',
      kind: ModelKind.LENS,
      cameraType: null,
      categorySlug: 'ong-kinh',
      brandSlug: 'sony',
      mount: 'E',
      filmFormat: null,
      pricePerDay: 220000,
      pricePerWeek: 1200000,
      deposit: 3000000,
      isFeatured: false,
      description: 'Ống kính góc rộng ngàm Sony E gọn nhẹ, sắc nét.',
      units: [
        { serialNumber: 'SFE35-TH-001', branchSlug: 'tay-ho' },
        { serialNumber: 'SFE35-TX-001', branchSlug: 'thanh-xuan' },
      ],
    },
  ];

  for (const m of modelsData) {
    const model = await prisma.rentalModel.upsert({
      where: { slug: m.slug },
      update: {
        name: m.name,
        kind: m.kind,
        cameraType: m.cameraType,
        categoryId: catBySlug.get(m.categorySlug)!,
        brandId: brandBySlug.get(m.brandSlug)!,
        mount: m.mount,
        filmFormat: m.filmFormat,
        pricePerDay: m.pricePerDay,
        pricePerWeek: m.pricePerWeek,
        deposit: m.deposit,
        isFeatured: m.isFeatured,
        description: m.description,
      },
      create: {
        slug: m.slug,
        name: m.name,
        kind: m.kind,
        cameraType: m.cameraType,
        categoryId: catBySlug.get(m.categorySlug)!,
        brandId: brandBySlug.get(m.brandSlug)!,
        mount: m.mount,
        filmFormat: m.filmFormat,
        pricePerDay: m.pricePerDay,
        pricePerWeek: m.pricePerWeek,
        deposit: m.deposit,
        isFeatured: m.isFeatured,
        description: m.description,
        isActive: true,
      },
    });

    for (const u of m.units) {
      await prisma.rentalUnit.upsert({
        where: { serialNumber: u.serialNumber },
        update: {
          modelId: model.id,
          branchId: branchBySlug.get(u.branchSlug)!,
          status: u.status ?? UnitStatus.AVAILABLE,
        },
        create: {
          modelId: model.id,
          branchId: branchBySlug.get(u.branchSlug)!,
          serialNumber: u.serialNumber,
          condition: UnitCondition.EXCELLENT,
          status: u.status ?? UnitStatus.AVAILABLE,
        },
      });
    }
  }

  // 6. Film Products
  const filmsData = [
    { name: 'Kodak Gold 200', iso: 200, format: '35mm', price: 180000 },
    { name: 'Kodak ColorPlus 200', iso: 200, format: '35mm', price: 165000 },
    { name: 'Fujifilm C200', iso: 200, format: '35mm', price: 195000 },
  ];

  for (const f of filmsData) {
    const existing = await prisma.filmProduct.findFirst({
      where: { name: f.name },
    });
    if (!existing) {
      await prisma.filmProduct.create({
        data: { ...f, inStock: true },
      });
    }
  }

  // 7. Contact Settings (single row, default id = 'default')
  await prisma.contactSetting.upsert({
    where: { id: 'default' },
    update: {},
    create: {
      id: 'default',
      zaloOaId: null,
      zaloPhone: null,
      messengerPage: null,
      hotline: null,
      welcomeMessage: null,
      isChatEnabled: false,
      updatedBy: null,
    },
  });

  console.log('Seeding Borroll store data completed successfully.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
