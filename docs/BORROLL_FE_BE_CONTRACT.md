# BORROLL — THỎA THUẬN GIỮA FE VÀ BE (BẢN CỬA HÀNG)

Do **BE** viết và giữ, dành cho **FE**. Gồm: (1) quy ước chung, (2) danh sách trang và API từng trang, (3) hợp đồng API.
Bối cảnh và lý do thiết kế nằm ở `BORROLL_STORE_PLAN.md`. Khi tài liệu này khác với `docs/openapi.yaml` (BE xuất ra từ code) thì **`openapi.yaml` đúng**, hãy báo BE sửa tài liệu.

Bản này thay thế hoàn toàn bản nền tảng cũ: **không còn chủ máy, không còn duyệt tin, không còn KYC, không còn giỏ hàng.**

---

## 1. QUY ƯỚC CHUNG

### 1.1 Địa chỉ và xác thực

- Base URL: `{API_URL}/api/v1` (FE đọc từ `NEXT_PUBLIC_API_URL`).
- Đăng nhập trả **access token** trong JSON (sống 15 phút). FE giữ trong bộ nhớ, **không** lưu localStorage, gửi ở header `Authorization: Bearer <token>`.
- **Refresh token** nằm trong cookie `httpOnly`, FE không đọc được. Mọi request phải gửi `credentials: 'include'`.
- Khi API trả `401` với `error.code = "TOKEN_EXPIRED"`: gọi `POST /auth/refresh` **một lần** rồi gửi lại request cũ (dùng một promise chung để nhiều request không refresh cùng lúc). Refresh cũng `401` thì chuyển về `/login?next=<trang hiện tại>`.
- Endpoint đánh dấu 🌐 là công khai. Riêng 🌐* **nhận token tùy chọn**: có token thì trả thêm dữ liệu cá nhân (ví dụ `isFavorite`), không có thì coi như khách vãng lai.
- Vai trò: `RENTER` (hiển thị là **Khách**), `STAFF` (nhân viên), `ADMIN`. Mã vai trò `RENTER` giữ nguyên từ bản cũ. `HOST` không còn dùng.
- **Quyền nằm trong access token.** Khi admin đổi vai trò của ai đó, người đó phải đăng nhập lại hoặc chờ token hết hạn (tối đa 15 phút) mới có quyền mới.

### 1.2 Định dạng dữ liệu

| Loại | Quy ước | Ví dụ |
|---|---|---|
| Tiền | Số nguyên VND, không thập phân | `350000` |
| Ngày thuê | Chuỗi `YYYY-MM-DD` | `"2026-12-03"` |
| Thời điểm | ISO 8601 UTC | `"2026-11-07T08:30:00Z"` |
| ID | Chuỗi | `"clx9..."` |
| Phân trang | Query `page` (từ 1), `pageSize` (mặc định 20, tối đa 100) | |
| Danh sách | `{ "items": [...], "page": 1, "pageSize": 20, "total": 120 }` | |

FE tự định dạng hiển thị (`350.000 đ`, `03/12/2026`). "Hôm nay" luôn tính theo múi giờ **Asia/Ho_Chi_Minh**.

### 1.3 Quy tắc tính ngày thuê

- Khách chọn **ngày nhận** (`startDate`) và **ngày trả** (`endDate`).
- **Số ngày = `endDate` − `startDate`**, tối thiểu 1. Nhận 12/12, trả 14/12 là 2 ngày.
- Ngày trả máy **không** bị tính là kín: người khác có thể nhận đúng ngày đó.
- Nhận và trả máy **tại cùng một chi nhánh** (chi nhánh khách chọn khi đặt). Không giao hàng tận nơi.

### 1.4 Định dạng lỗi

```json
{ "error": { "code": "NO_UNIT_AVAILABLE", "message": "Hết máy trong khoảng ngày này.", "details": {} } }
```

Lỗi form (`400 VALIDATION_ERROR`): `details = { "fields": { "phone": "Số điện thoại không hợp lệ" } }`. FE hiển thị lỗi dưới từng ô. `message` là tiếng Việt, có thể hiển thị thẳng.

| HTTP | `code` | Khi nào |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Dữ liệu gửi lên sai |
| 401 | `UNAUTHENTICATED` | Chưa đăng nhập |
| 401 | `TOKEN_EXPIRED` | Access token hết hạn |
| 401 | `INVALID_CREDENTIALS` | Sai email hoặc mật khẩu |
| 403 | `FORBIDDEN` | Không đủ quyền |
| 403 | `ACCOUNT_SUSPENDED` | Tài khoản bị khóa |
| 404 | `NOT_FOUND` | Không tồn tại, hoặc không có quyền xem |
| 409 | `EMAIL_ALREADY_USED` | Đăng ký trùng email |
| 409 | `NO_UNIT_AVAILABLE` | Hết máy trong khoảng ngày ở chi nhánh đã chọn |
| 409 | `BOOKING_DATE_UNAVAILABLE` | Khóa bảo trì trùng với đơn đang hoạt động |
| 409 | `INVALID_STATUS_TRANSITION` | Hành động không hợp lệ với trạng thái hiện tại |
| 422 | `MODEL_NOT_BOOKABLE` | Mẫu máy đang ẩn hoặc ngừng cho thuê |
| 422 | `INCOMPATIBLE_ITEMS` | Ống kính không cùng ngàm với thân máy trong đơn |
| 422 | `PAYMENT_INCOMPLETE` | Số tiền thu lúc giao máy chưa đủ |
| 429 | `RATE_LIMITED` | Gọi quá nhiều (auth, AI) |
| 503 | `AI_UNAVAILABLE` | Trợ lý AI tạm thời không dùng được |

### 1.5 Giá trị liệt kê và nhãn hiển thị

**Trạng thái đơn (`booking.status`)**

| Giá trị | Nhãn | Màu badge |
|---|---|---|
| `PENDING` | Chờ shop xác nhận | warning |
| `CONFIRMED` | Shop đã xác nhận, chờ nhận máy | info |
| `PICKED_UP` | Đang thuê | success |
| `RETURNED` | Đã trả máy, chờ hoàn cọc | info |
| `COMPLETED` | Hoàn tất | neutral |
| `REJECTED` | Bị từ chối | danger |
| `CANCELLED` | Đã hủy | danger |

Đơn `PICKED_UP` có `isOverdue = true` hiển thị thêm nhãn **Quá hạn**. FE phải có nhãn mặc định cho giá trị lạ.

**Khác:** `kind` mẫu máy: `CAMERA`, `LENS`, `ACCESSORY`. `cameraType`: `DIGITAL`, `FILM`, `INSTANT`. Tình trạng chiếc máy (`condition`): `EXCELLENT` (Rất tốt), `GOOD` (Tốt), `FAIR` (Khá). Trạng thái chiếc máy (`status`): `AVAILABLE`, `MAINTENANCE`, `RETIRED`. Loại giao dịch (`payment.type`): `DEPOSIT_RECEIVED` (Thu cọc), `RENTAL_RECEIVED` (Thu tiền thuê), `DEPOSIT_REFUNDED` (Hoàn cọc), `DAMAGE_CHARGE` (Trừ tiền đền hỏng), `LATE_FEE` (Phí trả muộn). Hình thức (`method`): `CASH`, `BANK_TRANSFER`.

### 1.6 Quy tắc "nút hiển thị theo vai trò"

Chi tiết đơn có `viewerRole` (`CUSTOMER|STAFF|ADMIN`) và `allowedActions`. **FE chỉ hiển thị nút theo `allowedActions`**, không tự suy luận. Các giá trị: `cancel`, `confirm`, `reject`, `pickup`, `return`, `complete`. BE vẫn kiểm tra quyền ở mỗi endpoint.

---

## 2. DANH SÁCH TRANG VÀ API TỪNG TRANG

Ưu tiên: **P1** làm đầu, **P2** vận hành shop, **P3** tính năng thêm.

### 2.1 Công khai

| Trang | Route | API | Ưu tiên |
|---|---|---|---|
| Trang chủ | `/` | `GET /models?featured=true`, `GET /categories`, `GET /branches` | P1 |
| Cho thuê máy | `/rent` | `GET /models`, `GET /categories`, `GET /brands`, `GET /branches` | P1 |
| Chi tiết máy | `/rent/[slug]` | `GET /models/:slug`, `GET /models/:id/availability`, `POST /bookings/quote`, `POST/DELETE /favorites/:modelId`, `POST /ai/camera-setup` (P3) | P1 |
| Đăng nhập | `/login` | `POST /auth/login` | P1 |
| Đăng ký | `/register` | `POST /auth/register` | P1 |
| Trang lỗi | `/403`, 404, lỗi chung | — | P1 |
| Giới thiệu và cửa hàng | `/about` | `GET /branches` | P1 |
| Chính sách thuê, cọc, hư hỏng | `/policy` | tĩnh | P1 |
| Hướng dẫn thuê cho người mới | `/guide` | tĩnh | P2 |
| Liên hệ | `/contact` | `GET /branches` | P1 |

### 2.2 Khách (cần đăng nhập)

| Trang | Route | API | Ưu tiên |
|---|---|---|---|
| Xác nhận đặt thuê | `/checkout` | `POST /bookings/quote`, `GET /film-products`, `POST /bookings` | P1 |
| Đơn của tôi | `/bookings` | `GET /bookings` | P1 |
| Chi tiết đơn | `/bookings/[id]` | `GET /bookings/:id`, `POST /bookings/:id/cancel`, `GET /ai/camera-setup/:planId` | P1 |
| Hồ sơ cá nhân | `/settings` | `GET/PATCH /me`, `POST /me/avatar/presign` | P1 |
| Yêu thích | `/favorites` | `GET /favorites`, `DELETE /favorites/:modelId` | P3 |

### 2.3 Nhân viên và admin (`/admin/*`; STAFF và ADMIN vào được, trang quản lý kho và người dùng chỉ ADMIN)

| Trang | Route | API | Quyền | Ưu tiên |
|---|---|---|---|---|
| Tổng quan | `/admin` | `GET /staff/dashboard` | STAFF, ADMIN | P2 |
| Danh sách đơn | `/admin/bookings` | `GET /staff/bookings` | STAFF, ADMIN | P2 |
| Chi tiết đơn (xác nhận, giao, nhận, hoàn tất) | `/admin/bookings/[id]` | `GET /bookings/:id`, `POST /staff/bookings/:id/{confirm,reject,pickup,return,complete,cancel}`, `POST /staff/handover-photos/presign` | STAFF, ADMIN | P2 |
| Lịch kho | `/admin/calendar` | `GET /staff/units`, `GET/POST/DELETE /staff/unit-blocks` | STAFF, ADMIN | P2 |
| Mẫu máy | `/admin/models`, `/admin/models/[id]` | `/admin/models` CRUD, `PUT /admin/models/:id/specs`, ảnh | ADMIN | P2 |
| Từng chiếc máy | `/admin/units` | `/admin/units` CRUD | ADMIN | P2 |
| Danh mục, hãng, chi nhánh, film | `/admin/catalog` | `/admin/categories`, `/admin/brands`, `/admin/branches`, `/admin/film-products` | ADMIN | P2 |
| Người dùng | `/admin/users` | `GET /admin/users`, `PATCH /admin/users/:id` | ADMIN | P2 |

### 2.4 Những chỗ không có API

- **Giỏ hàng:** không có. Mỗi lần đặt là một đơn gồm nhiều món (thân máy, ống kính, film). Header bỏ nút giỏ hàng hoặc đổi thành lối tắt tới "Đơn của tôi".
- **Đánh giá của khách:** chưa có. Trang chủ và chi tiết máy dùng nội dung mẫu cố định hoặc ẩn khối này.
- **Thanh toán online:** chưa có. Trang đặt thuê phải ghi rõ "Bạn thanh toán tại cửa hàng khi nhận máy".
- **Trang chính sách, hướng dẫn:** nội dung tĩnh do shop cung cấp.

---

## 3. HỢP ĐỒNG API

> 🌐 công khai · 🌐* công khai, token tùy chọn · 🔑 cần đăng nhập · 🧑‍💼 STAFF hoặc ADMIN · 🛡 chỉ ADMIN.
> Ví dụ chỉ nêu các trường chính. BE chỉ **thêm** trường, không đổi tên hay xóa trường đã thỏa thuận mà không báo trước.

### 3.1 Xác thực và tài khoản

**🌐 `POST /auth/register`**
```json
// request
{ "fullName": "Nguyễn Văn A", "email": "a@example.com", "phone": "0912345678", "password": "matkhau123" }
// 201 (kèm Set-Cookie refresh token)
{ "accessToken": "eyJ...", "user": { "id": "u1", "fullName": "Nguyễn Văn A", "email": "a@example.com", "roles": ["RENTER"] } }
```
Lỗi: `409 EMAIL_ALREADY_USED`, `400 VALIDATION_ERROR` (mật khẩu tối thiểu 8 ký tự; số điện thoại 10 số bắt đầu bằng 0).

**🌐 `POST /auth/login`** — body `{ "email", "password" }` → `200` cùng cấu trúc register. Lỗi: `401 INVALID_CREDENTIALS`, `403 ACCOUNT_SUSPENDED`, `429 RATE_LIMITED`.

**🌐 `POST /auth/refresh`** — không body, dựa vào cookie → `200 { "accessToken": "eyJ..." }`. Lỗi: `401 UNAUTHENTICATED`.
**🔑 `POST /auth/logout`** → `204`.

**🔑 `GET /me`**
```json
{ "id": "u1", "fullName": "Nguyễn Văn A", "email": "a@example.com", "phone": "0912345678", "avatarUrl": null, "roles": ["RENTER"] }
```
**🔑 `PATCH /me`** — body gồm các trường cần đổi: `fullName`, `phone`, `avatarPath` (`null` để xóa ảnh) → trả lại `me`. `avatarPath` phải là path nhận từ `/me/avatar/presign` của chính mình, nếu không `400`.
**🔑 `POST /me/avatar/presign`** — body `{ "contentType": "image/jpeg" }` → `{ "uploadUrl": "https://...", "path": "avatars/u1/abc.jpg", "token": "..." }`. FE `PUT` file lên `uploadUrl` (kèm đúng `Content-Type`), rồi `PATCH /me` với `avatarPath`. Ảnh JPG/PNG/WebP, tối đa 2 MB.

### 3.2 Chi nhánh, danh mục, hãng, film, cấu hình liên hệ

**🌐 `GET /branches`** → `{ "items": [ { "id": "b1", "slug": "tay-ho", "name": "Chi nhánh Tây Hồ", "address": "...", "phone": "0866747114", "openHours": "09:00 – 21:00", "mapUrl": "https://..." } ] }`

**🌐 `GET /contact-settings`** → trả cấu hình liên hệ công khai (cache 5 phút ở BE):
```json
{
  "chatEnabled": true,
  "welcomeMessage": "Xin chào! BORROLL hỗ trợ thuê máy ảnh.",
  "zalo": {
    "oaId": "123456789012345",
    "url": "https://zalo.me/0912345678"
  },
  "messenger": {
    "url": "https://m.me/borroll.camera"
  },
  "instagram": {
    "handle": "borroll.camera",
    "url": "https://instagram.com/borroll.camera"
  },
  "hotline": "0912345678",
  "branches": [
    { "slug": "tay-ho", "name": "Chi nhánh Tây Hồ", "phone": "0866747114" },
    { "slug": "thanh-xuan", "name": "Chi nhánh Thanh Xuân", "phone": "0866747115" }
  ]
}
```
- URL do BE tự dựng (`https://zalo.me/<phone>`, `https://instagram.com/<handle>`); trường chưa cấu hình trả `null`.
- FE ẩn nút liên hệ có giá trị `null`. Zalo mở khung chat trực tiếp tại trang. Hotline hiển thị danh sách 2 chi nhánh để khách gọi trực tiếp.

**🌐 `GET /categories`** → cây:
```json
{ "items": [
  { "id": "c1", "slug": "may-film", "name": "Máy film", "children": [
      { "id": "c2", "slug": "film-compact", "name": "Compact 35mm", "children": [] },
      { "id": "c3", "slug": "film-rangefinder", "name": "Rangefinder", "children": [] } ] }
] }
```
**🌐 `GET /brands`** → `{ "items": [ { "id": "br1", "slug": "fujifilm", "name": "Fujifilm" } ] }`
**🌐 `GET /film-products`** → `{ "items": [ { "id": "f1", "name": "Kodak Gold 200", "iso": 200, "format": "35mm", "price": 180000, "inStock": true, "imageUrl": "https://..." } ] }`

### 3.3 Mẫu máy

**🌐\* `GET /models`**

Query: `q` (tìm theo tên, hãng; không phân biệt dấu), `category` (slug, nhiều giá trị cách nhau dấu phẩy; chọn danh mục cha thì gồm cả danh mục con), `brand` (slug, nhiều giá trị), `kind`, `cameraType`, `mount`, `minPrice`, `maxPrice` (giá/ngày), `branch` (slug), `from`+`to` (cả hai cùng có mới lọc ngày trống), `featured` (`true`), `excludeId`, `sort` (`default` | `price_asc` | `price_desc` | `newest`), `page`, `pageSize`.

```json
{
  "items": [
    {
      "id": "m1", "slug": "fujifilm-x100v", "name": "Fujifilm X100V", "kind": "CAMERA", "cameraType": "DIGITAL",
      "brand": { "slug": "fujifilm", "name": "Fujifilm" }, "category": { "slug": "digital-compact", "name": "Compact" },
      "mount": null, "pricePerDay": 450000, "pricePerWeek": 2500000, "deposit": 8000000,
      "thumbnailUrl": "https://...", "isFeatured": true, "badges": ["NEW"], "isFavorite": false,
      "availableAtBranches": ["tay-ho"]
    }
  ],
  "page": 1, "pageSize": 20, "total": 40,
  "facets": {
    "price": [ { "key": "lt100k", "min": 0, "max": 100000, "count": 8 }, { "key": "100k-300k", "min": 100000, "max": 300000, "count": 20 },
               { "key": "300k-600k", "min": 300000, "max": 600000, "count": 9 }, { "key": "gte600k", "min": 600000, "max": null, "count": 3 } ],
    "categories": [ { "slug": "film-compact", "name": "Compact 35mm", "parentSlug": "may-film", "count": 6 } ],
    "brands": [ { "slug": "fujifilm", "name": "Fujifilm", "count": 5 } ]
  }
}
```
- Chỉ trả mẫu đang hoạt động (`isActive`).
- `availableAtBranches` chỉ có khi truyền `from` và `to`: danh sách chi nhánh còn ít nhất một chiếc trống. Truyền thêm `branch` thì chỉ lọc theo chi nhánh đó.
- `badges` có thể gồm `NEW` (mẫu mới thêm trong 14 ngày). `isFavorite` luôn `false` với khách vãng lai.
- Số lượng trong `facets` tính theo các bộ lọc **khác** đang áp dụng. Khoảng giá có thể chỉnh sau khi shop chốt bảng giá.
- **Ống kính tương thích:** gọi `GET /models?kind=LENS&mount=<ngàm của thân máy>`.
- **Máy tương tự:** `GET /models?category=<slug>&excludeId=<id>&pageSize=4`.

**🌐\* `GET /models/:slug`**
```json
{
  "id": "m2", "slug": "olympus-xa", "name": "Olympus XA", "kind": "CAMERA", "cameraType": "FILM",
  "description": "Máy film 35mm rangefinder siêu nhỏ gọn...", "mount": null, "filmFormat": "35mm",
  "brand": { "slug": "olympus", "name": "Olympus" }, "category": { "slug": "film-rangefinder", "name": "Rangefinder" },
  "pricePerDay": 250000, "pricePerWeek": 1400000, "deposit": 3000000,
  "images": [ { "id": "i1", "url": "https://...", "kind": "PRODUCT", "caption": null, "sampleLens": null },
              { "id": "i2", "url": "https://...", "kind": "SAMPLE", "caption": "Chân dung buổi chiều", "sampleLens": "35mm f/2.8" } ],
  "specs": { "exposure": { "apertureRange": "f/2.8 – f/22", "shutterRange": "2s – 1/500", "metering": "Đo sáng tự động", "focus": "Lấy nét tay" },
             "controls": [ { "name": "Vòng khẩu độ", "location": "Thân máy", "how": "Xoay tới giá trị f" } ],
             "power": "Pin LR44", "quirks": [], "beginnerNotes": [] },
  "inspection": { "lastInspectedAt": "2026-11-01T00:00:00Z", "items": [ { "label": "Đo sáng hoạt động", "ok": true }, { "label": "Màn trập chính xác", "ok": true }, { "label": "Ống kính sạch, không mốc", "ok": true } ] },
  "availableAtBranches": ["tay-ho", "thanh-xuan"],
  "aiSetupAvailable": true,
  "isFavorite": false
}
```
`specs` và `inspection` có thể `null` nếu admin chưa nhập; FE ẩn mục tương ứng. `aiSetupAvailable` chỉ `true` khi thông số đã đủ để dùng Trợ lý AI. Mẫu không tồn tại hoặc đang ẩn: `404`.

**🌐 `GET /models/:id/availability?branch=tay-ho&month=2026-12`**
```json
{ "month": "2026-12", "branch": "tay-ho", "unavailableDates": ["2026-12-03", "2026-12-04"] }
```
Một ngày là "hết" khi **không còn chiếc nào trống** ở chi nhánh đó (tất cả đã có đơn hoặc đang bảo trì). `branch` bắt buộc.

### 3.4 Báo giá và đặt thuê

**🌐 `POST /bookings/quote`** — tính tiền, kiểm tra còn trống, **không giữ chỗ**.
```json
// request
{ "branchSlug": "tay-ho", "startDate": "2026-12-12", "endDate": "2026-12-15",
  "items": [ { "modelId": "m2" }, { "modelId": "m9" } ],
  "addons": [ { "filmProductId": "f1", "quantity": 2 } ] }
// 200
{
  "days": 3, "available": true, "unavailableModelIds": [],
  "lines": [ { "modelId": "m2", "name": "Olympus XA", "pricePerDay": 250000, "rentalAmount": 750000, "depositAmount": 3000000 } ],
  "addons": [ { "filmProductId": "f1", "name": "Kodak Gold 200", "quantity": 2, "unitPrice": 180000, "amount": 360000 } ],
  "rentalAmount": 750000, "addonsAmount": 360000, "depositAmount": 3000000, "totalDueAtPickup": 4110000
}
```
- `items` có ít nhất một món `CAMERA`. Ống kính (`LENS`) phải cùng ngàm với một thân máy trong đơn, nếu không `422 INCOMPATIBLE_ITEMS`.
- `available: false` kèm `unavailableModelIds` khi có món hết máy.
- `totalDueAtPickup` = tiền thuê + tiền film + **cọc**. Cọc được **hoàn lại** khi trả máy nếu không hỏng; FE phải hiển thị dòng này riêng.

**🔑 `POST /bookings`** — tạo yêu cầu (`PENDING`)
```json
{ "branchSlug": "tay-ho", "startDate": "2026-12-12", "endDate": "2026-12-15",
  "items": [ { "modelId": "m2" } ], "addons": [],
  "contactName": "Nguyễn Văn A", "contactPhone": "0912345678", "note": "Mình đến nhận lúc 9h", "setupPlanId": null }
```
→ `201` trả đối tượng đơn (xem dưới). Lỗi: `409 NO_UNIT_AVAILABLE`, `422 MODEL_NOT_BOOKABLE`, `422 INCOMPATIBLE_ITEMS`, `400 VALIDATION_ERROR` (ngày trả không sau ngày nhận, ngày nhận ở quá khứ).

**Đối tượng đơn**
```json
{
  "id": "bk1", "code": "BR-8K2F9", "status": "PENDING", "isOverdue": false,
  "branch": { "id": "b1", "slug": "tay-ho", "name": "Chi nhánh Tây Hồ", "address": "...", "phone": "0866747114" },
  "startDate": "2026-12-12", "endDate": "2026-12-15", "days": 3,
  "items": [ { "modelId": "m2", "name": "Olympus XA", "kind": "CAMERA", "thumbnailUrl": "https://...", "pricePerDay": 250000, "rentalAmount": 750000, "depositAmount": 3000000 } ],
  "addons": [ { "name": "Kodak Gold 200", "quantity": 2, "unitPrice": 180000, "amount": 360000 } ],
  "rentalAmount": 750000, "addonsAmount": 360000, "depositAmount": 3000000, "totalDueAtPickup": 4110000,
  "contactName": "Nguyễn Văn A", "contactPhone": "0912345678", "note": "Mình đến nhận lúc 9h",
  "createdAt": "2026-11-07T08:30:00Z", "expiresAt": "2026-11-08T08:30:00Z",
  "confirmedAt": null, "pickedUpAt": null, "returnedAt": null, "completedAt": null,
  "rejectedReason": null, "cancelledReason": null,
  "payments": [], "handovers": [], "setupPlan": null,
  "viewerRole": "CUSTOMER", "allowedActions": ["cancel"]
}
```
- `expiresAt` chỉ có nghĩa khi `PENDING` (quá hạn không ai xử lý thì tự `CANCELLED`).
- `payments`: `[ { "type": "DEPOSIT_RECEIVED", "amount": 3000000, "method": "CASH", "note": null, "createdAt": "..." } ]`. Nhân viên thấy thêm `recordedBy`.
- `handovers`: `[ { "kind": "PICKUP", "checklist": [ { "item": "Thân máy", "ok": true, "note": null } ], "conditionNotes": "Xước nhẹ ở nắp pin", "photoUrls": ["https://...(có thời hạn)"], "idChecked": true, "createdAt": "..." } ]`. `photoUrls` là URL tạm, FE không lưu lại. Khách chỉ xem biên bản của đơn mình.
- Với nhân viên và admin, đơn có thêm `customer: { id, fullName, email, phone }` và `units: [ { "modelId": "m2", "serialNumber": "OXA-0042" } ]`.
- `setupPlan`: kế hoạch cấu hình AI đính kèm đơn (xem 3.6), hoặc `null`.

**🔑 `GET /bookings?status=&page=`** — đơn của tôi (mỗi phần tử là đối tượng đơn rút gọn: bỏ `payments`, `handovers`, `setupPlan`).
**🔑 `GET /bookings/:id`** — khách chỉ xem đơn của mình; STAFF và ADMIN xem được mọi đơn; trường hợp khác `404`.
**🔑 `POST /bookings/:id/cancel`** — body `{ "reason": "..." }` (tùy chọn). Khách chỉ hủy được khi `PENDING` hoặc `CONFIRMED`. Trả đơn mới. Lỗi: `409 INVALID_STATUS_TRANSITION`.

### 3.5 Yêu thích

- 🔑 `POST /favorites/:modelId` → `204`; 🔑 `DELETE /favorites/:modelId` → `204`.
- 🔑 `GET /favorites?page=` → cùng cấu trúc `items` như `GET /models`, không có `facets`.

### 3.6 Trợ lý cấu hình bằng AI (P3)

**🔑 `POST /ai/camera-setup`**
```json
// request
{ "modelId": "m2", "scene": "OUTDOOR_SUNNY", "customText": "Chụp chân dung bạn ở hồ Tây", "filmIso": 200,
  "lensModelId": null, "experience": "BEGINNER", "bookingId": null }
// 200
{
  "planId": "sp1", "fromFallback": false,
  "disclaimer": "Gợi ý tham khảo, nhân viên sẽ kiểm tra lại khi giao máy.",
  "result": {
    "summary": "Chụp chân dung ngoài trời lúc nắng nhẹ, film ISO 200",
    "settings": { "aperture": "f/5.6", "shutterSpeed": "1/250", "film": "ISO 200", "metering": "Đo sáng trong máy", "focus": "Lấy nét tay" },
    "steps": [ "Đặt ISO của máy theo cuộn film", "Xoay vòng khẩu độ tới f/5.6" ],
    "tips": [ "Đứng cách chủ thể khoảng 1,5 đến 2 m" ],
    "warnings": [ "Nếu trời tối hơn, không hạ tốc độ dưới 1/60" ]
  }
}
```
- `scene`: `OUTDOOR_SUNNY`, `OUTDOOR_CLOUDY`, `INDOOR`, `PORTRAIT`, `STREET`, `NIGHT`, `TRAVEL`, `OTHER`. `experience`: `BEGINNER`, `INTERMEDIATE`, `ADVANCED`. `customText` tối đa 300 ký tự.
- `fromFallback: true` nghĩa là AI không trả đúng định dạng nên BE trả hướng dẫn tĩnh của mẫu máy (FE hiển thị bình thường, có thể ghi chú).
- Lỗi: `429 RATE_LIMITED` (hết lượt trong ngày), `503 AI_UNAVAILABLE`, `404` nếu mẫu máy chưa có thông số (`aiSetupAvailable = false`).
- **🔑 `GET /ai/camera-setup/:planId`** — xem lại kế hoạch của tôi. **🔑 `POST /ai/camera-setup/:planId/feedback`** — body `{ "helpful": true }` → `204`.
- Gắn vào đơn: gửi `setupPlanId` khi `POST /bookings`.

### 3.7 Nhân viên (🧑‍💼)

**`GET /staff/dashboard`**
```json
{ "pendingCount": 3, "pickupsToday": [ /* đơn rút gọn */ ], "returnsToday": [ /* đơn rút gọn */ ], "overdue": [ /* đơn rút gọn */ ] }
```
Lọc theo `?branch=` (slug), mặc định tất cả chi nhánh.

**`GET /staff/bookings?status=&branch=&date=&overdue=&q=&page=`** — `date` lọc đơn có ngày nhận hoặc trả đúng ngày đó; `overdue=true` chỉ đơn quá hạn; `q` tìm theo mã đơn, tên, số điện thoại.

**Chuyển trạng thái** (mọi endpoint trả đối tượng đơn mới; sai trạng thái `409 INVALID_STATUS_TRANSITION`):

| Endpoint | Từ → Đến | Body |
|---|---|---|
| `POST /staff/bookings/:id/confirm` | `PENDING → CONFIRMED` | không |
| `POST /staff/bookings/:id/reject` | `PENDING → REJECTED` | `{ "reason": "..." }` (bắt buộc) |
| `POST /staff/bookings/:id/pickup` | `CONFIRMED → PICKED_UP` | xem dưới |
| `POST /staff/bookings/:id/return` | `PICKED_UP → RETURNED` | xem dưới |
| `POST /staff/bookings/:id/complete` | `RETURNED → COMPLETED` | xem dưới |
| `POST /staff/bookings/:id/cancel` | `PENDING`/`CONFIRMED → CANCELLED` | `{ "reason": "..." }` (bắt buộc) |

**Giao máy (`pickup`)**
```json
{
  "checklist": [ { "item": "Thân máy", "ok": true, "note": null }, { "item": "Dây đeo", "ok": true, "note": null } ],
  "conditionNotes": "Xước nhẹ ở nắp pin",
  "photoPaths": [ "handover/bk1/abc.jpg" ],
  "idChecked": true,
  "payments": [ { "type": "DEPOSIT_RECEIVED", "amount": 3000000, "method": "CASH", "note": null },
                { "type": "RENTAL_RECEIVED", "amount": 1110000, "method": "BANK_TRANSFER", "note": "Chuyển khoản" } ]
}
```
- `idChecked` phải `true` (nhân viên đã kiểm tra giấy tờ) và cần ít nhất 1 ảnh, nếu không `400 VALIDATION_ERROR`.
- Số tiền thu phải đủ: tiền cọc ≥ `depositAmount`, tiền thuê ≥ `rentalAmount + addonsAmount`, nếu không `422 PAYMENT_INCOMPLETE`.
- `photoPaths` là path nhận từ `/staff/handover-photos/presign` và phải thuộc đúng đơn này.

**Nhận máy (`return`)** — body `{ "checklist": [...], "conditionNotes": "...", "photoPaths": [...] }` (ít nhất 1 ảnh).

**Hoàn tất (`complete`)**
```json
{ "charges": [ { "type": "DAMAGE_CHARGE", "amount": 200000, "note": "Trầy nắp pin" } ], "refundMethod": "CASH", "note": null }
```
BE tính: `hoàn cọc = cọc đã thu − tổng charges`. `charges` có thể rỗng. Tổng `charges` không được vượt tiền cọc đã thu (`400`). Kết quả được ghi thành các giao dịch `DAMAGE_CHARGE`/`LATE_FEE` và `DEPOSIT_REFUNDED`.

**🧑‍💼 `POST /staff/handover-photos/presign`** — body `{ "bookingId": "bk1", "contentType": "image/jpeg" }` → `{ "uploadUrl": "https://...", "path": "handover/bk1/abc.jpg", "token": "..." }`. Ảnh JPG/PNG/WebP, tối đa 5 MB. Gọi một lần cho mỗi ảnh.

**Kho và bảo trì**
- `GET /staff/units?branch=&model=&status=&page=` → `{ items: [ { id, serialNumber, model: {id,name}, branch: {slug,name}, condition, status, notes } ] }`.
- `GET /staff/unit-blocks?unitId=&from=&to=` → `{ items: [ { id, unitId, startDate, endDate, reason } ] }`.
- `POST /staff/unit-blocks` — body `{ "unitId": "u1", "startDate": "2026-12-10", "endDate": "2026-12-12", "reason": "Thay pin, vệ sinh" }`. Trùng với đơn đang hoạt động: `409 BOOKING_DATE_UNAVAILABLE`.
- `DELETE /staff/unit-blocks/:id` → `204`.

**Kế hoạch AI của đơn:** `POST /staff/setup-plans/:id/prepared` — body `{ "editedResult": { ... } }` (tùy chọn, nhân viên sửa lại) → đánh dấu đã cài sẵn khi giao máy; khách thấy trạng thái này ở chi tiết đơn.

### 3.8 Quản trị (🛡)

CRUD theo kiểu REST (`POST` tạo, `PATCH /:id` sửa, `GET` danh sách/chi tiết, `DELETE /:id` xóa hoặc ẩn). Danh sách có phân trang và `?q=`.

| Nhóm | Endpoint | Trường chính |
|---|---|---|
| Mẫu máy | `/admin/models` | `kind`, `categoryId`, `brandId`, `name`, `slug`, `description`, `cameraType`, `mount`, `filmFormat`, `pricePerDay`, `pricePerWeek`, `deposit`, `isActive`, `isFeatured`, `lastInspectedAt`, `inspectionNotes` (`[ {label, ok} ]`) |
| Thông số (cho AI) | `PUT /admin/models/:id/specs` | body là đối tượng `specs` (xem `BORROLL_STORE_PLAN.md` mục 5.4) |
| Ảnh máy | `POST /admin/models/:id/images/presign` → `PUT` file → `POST /admin/models/:id/images` `{ "path", "kind", "caption", "sampleLens", "sortOrder" }`; `PATCH .../images/order` `{ "imageIds": [...] }`; `DELETE .../images/:imageId` | Ảnh JPG/PNG/WebP, tối đa 5 MB |
| Từng chiếc máy | `/admin/units` | `modelId`, `branchId`, `serialNumber`, `condition`, `status`, `notes`, `purchasedAt` |
| Danh mục, hãng | `/admin/categories`, `/admin/brands` | `name`, `slug`, `parentId`, `sortOrder` |
| Chi nhánh | `/admin/branches` | `name`, `slug`, `address`, `phone`, `openHours`, `mapUrl`, `isActive` |
| Film bán kèm | `/admin/film-products` | `name`, `iso`, `format`, `price`, `inStock` |
| Cấu hình liên hệ | `PUT /admin/contact-settings` | `zaloOaId` (chữ số, tối đa 30), `zaloPhone` (`/^0\d{9}$/`), `messengerPage` (`/^[A-Za-z0-9.]{5,50}$/`), `hotline` (`/^0\d{9}$/`), `welcomeMessage` (tối đa 120 ký tự), `isChatEnabled` (`boolean`); không nhận URL hoặc HTML/script (`400`) |
| Người dùng | `GET /admin/users?q=&role=&page=`, `PATCH /admin/users/:id` | body `{ "roles": ["RENTER","STAFF"], "status": "ACTIVE" }` |

- Không xóa cứng mẫu máy hay chiếc máy đã từng có đơn; chỉ ẩn (`isActive = false`) hoặc `RETIRED`.
- Admin không tự bỏ quyền `ADMIN` của chính mình được (`400`).

---

## 4. CÁCH FE LÀM KHI BE CHƯA XONG

- Dựng mock (MSW hoặc Prism) theo **đúng các ví dụ JSON trong tài liệu này**; khi BE xong chỉ cần tắt mock.
- BE sẽ giao hợp đồng theo từng gói (xem lộ trình ở `BORROLL_STORE_PLAN.md` mục 12). Thứ tự gợi ý cho FE: trang công khai → đặt thuê và đơn của tôi → trang vận hành → Trợ lý AI.

## 5. QUY TRÌNH ĐỔI API

1. Bên muốn đổi ghi vào tài liệu này (hoặc mở Pull Request sửa `openapi.yaml`) và báo bên kia.
2. Hai bên đồng ý rồi mới làm. BE chỉ **thêm** trường; đổi tên, xóa hoặc đổi ý nghĩa phải báo trước.
3. Ghi vào "Lịch sử thay đổi".

## 6. LỊCH SỬ THAY ĐỔI

| Ngày | Thay đổi | Người sửa |
|---|---|---|
| 2026-11-07 | Bản đầu (mô hình nền tảng) | BE |
| 2026-11-10 | Viết lại hoàn toàn theo mô hình cửa hàng: bỏ chủ máy, duyệt tin, KYC; thêm chi nhánh, mẫu máy/chiếc máy, đơn nhiều món, biên bản giao nhận, sổ thu chi, nhân viên, Trợ lý AI | BE |
| 2026-11-13 | Thêm `GET /contact-settings` (@Public) và `PUT /admin/contact-settings` (@Roles('ADMIN')) quản lý cấu hình liên hệ Zalo, Messenger, Hotline | BE + FE |
