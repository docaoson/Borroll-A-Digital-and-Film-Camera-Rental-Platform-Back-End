# BORROLL BACKEND — HƯỚNG DẪN CHO AI AGENT

Repo: `borroll-backend`. Đọc hết file này trước khi viết code.

## 0. Bối cảnh

Borroll là nền tảng trung gian kết nối **người thuê** và **chủ máy** để cho thuê máy ảnh số và máy ảnh film. Ba vai trò: `RENTER`, `HOST`, `ADMIN`. Một tài khoản có thể vừa là RENTER vừa là HOST; ADMIN là tài khoản riêng.

**Nguồn sự thật cho hình dạng request/response:** `docs/BORROLL_FE_BE_CONTRACT.md` (hợp đồng với FE). File này chỉ nói về **cách xây**; khi cần biết một endpoint nhận/trả JSON gì thì mở hợp đồng. Nếu hai tài liệu mâu thuẫn, hợp đồng thắng về hình dạng dữ liệu. Sau khi code xong phải xuất `docs/openapi.yaml` từ Swagger và đối chiếu với hợp đồng.

## 1. Kiến trúc: Modular Monolith

- Một ứng dụng NestJS, một database PostgreSQL (Supabase), deploy một khối.
- Chia **module theo miền nghiệp vụ**: `identity`, `catalog`, `booking` (về sau `payment`, `messaging`, `review`, `dispute`, `notification`, `admin`).
- **Ranh giới module (bắt buộc):**
  - Module này KHÔNG truy cập bảng/repository của module khác. Cần dữ liệu thì gọi **service được export** của module đó.
  - Giao tiếp bất đồng bộ giữa module bằng **domain event** (`@nestjs/event-emitter`), ví dụ `booking.created`, `booking.approved`, `booking.cancelled`.
  - Mỗi module chỉ export những gì cần qua `index.ts`.
- KHÔNG dùng: microservices, message broker, GraphQL, CQRS/event sourcing, Redis (giai đoạn này).

## 2. Stack

| Hạng mục | Công nghệ |
|---|---|
| Runtime / Framework | Node 22, NestJS, TypeScript (strict) |
| Database | PostgreSQL trên **Supabase** |
| ORM | Prisma (kèm migration SQL tay cho phần Prisma không hỗ trợ) |
| Auth | Tự làm trong module `identity`: JWT access + refresh token, `argon2` |
| Validate | `class-validator` + `class-transformer` |
| API docs | `@nestjs/swagger` → xuất `docs/openapi.yaml` |
| File | **Supabase Storage** (qua `@supabase/supabase-js`, chỉ dùng ở BE) |
| Job định kỳ | `@nestjs/schedule` (cron) |
| Rate limit | `@nestjs/throttler` (bộ nhớ trong) |
| Test | Jest + Supertest |

Không dùng Supabase Auth, không dùng Data API/PostgREST của Supabase. Mọi truy cập dữ liệu đi qua NestJS.

## 3. Cấu hình Supabase

**Chuỗi kết nối (hai URL, không đổi chỗ cho nhau):**
```
# App chạy: qua transaction pooler (cổng 6543)
DATABASE_URL="postgresql://postgres.[ref]:[pw]@aws-0-[region].pooler.supabase.com:6543/postgres?pgbouncer=true"
# Migration / Prisma CLI: kết nối trực tiếp (cổng 5432)
DIRECT_URL="postgresql://postgres:[pw]@db.[ref].supabase.co:5432/postgres"
```
- `schema.prisma` khai báo `url = env("DATABASE_URL")` và `directUrl = env("DIRECT_URL")`. Nếu dự án dùng Prisma 7 thì cấu hình `datasource.url` trong `prisma.config.ts` trỏ tới `DIRECT_URL` cho CLI, và Prisma Client dùng adapter với `DATABASE_URL`. **Đọc tài liệu đúng phiên bản Prisma đang cài.**
- Dùng `DATABASE_URL` (pooler) cho `migrate` sẽ làm lệnh treo. Nếu `DIRECT_URL` không kết nối được trên mạng chỉ có IPv4, dùng session pooler (cổng 5432 trên host `pooler.supabase.com`).
- Bảng của Borroll nằm trong schema `public`. **Không** sửa các schema `auth`, `storage`, `realtime` bằng Prisma.
- Bật extension `btree_gist` (migration có `CREATE EXTENSION IF NOT EXISTS btree_gist`).
- **Bật RLS cho mọi bảng** và **không tạo policy** cho `anon`/`authenticated`, để không ai đọc được dữ liệu bằng khóa công khai. BE kết nối bằng chuỗi Postgres nên không bị ảnh hưởng. Thêm `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` vào migration của mỗi bảng.
- `SUPABASE_SERVICE_ROLE_KEY` chỉ nằm trong biến môi trường của BE, không bao giờ trả về client hoặc commit.

**Storage:**
- Bucket `camera-images`: công khai (ảnh máy hiển thị trên web).
- Bucket `kyc-documents`: **riêng tư** (CCCD, selfie). Chỉ xem qua signed URL ngắn hạn, chỉ cấp cho admin hoặc chính chủ.
- Bucket `avatars`: công khai (ảnh đại diện).
- Cài `StorageService` (interface) với một cài đặt dùng Supabase: `createUploadUrl(bucket, path, contentType)`, `getPublicUrl(path)`, `createSignedUrl(bucket, path, ttlSeconds)`, `remove(path)`. Module khác chỉ gọi interface này.
- Luồng tải ảnh: BE xin **signed upload URL** từ Supabase và trả cho FE; FE `PUT` file trực tiếp; sau đó FE báo `path` cho BE để đăng ký. BE phải kiểm tra `path` thuộc đúng thư mục của người dùng/máy đó trước khi lưu.
- Ảnh máy: JPG/PNG/WebP, tối đa 5 MB mỗi ảnh, tối đa 10 ảnh mỗi tin. Ảnh đại diện: JPG/PNG/WebP, tối đa 2 MB. Path luôn nằm trong thư mục của chủ thể (`avatars/{userId}/...`, `cameras/{cameraId}/...`, `kyc/{userId}/...`) và BE phải kiểm tra điều này khi nhận `path` từ client.

**Môi trường:** local dùng Postgres chạy bằng Docker (`docker-compose.yml`); staging và production là hai project Supabase **riêng**. Local có thể dùng Storage của một project Supabase dev.

## 4. Quy ước API

- Tiền tố `/api/v1`. REST, JSON.
- Ngày thuê: chuỗi `YYYY-MM-DD`. Thời điểm: ISO 8601 UTC. Tiền: **số nguyên VND**.
- Phân trang: `page` (từ 1), `pageSize` (mặc định 32, tối đa 100) → `{ items, page, pageSize, total }`.
- Lỗi thống nhất qua exception filter: `{ "error": { "code", "message", "details" } }`. Lỗi validate: `400 VALIDATION_ERROR` với `details.fields = { tenTruong: "thông báo tiếng Việt" }`. Danh sách mã lỗi có trong hợp đồng mục 1.4; `message` là tiếng Việt.
- `ValidationPipe` toàn cục: `whitelist: true`, `forbidNonWhitelisted: true`, `transform: true`.
- CORS chỉ cho domain FE (`CORS_ORIGIN`), bật `credentials`.
- Rate limit nghiêm ngặt cho `/auth/*`.
- ID dạng `cuid` hoặc UUID v7. Máy ảnh có thêm `slug` duy nhất (sinh từ tiêu đề + hậu tố ngắn để tránh trùng).

## 5. Xác thực và phân quyền

**Xác thực:**
- Đăng ký/đăng nhập: băm mật khẩu bằng `argon2`. Email lưu chữ thường, duy nhất.
- Access token JWT sống 15 phút, trả trong body. Hết hạn → `401 TOKEN_EXPIRED`.
- Refresh token ngẫu nhiên, **chỉ lưu hash** trong `refresh_tokens`, gửi qua cookie `httpOnly`, `Secure`, `SameSite=Lax`, sống 30 ngày. Mỗi lần refresh **xoay vòng**: thu hồi token cũ, cấp token mới. Dùng lại token đã thu hồi thì thu hồi cả chuỗi của người đó.
- `POST /auth/login` sai thông tin luôn trả `INVALID_CREDENTIALS`, không tiết lộ email có tồn tại hay không.

**Phân quyền hai lớp (bắt buộc):**
1. **RBAC:** `@Roles('HOST')`, `@Roles('ADMIN')` bằng `RolesGuard`. Thiếu role HOST → `403 HOST_NOT_ENABLED`.
2. **Ownership:** kiểm tra quyền sở hữu trong service. Host chỉ sửa tin của mình, chỉ duyệt đơn của máy mình; renter chỉ xem đơn của mình. Truy vấn luôn ràng buộc theo `userId` từ token, không tin `userId` từ client. Truy cập tài nguyên không thuộc mình trả `404 NOT_FOUND` (không dùng 403, để không lộ sự tồn tại).

Mọi hành động của admin (duyệt/từ chối tin, duyệt/từ chối KYC) ghi vào `audit_logs`.

## 6. Lược đồ dữ liệu

Prisma, tên bảng snake_case (`@@map`), mọi bảng có `created_at`, `updated_at`, và bật RLS.

**identity**
- `users`: id, email (unique), phone, password_hash, full_name, avatar_path, status (`ACTIVE|SUSPENDED`), kyc_status (`NONE|PENDING|VERIFIED|REJECTED`).
- `user_roles`: user_id, role (`RENTER|HOST|ADMIN`); khóa chính (user_id, role). Đăng ký mặc định có `RENTER`.
- `refresh_tokens`: id, user_id, token_hash, family_id, expires_at, revoked_at, user_agent.
- `kyc_submissions`: id, user_id, id_front_path, id_back_path, selfie_path, status (`PENDING|VERIFIED|REJECTED`), reject_reason, reviewed_by, reviewed_at. (Lưu **path**, không lưu URL; URL ảnh riêng tư cấp lúc đọc.) `avatar_path` của `users` cũng vậy: response dựng `avatarUrl` công khai từ path.)
- `audit_logs`: id, actor_id, action, target_type, target_id, metadata (jsonb).

**catalog**
- `categories`: id, parent_id, name, slug (unique), type (`CAMERA_DIGITAL|CAMERA_FILM|LENS|ACCESSORY`).
- `brands`: id, name, slug (unique).
- `cameras`: id, host_id, category_id, brand_id, slug (unique), title, description, model, camera_type (`DIGITAL|FILM`), mount, condition_note, shutter_count, film_format, price_per_day, price_per_week, deposit, city, district, status (`DRAFT|PENDING_REVIEW|ACTIVE|PAUSED|REJECTED`), reject_reason, cancellation_policy, hot (boolean, do admin gắn), approved_at (dùng để tính nhãn `NEW`: trong 14 ngày sau khi được duyệt). Response trả `badges` được tính từ `hot` và `approved_at`. Chưa hỗ trợ giảm giá.
- `camera_images`: id, camera_id, path, sort_order.
- `camera_accessories`: id, camera_id, name, icon.
- `favorites`: user_id, camera_id (khóa chính kép).

**booking**
- `bookings`: id, code (unique, dạng `BR-XXXXX`), camera_id, renter_id, host_id, start_date, end_date, **during** (xem dưới), days, rental_amount, deposit_amount, platform_fee, status, note, expires_at, rejected_reason, cancelled_reason, các mốc thời gian (`approved_at`, `cancelled_at`...).
- `booking_status_logs`: id, booking_id, from_status, to_status, actor_id, note.
- `blocked_dates`: id, camera_id, start_date, end_date, reason, **during**.

### Chống đặt trùng lịch (BẮT BUỘC ở tầng DB)

Cột `during` là cột **sinh tự động** để code không phải tự điền:
```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE bookings
  ADD COLUMN during daterange
  GENERATED ALWAYS AS (daterange(start_date, end_date, '[)')) STORED;

ALTER TABLE bookings
  ADD CONSTRAINT bookings_no_overlap
  EXCLUDE USING gist (camera_id WITH =, during WITH &&)
  WHERE (status IN ('PENDING','OWNER_APPROVED','PAID','HANDED_OVER'));

ALTER TABLE blocked_dates
  ADD COLUMN during daterange
  GENERATED ALWAYS AS (daterange(start_date, end_date, '[)')) STORED;

ALTER TABLE blocked_dates
  ADD CONSTRAINT blocked_no_overlap
  EXCLUDE USING gist (camera_id WITH =, during WITH &&);
```
- Khai báo cột `during` trong Prisma là `Unsupported("daterange")?` (hoặc bỏ khỏi schema) và tạo bằng migration SQL tay; **kiểm tra `prisma migrate dev` không đòi xóa cột này**, nếu có thì chỉnh schema cho khớp.
- Khoảng thuê là **nửa mở** `[start, end)`: ngày trả không tính kín, người khác nhận máy đúng ngày đó.
- Giữa `bookings` và `blocked_dates` không có constraint chung. Để chống race condition, trong transaction tạo đơn và transaction tạo khoảng chặn, khóa dòng máy ảnh trước bằng `SELECT id FROM cameras WHERE id = $1 FOR UPDATE`, rồi mới kiểm tra chéo và insert. Khi DB báo vi phạm exclusion constraint, bắt lỗi (mã `23P01`) và đổi thành `409 BOOKING_DATE_UNAVAILABLE`.

## 7. Quy tắc nghiệp vụ

### 7.1 Tính ngày và tiền (`PricingService`)

- `days = endDate − startDate`, tối thiểu 1. `startDate` không ở quá khứ; `endDate > startDate`.
- `rental_amount`: nếu có `price_per_week` và `days ≥ 7` thì áp giá tuần cho từng tuần đủ, phần dư tính theo `price_per_day`; ngược lại `days × price_per_day`.
- `deposit_amount = camera.deposit`.
- `platform_fee = floor(rental_amount × PLATFORM_FEE_PERCENT / 100)` (mặc định 10).
- `totalDueAtPickup = rental_amount + platform_fee + deposit_amount`.
- Lưu **bản chụp** các số này vào đơn; không tính lại khi giá máy đổi sau đó.
- `POST /bookings/quote` dùng đúng `PricingService` này và kiểm tra còn trống (trả `available`, `conflictingDates`), **không giữ chỗ và không ghi DB**.

### 7.2 State machine của đơn thuê

```
PENDING → OWNER_APPROVED → PAID → HANDED_OVER → RETURNED → COMPLETED
   ↓            ↓            ↓          ↓
REJECTED    CANCELLED    CANCELLED   DISPUTED
```
- Cài trong `booking.state-machine.ts` dưới dạng bảng chuyển trạng thái hợp lệ. Chuyển sai → `409 INVALID_STATUS_TRANSITION`.
- Mỗi lần chuyển chạy trong transaction: cập nhật đơn, ghi `booking_status_logs`, rồi phát domain event.
- **Hiện chỉ cài:** `PENDING`, `OWNER_APPROVED`, `REJECTED`, `CANCELLED`. Các trạng thái từ `PAID` trở đi thuộc module Payment (chưa làm).
- Tạo đơn: `PENDING`, `expires_at = now + 24h`. Không cho chủ máy tự đặt máy của mình (`CANNOT_BOOK_OWN_CAMERA`), máy phải `ACTIVE` (`CAMERA_NOT_BOOKABLE`).
- Job cron mỗi 10 phút: đơn `PENDING` có `expires_at` đã qua → `CANCELLED` với lý do "Hết hạn chờ duyệt".

### 7.3 `allowedActions` và `viewerRole` trong chi tiết đơn

| Người xem | Trạng thái | `allowedActions` |
|---|---|---|
| Renter của đơn | `PENDING`, `OWNER_APPROVED` | `["cancel"]` |
| Host của đơn | `PENDING` | `["approve","reject"]` |
| Admin | `PENDING`, `OWNER_APPROVED` | `["cancel"]` |
| Mọi người | `REJECTED`, `CANCELLED` | `[]` |

Endpoint thực thi phải kiểm tra lại đúng bảng này (không tin FE).

### 7.4 Quyền riêng tư trong đơn

`phone` của renter/host chỉ trả khi đơn `OWNER_APPROVED`; trước đó trả `null`.

### 7.5 Tìm kiếm máy (`GET /cameras`)

- Chỉ trả tin `ACTIVE`.
- Lọc `from`+`to`: loại máy có đơn hoạt động hoặc ngày bị chặn giao với khoảng đó (dùng toán tử `&&` trên `during`; cần raw SQL hoặc `$queryRaw`). Khi có `from`/`to`, mỗi máy trả `availableForRange: true`.
- `facets` (giá, danh mục, hãng) tính trên tập kết quả **áp dụng mọi bộ lọc trừ chính nhóm đang đếm**, để sidebar luôn đúng. Khoảng giá cố định: `lt100k`, `100k-300k`, `300k-600k`, `gte600k`.
- Sắp xếp: `default`, `price_asc`, `price_desc`, `newest`.
- **Từ khóa `q`:** khớp với `title`, `model` và tên hãng, **không phân biệt hoa thường và dấu tiếng Việt**. Bật extension `unaccent` (migration `CREATE EXTENSION IF NOT EXISTS unaccent;`) và so khớp bằng `unaccent(lower(...)) ILIKE unaccent(lower('%' || :q || '%'))` qua raw SQL có tham số hóa (không nối chuỗi, tránh SQL injection). Tách `q` thành các từ, mỗi từ phải khớp (AND). Chưa cần index chuyên dụng ở giai đoạn này.
- **`badge`:** `HOT` lọc máy có `hot = true`; `NEW` lọc máy được duyệt trong 14 ngày gần nhất.
- **`excludeId`:** loại máy có id đó khỏi kết quả (dùng cho "máy tương tự" ở trang chi tiết: cùng `category`, `pageSize` nhỏ).
- **`isFavorite`:** nằm trong cấu trúc thẻ máy tóm tắt (`CameraSummary` dùng chung cho `GET /cameras`, `GET /favorites`, danh sách máy trong `GET /hosts/:id`). Endpoint công khai nhận access token tùy chọn: có token thì tính `isFavorite` theo người dùng, không có thì `false`.
- Đánh index phù hợp: `cameras(status, city, district)`, `cameras(price_per_day)`, `cameras(brand_id)`, `cameras(category_id)`, `bookings(camera_id)`, và các index GiST đi kèm constraint.

### 7.6 Tin đăng

- `POST /host/cameras` nhận `categorySlug` và `brandSlug`; BE tự tra sang `category_id` và `brand_id`. Nếu slug không tồn tại thì trả `400 VALIDATION_ERROR` kèm `details.fields`.
- `DRAFT` cho phép thiếu trường; `submit` mới kiểm tra đủ các trường bắt buộc: ít nhất 1 ảnh, `title`, `model`, `cameraType`, danh mục (`category`), hãng (`brand`), `price_per_day`, `deposit`, `city`, `district`. Các trường còn lại là tùy chọn. Thiếu trường bắt buộc → `400 VALIDATION_ERROR` kèm `fields`.
- `PENDING_REVIEW` không sửa được. `REJECTED` sửa được và gửi duyệt lại.
- `pause`/`resume` chỉ với tin `ACTIVE`/`PAUSED`. Máy có đơn `PENDING`/`OWNER_APPROVED` trong tương lai thì vẫn cho tạm ẩn nhưng không hủy đơn.
- Admin reject và KYC reject **bắt buộc** có `reason`.
- Chủ máy chỉ đăng được khi có role `HOST`. Hiện tại không bắt buộc KYC `VERIFIED` để đăng; `verified` trong response là `kyc_status = VERIFIED`.

### 7.7 Lịch

- `GET /cameras/:id/availability?month=YYYY-MM` trả `unavailableDates` (đêm bị đơn hoạt động giữ) và `blockedByHostDates` (đêm chủ tự chặn). Chỉ chủ sở hữu máy mới thấy `blockedByHostDates` tách riêng; người khác nhận danh sách này gộp vào `unavailableDates`.
- Chặn lịch trùng với đơn hoạt động → `409 BOOKING_DATE_UNAVAILABLE`.

### 7.8 Hồ sơ chủ máy công khai (`GET /hosts/:id`)

- Chủ máy phải có role `HOST` và `status = ACTIVE`; nếu không → `404`.
- Trả: `id`, `fullName`, `avatarUrl`, `verified` (`kyc_status = VERIFIED`), `completedRentals` (đếm đơn `COMPLETED`, hiện luôn là 0), `joinedAt`, và `cameras` (danh sách tin `ACTIVE` của chủ máy, cùng cấu trúc như `GET /cameras`, có phân trang).
- **Tuyệt đối không** trả email, số điện thoại, hay thông tin KYC.
- `host.verified` ở các response khác (danh sách máy, chi tiết máy) dùng cùng quy tắc.

### 7.9 Ảnh đại diện

- `POST /me/avatar/presign` cấp signed upload URL vào bucket `avatars`, path dạng `avatars/{userId}/{random}.{ext}`.
- `PATCH /me` nhận `avatarPath`: chỉ chấp nhận path bắt đầu bằng `avatars/{userId}/` của chính người gọi, ngược lại `400 VALIDATION_ERROR`. `null` để xóa ảnh (và xóa file cũ trong Storage). Response `me` trả `avatarUrl` dựng từ path.

### 7.10 Đọc hồ sơ KYC của chính mình (`GET /me/kyc`)

Trả hồ sơ mới nhất của người gọi: `status`, `rejectReason`, `submittedAt`, `reviewedAt`. Chưa từng gửi → `status: "NONE"` và các trường còn lại `null`. Không trả path hay URL ảnh giấy tờ. Hồ sơ `REJECTED` cho phép gửi hồ sơ mới; đang `PENDING` thì gửi thêm bị `409 INVALID_STATUS_TRANSITION`. Khi admin duyệt hoặc từ chối, cập nhật cả `kyc_submissions.status` và `users.kyc_status`.

### 7.11 Chặn lịch: đọc danh sách

`GET /host/blocked-dates?cameraId=&from=&to=`: `cameraId` bắt buộc và phải là máy của người gọi (không thì `404`). Nếu có `from`/`to` thì chỉ trả các khoảng giao với khoảng đó. Mỗi phần tử gồm `id`, `cameraId`, `startDate`, `endDate`, `reason`. `DELETE /host/blocked-dates/:id` chỉ chủ sở hữu máy xóa được.

### 7.12 Xóa tin đăng và nhãn Hot

- `DELETE /host/cameras/:id`: chỉ chủ sở hữu và chỉ khi `status = DRAFT`; trả `204`, xóa luôn ảnh trong Storage và bản ghi liên quan. Trạng thái khác → `409 INVALID_STATUS_TRANSITION`.
- `GET /admin/cameras`: nhận query `status` với bất kỳ giá trị trạng thái tin đăng nào (`DRAFT`, `PENDING_REVIEW`, `ACTIVE`, `PAUSED`, `REJECTED`); bỏ trống thì mặc định `PENDING_REVIEW`; có phân trang (`page`, `pageSize`).
- `PATCH /admin/cameras/:id/promotion` với `{ "hot": true|false }`: chỉ admin, chỉ áp dụng cho tin `ACTIVE`; ghi `audit_logs`.

## 8. Danh sách endpoint

Hình dạng request/response chi tiết nằm trong `docs/BORROLL_FE_BE_CONTRACT.md` mục 4. Danh sách cần cài:

**Identity:** `POST /auth/register`, `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`, `GET /me`, `PATCH /me`, `POST /me/become-host`, `POST /me/avatar/presign`, `GET /me/kyc`, `POST /me/kyc/presign`, `POST /me/kyc`.

**Catalog (public):** `GET /categories`, `GET /brands`, `GET /cameras`, `GET /cameras/:slug`, `GET /cameras/:id/availability`, `GET /hosts/:id`.
**Catalog (user):** `POST /favorites/:cameraId`, `DELETE /favorites/:cameraId`, `GET /favorites`.
**Catalog (host):** `POST /host/cameras`, `GET /host/cameras`, `GET /host/cameras/:id`, `PATCH /host/cameras/:id`, `DELETE /host/cameras/:id` (chỉ `DRAFT`), `POST /host/cameras/:id/submit`, `POST /host/cameras/:id/pause`, `POST /host/cameras/:id/resume`, `POST /host/cameras/:id/images/presign`, `POST /host/cameras/:id/images`, `PATCH /host/cameras/:id/images/order`, `DELETE /host/cameras/:id/images/:imageId`.
**Catalog (admin):** `GET /admin/cameras`, `POST /admin/cameras/:id/approve`, `POST /admin/cameras/:id/reject`, `PATCH /admin/cameras/:id/promotion`.

**Booking:** `POST /bookings/quote`, `POST /bookings`, `GET /bookings`, `GET /bookings/:id`, `POST /bookings/:id/cancel` (chỉ dành cho renter của đơn), `GET /host/bookings`, `POST /host/bookings/:id/approve`, `POST /host/bookings/:id/reject`, `GET /host/blocked-dates`, `POST /host/blocked-dates`, `DELETE /host/blocked-dates/:id`.

**Admin Booking & KYC:** `POST /admin/bookings/:id/cancel` (chỉ hủy được đơn `PENDING` hoặc `OWNER_APPROVED`, body có `reason` bắt buộc, ghi `audit_logs`), `GET /admin/kyc-submissions`, `POST /admin/kyc-submissions/:id/approve`, `POST /admin/kyc-submissions/:id/reject`.

**Không có** giỏ hàng, đánh giá, giảm giá (FE xử lý riêng, xem hợp đồng mục 2.5).

Mọi endpoint có decorator Swagger (`@ApiTags`, `@ApiOperation`, `@ApiResponse`) và DTO riêng.

## 9. Cấu trúc thư mục (giữ nguyên đã tạo)

```
src/
├─ main.ts, app.module.ts
├─ modules/
│  ├─ identity/   (controller, service, dto, entities, index.ts)
│  ├─ catalog/
│  └─ booking/    (booking.state-machine.ts, pricing.service.ts)
├─ common/ guards decorators filters interceptors utils
├─ config/        (đọc và validate .env)
├─ infra/         database storage
└─ jobs/          (expire-pending-bookings)
test/ unit e2e
docs/ openapi.yaml, BORROLL_FE_BE_CONTRACT.md, decisions/
prisma/ schema.prisma, migrations/, seed.ts
```

## 10. Biến môi trường (`.env.example`)

```
NODE_ENV, PORT=4000
DATABASE_URL, DIRECT_URL
SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
STORAGE_BUCKET_CAMERA_IMAGES=camera-images
STORAGE_BUCKET_KYC=kyc-documents
STORAGE_BUCKET_AVATARS=avatars
JWT_ACCESS_SECRET, JWT_ACCESS_TTL=15m
REFRESH_TTL_DAYS=30
CORS_ORIGIN=http://localhost:3000
PLATFORM_FEE_PERCENT=10
BOOKING_PENDING_TTL_HOURS=24
```
Chỉ commit `.env.example`, không commit `.env` hay khóa thật.

## 11. Dữ liệu mẫu (`prisma/seed.ts`, chỉ cho local/staging)

1 admin, 2 host, 2 renter (mật khẩu mẫu chỉ dùng local); danh mục (Digital, Film, Ống kính, Phụ kiện kèm các cấp con), ~10 hãng, ~40 máy mẫu ở Hà Nội (Tây Hồ, Thanh Xuân, Cầu Giấy...) với đủ trạng thái, vài đơn mẫu ở các trạng thái khác nhau.

## 12. Test bắt buộc

1. Hai đơn trùng ngày tạo **song song** cho cùng một máy: đúng một đơn thành công, đơn kia `409 BOOKING_DATE_UNAVAILABLE`.
2. Đơn `CANCELLED`/`REJECTED` giải phóng ngày; ngày trả máy không chặn người khác nhận.
3. Chuyển trạng thái sai bị chặn (`INVALID_STATUS_TRANSITION`).
4. Host A không sửa được tin hoặc duyệt đơn của host B (`404`); renter không xem được đơn của người khác.
5. Tính tiền đúng cho 1 ngày, 3 ngày, 7 ngày, 8 ngày (có giá tuần); `quote` khớp với đơn thật được tạo.
6. Tin `DRAFT`/`PENDING_REVIEW`/`PAUSED` không xuất hiện ở `GET /cameras`.
7. `phone` bị ẩn trước khi đơn được duyệt.
8. Refresh token: xoay vòng đúng, dùng lại token cũ bị từ chối.
9. Job hết hạn chuyển đơn `PENDING` quá hạn thành `CANCELLED`.
10. `GET /cameras?q=`: gõ không dấu ("may anh sony") vẫn khớp "Máy ảnh Sony"; `badge=HOT` và `excludeId` hoạt động đúng.
11. `GET /hosts/:id`: trả `404` cho người không phải HOST hoặc không tồn tại; response không chứa email/số điện thoại; chỉ có tin `ACTIVE`.
12. `GET /me/kyc`: trả `NONE` khi chưa gửi, trả `rejectReason` sau khi bị từ chối; không cho gửi hồ sơ mới khi đang `PENDING`.
13. `PATCH /me` với `avatarPath` của người khác bị từ chối; `GET /host/blocked-dates` của máy người khác trả `404`.
14. `DELETE /host/cameras/:id`: xóa được tin `DRAFT` của mình, `409` với tin khác trạng thái, `404` với tin của người khác.
15. Chạy đồng thời giữa "tạo đơn" và "chặn lịch" cho cùng một máy: đúng một thao tác thành công, thao tác kia bị từ chối với `409 BOOKING_DATE_UNAVAILABLE`.
