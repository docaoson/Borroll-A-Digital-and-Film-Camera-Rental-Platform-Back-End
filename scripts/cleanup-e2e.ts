import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import {
  cleanupE2eData,
  countE2eData,
} from '../src/common/utils/e2e-cleanup.util';

function loadEnvSilently(): void {
  const envPath = path.resolve(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, 'utf8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eqIdx = line.indexOf('=');
    if (eqIdx <= 0) continue;
    const key = line.slice(0, eqIdx).trim();
    let val = line.slice(eqIdx + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = val;
    }
  }
}

function askConfirmation(question: string): Promise<boolean> {
  if (process.argv.includes('--yes') || process.argv.includes('-y')) {
    return Promise.resolve(true);
  }
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      const normalized = answer.trim().toLowerCase();
      resolve(normalized === 'y' || normalized === 'yes');
    });
  });
}

async function main(): Promise<void> {
  loadEnvSilently();
  const prisma = new PrismaClient();

  try {
    const { counts } = await countE2eData(prisma, {
      prefix: 'e2e_',
      includeExampleTestEmails: true,
    });

    console.log('=== Thống kê dữ liệu E2E phát hiện được ===');
    console.log(`- Đơn đặt thuê (bookings):        ${counts.bookings}`);
    console.log(`- Lịch khóa máy (unit_blocks):    ${counts.unitBlocks}`);
    console.log(`- Chiếc máy (rental_units):       ${counts.rentalUnits}`);
    console.log(`- Mẫu máy (rental_models):        ${counts.rentalModels}`);
    console.log(`- Cuộn film (film_products):      ${counts.filmProducts}`);
    console.log(`- Danh mục (categories):          ${counts.categories}`);
    console.log(`- Hãng (brands):                  ${counts.brands}`);
    console.log(`- Chi nhánh (branches):           ${counts.branches}`);
    console.log(`- Tài khoản (users):              ${counts.users}`);
    console.log(`- Nhật ký hệ thống (audit_logs):  ${counts.auditLogs}`);
    console.log(`=> Tổng số bản ghi sẽ xóa:        ${counts.total}`);

    if (counts.total === 0) {
      console.log(
        'Không có bản ghi e2e_ hoặc tài khoản @example.test nào cần xóa.',
      );
      return;
    }

    const confirmed = await askConfirmation(
      `Bạn có chắc chắn muốn xóa ${counts.total} bản ghi này không? (y/N): `,
    );

    if (!confirmed) {
      console.log('Đã hủy thao tác xóa dữ liệu E2E.');
      return;
    }

    const deleted = await cleanupE2eData(prisma, {
      prefix: 'e2e_',
      includeExampleTestEmails: true,
    });
    console.log(`Đã xóa thành công ${deleted.total} bản ghi E2E.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : 'Lỗi không xác định';
  console.error(`Lỗi khi chạy cleanup:e2e: ${message}`);
  process.exit(1);
});
