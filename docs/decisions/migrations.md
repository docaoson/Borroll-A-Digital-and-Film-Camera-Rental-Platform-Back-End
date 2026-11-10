# Quy trình Migration Database trên Supabase

Tài liệu này mô tả quy trình chuẩn để thay đổi lược đồ cơ sở dữ liệu (database schema) cho dự án **Borroll Backend** trên Supabase PostgreSQL.

## Nguyên tắc bắt buộc

1. **Tuyệt đối không** chạy các lệnh phá hủy hoặc tự tạo shadow database trên project Supabase thật/staging:
   - Cấm `prisma migrate dev` (Supabase không cấp quyền `CREATE DATABASE` cho shadow DB).
   - Cấm `prisma migrate reset`.
   - Cấm `prisma db push --force-reset`.
2. **Dùng đúng chuỗi kết nối:**
   - `DATABASE_URL` (Transaction pooler, cổng `6543`, `?pgbouncer=true`): chỉ dùng cho runtime của ứng dụng.
   - `DIRECT_URL` (Session pooler trên mạng IPv4, host `aws-...pooler.supabase.com`, cổng `5432`, user `postgres.<mã-project>`): dùng cho `prisma migrate deploy` và `prisma migrate status`.
3. **Schema `public` và RLS:**
   - Chỉ thao tác trên schema `public` (không sửa `auth`, `storage`, `realtime`).
   - **Mọi bảng mới tạo** đều phải kèm câu lệnh bật Row Level Security ở cuối file SQL migration (không tạo policy cho `anon`/`authenticated`):
     ```sql
     ALTER TABLE "<table_name>" ENABLE ROW LEVEL SECURITY;
     ```

## Các bước tạo và áp dụng migration

1. **Cập nhật `prisma/schema.prisma`** với model/enum/index mới.
2. **Tạo thư mục migration** theo định dạng timestamp: `prisma/migrations/<YYYYMMDDHHMMSS>_<ten_migration>/migration.sql`.
3. **Sinh SQL bằng `prisma migrate diff`:**
   ```bash
   npx prisma migrate diff \
     --from-migrations prisma/migrations \
     --to-schema-datamodel prisma/schema.prisma \
     --script > prisma/migrations/<YYYYMMDDHHMMSS>_<ten_migration>/migration.sql
   ```
   *(Nếu có cột đặc biệt do SQL tay tạo như `during daterange` kiểu `GENERATED ALWAYS`, hãy kiểm tra kỹ file SQL sinh ra để chắc chắn Prisma không đòi `DROP COLUMN`.)*
4. **Kiểm tra bằng mắt và bổ sung SQL tay** vào file `migration.sql`:
   - Thêm `ALTER TABLE "..." ENABLE ROW LEVEL SECURITY;` cho từng bảng mới.
   - Thêm extension (`CREATE EXTENSION IF NOT EXISTS btree_gist;`, `unaccent`) hoặc constraint GiST / cột generated nếu có.
5. **Áp dụng migration qua `DIRECT_URL`:**
   ```bash
   npx prisma migrate deploy
   ```
6. **Kiểm tra trạng thái và sinh lại Prisma Client:**
   ```bash
   npx prisma migrate status
   npx prisma generate
   ```

