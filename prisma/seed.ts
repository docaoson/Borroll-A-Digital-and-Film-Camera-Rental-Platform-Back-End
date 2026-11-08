import { PrismaClient, Role, UserStatus, KycStatus } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

async function main() {
  if (process.env.NODE_ENV === 'production') {
    console.error('Refusing to seed in production environment!');
    process.exit(1);
  }

  console.log('Seeding initial identity data...');

  const defaultPassword = 'Password123!';
  const passwordHash = await argon2.hash(defaultPassword);

  const usersData = [
    {
      email: 'admin@borroll.vn',
      fullName: 'Quản trị viên Borroll',
      phone: '0901000001',
      roles: [Role.ADMIN],
      kycStatus: KycStatus.VERIFIED,
    },
    {
      email: 'host1@borroll.vn',
      fullName: 'Chủ máy Nguyễn Văn Nam',
      phone: '0902000002',
      roles: [Role.HOST, Role.RENTER],
      kycStatus: KycStatus.VERIFIED,
    },
    {
      email: 'host2@borroll.vn',
      fullName: 'Chủ máy Lê Thị Hoa',
      phone: '0903000003',
      roles: [Role.HOST, Role.RENTER],
      kycStatus: KycStatus.NONE,
    },
    {
      email: 'renter1@borroll.vn',
      fullName: 'Người thuê Trần Tuấn Anh',
      phone: '0904000004',
      roles: [Role.RENTER],
      kycStatus: KycStatus.NONE,
    },
    {
      email: 'renter2@borroll.vn',
      fullName: 'Người thuê Phạm Minh Đức',
      phone: '0905000005',
      roles: [Role.RENTER],
      kycStatus: KycStatus.NONE,
    },
  ];

  for (const item of usersData) {
    const user = await prisma.user.upsert({
      where: { email: item.email },
      update: {
        fullName: item.fullName,
        phone: item.phone,
        kycStatus: item.kycStatus,
      },
      create: {
        email: item.email,
        fullName: item.fullName,
        phone: item.phone,
        passwordHash,
        status: UserStatus.ACTIVE,
        kycStatus: item.kycStatus,
      },
    });

    for (const role of item.roles) {
      await prisma.userRole.upsert({
        where: {
          userId_role: {
            userId: user.id,
            role,
          },
        },
        update: {},
        create: {
          userId: user.id,
          role,
        },
      });
    }
  }

  console.log('Seeding identity data completed successfully.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

