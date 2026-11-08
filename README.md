# Borroll Backend

Hệ thống backend cho nền tảng thuê máy ảnh Borroll (Modular Monolith trên NestJS & PostgreSQL/Supabase).

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
- `DATABASE_URL`: Chuỗi kết nối transaction pooler Supabase (cổng 6543)
- `DIRECT_URL`: Chuỗi kết nối trực tiếp Supabase cho migration (cổng 5432)
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`: Cấu hình Supabase API & Storage
- `JWT_ACCESS_SECRET`, `JWT_ACCESS_TTL`: Cấu hình Access Token (JWT)
- `REFRESH_TTL_DAYS`: Thời hạn Refresh Token (lưu hash và cookie httpOnly)
- `CORS_ORIGIN`: Địa chỉ frontend cho phép truy cập CORS
- `PLATFORM_FEE_PERCENT`: Tỷ lệ phí nền tảng (%)

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

- Kiểm tra API Docs (Swagger):
`http://localhost:4000/api/docs`

- Kiểm tra Health check:
`http://localhost:4000/api/v1/health`
