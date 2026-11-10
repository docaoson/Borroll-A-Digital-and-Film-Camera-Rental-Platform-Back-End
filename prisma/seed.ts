import { PrismaClient, Role, UserStatus } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

async function main() {
  if (process.env.NODE_ENV === 'production') {
    console.error('Refusing to seed in production environment!');
    process.exit(1);
  }

  console.log('Seeding initial store identity data...');

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
      update: {
        fullName: item.fullName,
        phone: item.phone,
      },
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

  console.log('Seeding store identity data completed successfully.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
