# Borroll Backend

Hệ thống backend cho website cửa hàng cho thuê máy ảnh Borroll (Modular Monolith trên NestJS & PostgreSQL/Supabase).

## Yêu cầu môi trường

- Node.js >= 22
- npm hoặc pnpm
- Tài khoản Supabase (PostgreSQL & Storage)

## Cài đặt

1. Cài đặt các gói phụ thuộc:
```bash
npm install
```

2. Sinh Prisma Client:
```bash
npx prisma generate
```

## Biến môi trường

Sao chép `.env.example` thành `.env` và điền các giá trị kết nối:
```bash
cp .env.example .env
```

Các biến môi trường chính:
- `PORT`: Cổng chạy ứng dụng (mặc định 4000)
- `DATABASE_URL`: Chuỗi kết nối transaction pooler Supabase (cổng 6543, kèm `?pgbouncer=true`)
- `DIRECT_URL`: Chuỗi kết nối Session pooler Supabase cho migration (cổng 5432, user `postgres.<mã-project>`)
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`: Cấu hình Supabase API & Storage
- `STORAGE_BUCKET_AVATARS`, `STORAGE_BUCKET_RENTAL_IMAGES`, `STORAGE_BUCKET_HANDOVER`: Tên các bucket Storage
- `JWT_ACCESS_SECRET`, `JWT_ACCESS_TTL`: Cấu hình Access Token (JWT)
- `REFRESH_TTL_DAYS`: Thời hạn Refresh Token (lưu hash và cookie httpOnly)
- `CORS_ORIGIN`: Địa chỉ frontend cho phép truy cập CORS
- `BOOKING_PENDING_TTL_HOURS`: Thời hạn tự hủy đơn `PENDING` (mặc định 24 giờ)
- `AI_PROVIDER`, `AI_API_KEY`, `AI_MODEL`, `AI_DAILY_LIMIT_PER_USER`: Cấu hình Trợ lý AI (P3)

## Chạy ứng dụng

- Chế độ phát triển:
```bash
npm run start:dev
```

- Chế độ production build:
```bash
npm run build
npm run start:prod
```

- Seed dữ liệu mẫu (local/dev):
```bash
npm run seed
```

- Kiểm tra API Docs (Swagger):
`http://localhost:4000/api/docs`

- Kiểm tra Health check:
`http://localhost:4000/api/v1/health`
