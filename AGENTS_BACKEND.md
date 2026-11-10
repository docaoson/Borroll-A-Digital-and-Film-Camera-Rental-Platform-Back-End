# BORROLL BACKEND (CỬA HÀNG) — HƯỚNG DẪN CHO AI AGENT / NGƯỜI VIẾT CODE

Repo: `borroll-backend`. Đọc hết file này trước khi viết code. Bối cảnh và lý do thiết kế ở `BORROLL_STORE_PLAN.md`; hình dạng request/response ở `docs/BORROLL_FE_BE_CONTRACT.md` (hợp đồng thắng khi có mâu thuẫn về hình dạng dữ liệu). Sau khi code xong phải xuất `docs/openapi.yaml` và đối chiếu với hợp đồng.

## 0. Bối cảnh

Borroll là **website của một cửa hàng cho thuê máy ảnh** (số và film). Shop sở hữu máy, cho thuê từ kho của mình ở các chi nhánh (Tây Hồ, Thanh Xuân), khách nhận và trả máy tại cửa hàng, **tiền do shop thu trực tiếp**. Không còn chủ máy, hoa hồng, duyệt tin, KYC.

Vai trò: `RENTER` (Khách), `STAFF` (nhân viên), `ADMIN`. `HOST` còn trong enum nhưng **không dùng**.

**Đang giả định** (xem `BORROLL_STORE_PLAN.md` mục 1.5): shop cho thuê từ kho riêng, hai chi nhánh, nhận trả cùng chi nhánh, không giao hàng, thanh toán tại quầy (nhân viên ghi sổ thủ công), chỉ cho thuê (film bán kèm là món thêm), một mẫu máy có nhiều chiếc.

## 1. Kiến trúc: Modular Monolith

- Một ứng dụng NestJS, một database PostgreSQL (Supabase).
- Module theo miền nghiệp vụ: `identity`, `catalog`, `inventory`, `booking`, `operations`, `ai-setup`, `content`, `admin`.
- **Ranh giới module (bắt buộc):** module này không truy cập bảng của module khác; cần dữ liệu thì gọi **service được export** của module đó. Giao tiếp bất đồng bộ qua domain event (`@nestjs/event-emitter`), ví dụ `booking.created`, `booking.confirmed`, `booking.picked_up`. Mỗi module chỉ export những gì cần qua `index.ts`.
- KHÔNG dùng: microservices, message broker, GraphQL, CQRS, Redis (giai đoạn này).

| Module | Việc chính |
|---|---|
| `identity` | Đăng ký, đăng nhập, refresh, hồ sơ, vai trò, ảnh đại diện (đã có) |
| `catalog` | Chi nhánh, danh mục, hãng, mẫu máy, ảnh, thông số, tìm kiếm và bộ lọc, yêu thích, film bán kèm |
| `inventory` | Chiếc máy, khóa bảo trì, tìm chiếc còn trống |
| `booking` | Báo giá, tạo đơn, state machine, tính tiền, hết hạn đơn |
| `operations` | Giao máy, nhận máy, biên bản và ảnh, sổ thu chi, dashboard nhân viên |
| `ai-setup` | Trợ lý cấu hình máy (làm sau) |
| `content` | Nội dung tĩnh của shop (giai đoạn đầu để trong FE) |
| `admin` | Quản lý người dùng và các thao tác quản trị dùng chung |

## 2. Stack

Node 22, NestJS (TypeScript strict), PostgreSQL trên Supabase, Prisma, JWT + `argon2`, `class-validator`, `@nestjs/swagger`, `@supabase/supabase-js` (Storage, chỉ dùng ở BE), `@nestjs/schedule`, `@nestjs/throttler`, Jest + Supertest. Không dùng Supabase Auth, không dùng Data API/PostgREST.

## 3. Cấu hình Supabase

- Hai chuỗi kết nối, **không đổi chỗ cho nhau**: `DATABASE_URL` qua transaction pooler (cổng 6543, kèm `?pgbouncer=true`) cho ứng dụng; `DIRECT_URL` cho migration. **Nếu mạng chỉ có IPv4, `DIRECT_URL` phải dùng Session pooler** (host `...pooler.supabase.com`, cổng 5432, user `postgres.<mã-project>`).
- Dùng schema `public`. Không sửa schema `auth`, `storage`, `realtime` bằng Prisma. Bật extension `btree_gist` và `unaccent`.
- **Bật RLS cho mọi bảng, không tạo policy** (`ALTER TABLE ... ENABLE ROW LEVEL SECURITY` trong migration của mỗi bảng). BE kết nối bằng chuỗi Postgres nên không bị ảnh hưởng.
- Khóa **secret** (`sb_secret_...`, đặt trong biến `SUPABASE_SERVICE_ROLE_KEY`) chỉ nằm ở BE, không bao giờ trả về client hoặc commit.
- **Quy trình migration:** sinh SQL bằng `prisma migrate diff`, kiểm tra bằng mắt, áp dụng bằng `prisma migrate deploy` qua `DIRECT_URL`. **Tuyệt đối không** dùng `migrate dev`, `migrate reset`, `db push --force-reset` trên project Supabase. Mỗi bảng mới kèm RLS.
- Staging và production là hai project Supabase **riêng**; local dùng Postgres Docker hoặc một project dev.

**Storage** (qua `StorageService`, đã có):
- Bucket `avatars` (công khai), `rental-images` (công khai, ảnh máy), `handover-photos` (**riêng tư**, ảnh biên bản giao nhận). Đặt giới hạn dung lượng và loại file (JPG/PNG/WebP) ngay trong cài đặt bucket, vì URL tải lên không tự giới hạn.
- Luồng tải hai bước: BE cấp signed upload URL → FE `PUT` file → FE gửi `path` cho BE. BE phải kiểm tra `path` thuộc đúng thư mục của chủ thể (`avatars/{userId}/`, `models/{modelId}/`, `handover/{bookingId}/`) và file thật sự đã có (`assertOwnedFile`).
- Ảnh trong bucket riêng tư chỉ xem qua signed URL ngắn hạn (5 phút), chỉ cấp cho nhân viên/admin hoặc khách chủ đơn.

## 4. Quy ước API

- Tiền tố `/api/v1`. Tiền là **số nguyên VND**. Ngày thuê `YYYY-MM-DD`; thời điểm ISO 8601 UTC; "hôm nay" tính theo `Asia/Ho_Chi_Minh`.
- Phân trang `page` (từ 1), `pageSize` (mặc định 20, tối đa 100) → `{ items, page, pageSize, total }`.
- Lỗi thống nhất: `{ "error": { "code", "message", "details" } }`, `message` tiếng Việt. Lỗi validate: `400 VALIDATION_ERROR` với `details.fields`. Bộ mã lỗi ở hợp đồng mục 1.4.
- `ValidationPipe` toàn cục `whitelist`, `forbidNonWhitelisted`, `transform`. CORS chỉ cho `CORS_ORIGIN`, bật `credentials`. Throttler chặt cho `/auth/*` và `/ai/*`.
- ID dạng `cuid`. `slug` duy nhất cho mẫu máy, danh mục, hãng, chi nhánh.

## 5. Xác thực và phân quyền

**Xác thực** (đã làm ở 2A, giữ nguyên): `argon2`; email lưu chữ thường; access token JWT 15 phút (hết hạn → `401 TOKEN_EXPIRED`); refresh token ngẫu nhiên, chỉ lưu hash SHA-256, cookie `httpOnly`, `SameSite=Lax`, `path=/api/v1/auth`, sống 30 ngày, **xoay vòng nguyên tử** (dùng `updateMany` với điều kiện `revokedAt: null` rồi kiểm tra `count`), dùng lại token đã thu hồi thì thu hồi cả `family_id`. Đăng nhập luôn chạy một lần `argon2.verify` (kể cả khi email không tồn tại, với hash giả) và chỉ kiểm tra khóa tài khoản sau khi mật khẩu đúng. Đăng ký bắt lỗi trùng email của Prisma (`P2002`) và trả `409 EMAIL_ALREADY_USED`.

**Phân quyền hai lớp (bắt buộc):**
1. **RBAC:** `JwtAuthGuard` toàn cục, `@Public()`, `OptionalJwtAuthGuard` cho endpoint 🌐*, `@Roles('STAFF','ADMIN')` / `@Roles('ADMIN')`. Vai trò nằm trong access token. `ADMIN` được coi là bao gồm quyền `STAFF`.
2. **Ownership:** khách chỉ xem và hủy đơn của chính mình, truy vấn luôn ràng buộc theo `userId` từ token. Tài nguyên không thuộc mình trả `404`, không trả `403`. STAFF và ADMIN xem được mọi đơn.

Mọi thao tác của nhân viên và admin về đơn, tiền, giá, vai trò ghi vào `audit_logs`. Admin không tự bỏ quyền `ADMIN` của chính mình.

## 6. Lược đồ dữ liệu

Prisma, tên bảng snake_case (`@@map`), mọi bảng có `created_at`, `updated_at`, bật RLS.

**Đã có (identity):** `users`, `user_roles`, `refresh_tokens`, `audit_logs`. `kyc_submissions` nếu đã tạo thì để đó, không dùng. **Thêm** giá trị `STAFF` vào enum `Role` (`ALTER TYPE "Role" ADD VALUE 'STAFF'`).

**catalog / inventory**
- `branches`: id, name, slug, address, phone, open_hours, map_url, is_active.
- `categories`: id, parent_id, name, slug, sort_order. Cây: Máy film (Compact 35mm, SLR 35mm, Rangefinder, Medium format), Máy digital (Compact, Mirrorless, DSLR), Instant, Ống kính, Phụ kiện.
- `brands`: id, name, slug.
- `rental_models`: id, kind (`CAMERA|LENS|ACCESSORY`), category_id, brand_id, slug, name, description, camera_type (`DIGITAL|FILM|INSTANT`, null với lens/phụ kiện), mount, film_format, price_per_day, price_per_week (nullable), deposit, is_active, is_featured, last_inspected_at, inspection_notes (jsonb `[{label, ok}]`).
- `rental_model_images`: id, model_id, path, kind (`PRODUCT|SAMPLE`), caption, sample_lens, sort_order.
- `rental_model_specs`: model_id (khóa chính), specs (jsonb có cấu trúc: `exposure`, `controls`, `power`, `quirks`, `beginnerNotes`).
- `rental_units`: id, model_id, branch_id, serial_number (unique), condition (`EXCELLENT|GOOD|FAIR`), status (`AVAILABLE|MAINTENANCE|RETIRED`), notes, purchased_at.
- `unit_blocks`: id, unit_id, start_date, end_date, reason, created_by, `during` (xem 7.1).
- `film_products`: id, name, iso, format, price, in_stock, image_path.
- `favorites`: user_id, model_id (khóa chính kép).

**booking / operations**
- `bookings`: id, code (`BR-XXXXX`, unique), user_id, branch_id, start_date, end_date, days, status, contact_name, contact_phone, note, rental_amount, addons_amount, deposit_amount, total_amount (bản chụp giá), expires_at, confirmed_by, confirmed_at, picked_up_at, returned_at, completed_at, rejected_reason, cancelled_reason, setup_plan_id (nullable).
- `booking_units`: id, booking_id, unit_id, model_id, active (boolean), start_date, end_date, price_per_day, rental_amount, deposit_amount (bản chụp), `during`.
- `booking_addons`: booking_id, film_product_id, quantity, unit_price.
- `booking_status_logs`: id, booking_id, from_status, to_status, actor_id, note.
- `handover_records`: id, booking_id, kind (`PICKUP|RETURN`), checklist (jsonb), condition_notes, photo_paths (text[]), id_checked, recorded_by.
- `payment_records`: id, booking_id, type (`DEPOSIT_RECEIVED|RENTAL_RECEIVED|DEPOSIT_REFUNDED|DAMAGE_CHARGE|LATE_FEE`), amount, method (`CASH|BANK_TRANSFER`), note, recorded_by.
- `camera_setup_plans`: id, user_id, model_id, booking_id (nullable), input (jsonb), result (jsonb), status (`DRAFT|ATTACHED|PREPARED_BY_STAFF`), helpful (nullable).

Index gợi ý: `rental_models(is_active, category_id)`, `rental_models(brand_id)`, `rental_models(price_per_day)`, `rental_units(model_id, branch_id, status)`, `bookings(user_id, status)`, `bookings(branch_id, status, start_date)`, `booking_units(unit_id)`, cộng các index GiST đi kèm ràng buộc.

## 7. Quy tắc nghiệp vụ

### 7.1 Chống trùng lịch (BẮT BUỘC ở tầng database)

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE booking_units
  ADD COLUMN during daterange
  GENERATED ALWAYS AS (daterange(start_date, end_date, '[)')) STORED;
ALTER TABLE booking_units
  ADD CONSTRAINT booking_units_no_overlap
  EXCLUDE USING gist (unit_id WITH =, during WITH &&) WHERE (active);

ALTER TABLE unit_blocks
  ADD COLUMN during daterange
  GENERATED ALWAYS AS (daterange(start_date, end_date, '[)')) STORED;
```
- Khoảng thuê **nửa mở** `[nhận, trả)`: ngày trả không tính kín.
- `booking_units.active = false` khi đơn bị từ chối, hủy hoặc hoàn tất, làm trong cùng transaction với đổi trạng thái. Đơn `RETURNED` vẫn giữ `active` cho đến khi `COMPLETED`.
- Giữa `booking_units` và `unit_blocks` không có ràng buộc chung nên kiểm tra chéo trong cùng transaction.
- Khai báo `during` trong Prisma là `Unsupported("daterange")?` (hoặc bỏ khỏi schema) và tạo bằng migration SQL tay; **kiểm tra Prisma không đòi xóa cột này** khi sinh migration tiếp theo.
- Vi phạm ràng buộc (mã Postgres `23P01`) phải đổi thành `409 NO_UNIT_AVAILABLE` (khi tạo đơn) hoặc `409 BOOKING_DATE_UNAVAILABLE` (khi khóa bảo trì).

### 7.2 Gán chiếc máy khi tạo đơn

Trong **một transaction**, với mỗi món trong đơn: (1) khóa dòng mẫu máy `SELECT id FROM rental_models WHERE id = $1 FOR UPDATE` (luôn khóa theo thứ tự `id` tăng dần để tránh deadlock khi đơn có nhiều món); (2) tìm một chiếc `AVAILABLE` của mẫu đó ở chi nhánh đã chọn, không có khóa bảo trì giao khoảng ngày, không có `booking_units` hoạt động giao khoảng ngày; (3) chèn `booking_units`. Không có chiếc nào → `409 NO_UNIT_AVAILABLE`. Ràng buộc 7.1 là lưới an toàn cuối cùng. Đơn có hai món cùng một mẫu thì gán hai chiếc khác nhau.

Một mẫu "còn trống" trong khoảng ngày khi có ít nhất một chiếc trống ở chi nhánh; `availability` theo tháng báo ngày **hết** khi không còn chiếc nào trống.

### 7.3 Báo giá và tính tiền (`PricingService`, một hàm cho cả `quote` và đơn thật)

- `days = endDate − startDate`, tối thiểu 1; `startDate` không ở quá khứ; `endDate > startDate`.
- Tiền thuê mỗi mẫu: nếu có `price_per_week` và `days ≥ 7` thì áp giá tuần cho từng tuần đủ, phần dư tính `price_per_day`; ngược lại `days × price_per_day`.
- `addons_amount = Σ quantity × price` (chỉ film đang `in_stock`).
- `deposit_amount = Σ deposit` của các mẫu trong đơn. **Cọc là tiền hoàn lại**, không tính vào doanh thu.
- `totalDueAtPickup = rental_amount + addons_amount + deposit_amount`.
- Lưu **bản chụp** vào đơn và `booking_units`, không tính lại khi shop đổi giá.
- Đơn phải có ít nhất một món `CAMERA`; mỗi `LENS` phải cùng `mount` với một `CAMERA` trong đơn, nếu không `422 INCOMPATIBLE_ITEMS`. Mẫu `is_active = false` → `422 MODEL_NOT_BOOKABLE`.
- `POST /bookings/quote` không ghi database và không giữ chỗ.

### 7.4 State machine của đơn

```
PENDING → CONFIRMED → PICKED_UP → RETURNED → COMPLETED
   ↓          ↓
REJECTED   CANCELLED
```
Cài trong `booking.state-machine.ts` dưới dạng bảng chuyển hợp lệ; sai → `409 INVALID_STATUS_TRANSITION`. Mỗi lần chuyển: một transaction cập nhật đơn (và `active` của `booking_units` nếu cần), ghi `booking_status_logs` và `audit_logs`, rồi phát domain event.

- Tạo đơn: `PENDING`, `expires_at = now + BOOKING_PENDING_TTL_HOURS` (mặc định 24). **Cron mỗi 10 phút:** đơn `PENDING` quá `expires_at` → `CANCELLED` ("Hết hạn chờ xác nhận").
- `isOverdue` **không phải trạng thái**: là `status = PICKED_UP AND end_date < hôm nay (giờ Việt Nam)`, tính khi trả dữ liệu.
- Khách chỉ hủy được khi `PENDING` hoặc `CONFIRMED`. Nhân viên hủy được cùng các trạng thái đó. Quy định phạt khi hủy sát ngày nhận do shop chốt, hiện chưa tính tiền phạt.

### 7.5 `allowedActions` và `viewerRole`

| Người xem | Trạng thái | `allowedActions` |
|---|---|---|
| Khách của đơn | `PENDING`, `CONFIRMED` | `["cancel"]` |
| STAFF / ADMIN | `PENDING` | `["confirm","reject","cancel"]` |
| STAFF / ADMIN | `CONFIRMED` | `["pickup","cancel"]` |
| STAFF / ADMIN | `PICKED_UP` | `["return"]` |
| STAFF / ADMIN | `RETURNED` | `["complete"]` |
| Bất kỳ ai | `COMPLETED`, `REJECTED`, `CANCELLED` | `[]` |

Endpoint thực thi phải kiểm tra lại đúng bảng này. `viewerRole` là `CUSTOMER`, `STAFF` hoặc `ADMIN`.

### 7.6 Giao máy, nhận máy, thu chi (`operations`)

- **`pickup`:** chỉ từ `CONFIRMED`. Bắt buộc `idChecked = true` và ít nhất 1 ảnh; `photoPaths` phải thuộc `handover/{bookingId}/` và tồn tại. Số tiền thu phải đủ: tổng `DEPOSIT_RECEIVED ≥ deposit_amount` và tổng `RENTAL_RECEIVED ≥ rental_amount + addons_amount`, nếu không `422 PAYMENT_INCOMPLETE`. Tạo `handover_records` (`PICKUP`) và các `payment_records`, đặt `picked_up_at`.
- **`return`:** chỉ từ `PICKED_UP`, bắt buộc ≥ 1 ảnh, tạo `handover_records` (`RETURN`), đặt `returned_at`.
- **`complete`:** chỉ từ `RETURNED`. Body có `charges` (`DAMAGE_CHARGE`/`LATE_FEE`) và `refundMethod`. BE tính `hoàn cọc = cọc đã thu − Σ charges`; `Σ charges` không được vượt cọc đã thu (`400`). Ghi các `payment_records` tương ứng cùng `DEPOSIT_REFUNDED`, đặt `completed_at`, đặt `booking_units.active = false`.
- Mọi số tiền là số nguyên không âm. Việc ghi sổ và đổi trạng thái chạy trong cùng một transaction. Sổ thu chi **chỉ thêm, không sửa, không xóa**; sai thì ghi bút toán điều chỉnh bằng một giao dịch mới kèm `note`.
- `GET /staff/dashboard`: `pendingCount`; `pickupsToday` (`CONFIRMED` có `start_date` = hôm nay); `returnsToday` (`PICKED_UP` có `end_date` = hôm nay); `overdue`.

### 7.7 Tìm kiếm mẫu máy (`GET /models`)

- Chỉ trả mẫu `is_active`. Chọn danh mục cha thì gồm cả danh mục con.
- `q`: khớp tên và tên hãng, **không phân biệt hoa thường và dấu tiếng Việt** (extension `unaccent`, truy vấn tham số hóa qua raw SQL, tách từ, mỗi từ phải khớp).
- `from`+`to` (và `branch` nếu có): chỉ mẫu có ít nhất một chiếc trống; trả `availableAtBranches`.
- `facets` (giá, danh mục, hãng) tính trên tập kết quả áp dụng mọi bộ lọc **trừ chính nhóm đang đếm**. Khoảng giá cố định: `lt100k`, `100k-300k`, `300k-600k`, `gte600k` (chỉnh sau khi shop chốt bảng giá).
- `isFavorite` tính theo người dùng nếu có token, ngược lại `false`. `NEW` = mẫu tạo trong 14 ngày.

### 7.8 Trợ lý cấu hình AI (`ai-setup`)

- Chỉ dựa vào `rental_model_specs` của mẫu máy; thiếu thông tin thì nói "kiểm tra trên máy hoặc hỏi nhân viên", **không bịa**. Mẫu chưa có thông số: endpoint trả `404` và `aiSetupAvailable = false`.
- **Số liệu phơi sáng tính bằng code** (quy tắc Sunny 16, giới hạn tốc độ chống rung) rồi đưa vào AI; AI chọn ưu tiên và diễn đạt theo đúng nút của máy.
- Lớp trung gian `AiProvider` (interface) để đổi nhà cung cấp. Biến môi trường: `AI_PROVIDER`, `AI_API_KEY`, `AI_MODEL`, `AI_DAILY_LIMIT_PER_USER`. **Khóa AI chỉ ở BE.**
- Kết quả phải đúng định dạng (`summary`, `settings`, `steps`, `tips`, `warnings`); sai thì thử lại một lần, vẫn sai thì trả hướng dẫn tĩnh từ `specs.beginnerNotes` (`fromFallback = true`). Lỗi nhà cung cấp → `503 AI_UNAVAILABLE`.
- Giới hạn lượt theo người dùng mỗi ngày (`429 RATE_LIMITED`). Cache kết quả cho tổ hợp (mẫu máy × tình huống × ISO × ống kính × mức quen dùng) khi không có `customText`.
- **Không gửi tên, số điện thoại, email** cho AI. `customText` tối đa 300 ký tự, bị lọc chỉ để nội dung liên quan đến chụp ảnh.
- Luôn kèm `disclaimer`. Lưu mọi kế hoạch vào `camera_setup_plans`.

## 8. Cấu trúc thư mục

```
src/
├─ main.ts, app.module.ts
├─ modules/
│  ├─ identity/   catalog/   inventory/   booking/   operations/   ai-setup/
│  └─ (mỗi module: controller, service, dto, entities, index.ts)
├─ common/ guards decorators filters interceptors utils
├─ config/        (đọc và validate .env)
├─ infra/         database storage ai
├─ jobs/          (expire-pending-bookings)
└─ health/
test/ unit e2e
docs/ openapi.yaml, BORROLL_FE_BE_CONTRACT.md, decisions/
prisma/ schema.prisma, migrations/, seed.ts
```

## 9. Biến môi trường (`.env.example`)

```
NODE_ENV, PORT=4000
DATABASE_URL, DIRECT_URL
SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
STORAGE_BUCKET_AVATARS=avatars
STORAGE_BUCKET_RENTAL_IMAGES=rental-images
STORAGE_BUCKET_HANDOVER=handover-photos
JWT_ACCESS_SECRET, JWT_ACCESS_TTL=15m
REFRESH_TTL_DAYS=30
CORS_ORIGIN=http://localhost:3000
BOOKING_PENDING_TTL_HOURS=24
AI_PROVIDER, AI_API_KEY, AI_MODEL, AI_DAILY_LIMIT_PER_USER=20
```
Chỉ commit `.env.example`, không commit `.env` hay khóa thật.

## 10. Dữ liệu mẫu (`prisma/seed.ts`, chỉ local/staging, từ chối chạy khi `NODE_ENV=production`)

1 admin, 2 nhân viên, 2 khách (mật khẩu mẫu chỉ dùng local); 2 chi nhánh (Tây Hồ, Thanh Xuân); cây danh mục và ~10 hãng; ~25 mẫu máy (film và digital, vài ống kính) với giá, cọc, ảnh, thông số; ~40 chiếc máy phân bổ hai chi nhánh (có mẫu nhiều chiếc, có chiếc bảo trì); vài loại film; vài đơn mẫu ở các trạng thái khác nhau.

## 11. Test bắt buộc

1. **Đặt đồng thời:** nhiều request cùng đặt một mẫu chỉ còn 1 chiếc trong cùng khoảng ngày → đúng một đơn thành công, các đơn còn lại `409 NO_UNIT_AVAILABLE`. Mẫu còn 2 chiếc thì hai đơn thành công, đơn thứ ba bị từ chối.
2. Đơn `REJECTED`/`CANCELLED`/`COMPLETED` giải phóng chiếc máy; ngày trả không chặn người khác nhận.
3. Khóa bảo trì chặn đặt trùng; khóa trùng đơn đang hoạt động bị `409 BOOKING_DATE_UNAVAILABLE`; **chạy đồng thời giữa "tạo đơn" và "khóa bảo trì"** cho cùng một chiếc thì chỉ một thao tác thành công.
4. State machine: chuyển sai bị `409`; bảng `allowedActions` đúng theo người xem và trạng thái.
5. Phân quyền: khách không xem được đơn người khác (`404`); STAFF vào được `/staff/*`; khách bị `403` ở `/staff/*` và `/admin/*`; STAFF bị `403` ở `/admin/*`.
6. Tính tiền: 1 ngày, 3 ngày, 7 ngày, 8 ngày (có giá tuần), đơn nhiều món có film; `quote` khớp đơn thật.
7. `INCOMPATIBLE_ITEMS` khi ống kính khác ngàm; `MODEL_NOT_BOOKABLE` khi mẫu bị ẩn.
8. `pickup`: thiếu ảnh hoặc `idChecked = false` → `400`; thu thiếu tiền → `422 PAYMENT_INCOMPLETE`. `complete`: hoàn cọc tính đúng, tổng `charges` vượt cọc → `400`, sổ thu chi không sửa được.
9. Hết hạn: đơn `PENDING` quá hạn thành `CANCELLED` và giải phóng chiếc máy; `isOverdue` đúng ở ranh giới nửa đêm giờ Việt Nam.
10. Tìm kiếm: gõ không dấu ("may anh fuji") vẫn khớp "Máy ảnh Fujifilm"; lọc ngày, chi nhánh, danh mục cha và `facets` đúng.
11. Refresh token: xoay vòng đúng, dùng lại token cũ thì cả `family_id` bị thu hồi; hai request refresh đồng thời chỉ một cái thành công.
12. AI: mẫu thiếu thông số → `404`; trả sai định dạng thì dùng bản dự phòng; vượt giới hạn lượt → `429`; không gửi dữ liệu cá nhân cho nhà cung cấp.
