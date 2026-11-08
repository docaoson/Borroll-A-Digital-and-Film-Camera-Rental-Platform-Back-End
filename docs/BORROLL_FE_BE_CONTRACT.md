# BORROLL — THỎA THUẬN GIỮA FE VÀ BE

Tài liệu do **BE** viết và giữ, dành cho **FE**. Gồm: (1) danh sách trang cần làm, (2) user stories, (3) hợp đồng API.
Nguồn sự thật cuối cùng của API là `docs/openapi.yaml` ở repo backend; tài liệu này là bản đọc cho người.

---

## 1. QUY ƯỚC CHUNG

### 1.1 Địa chỉ và xác thực

- Base URL: `{API_URL}/api/v1` (FE đọc từ `NEXT_PUBLIC_API_URL`).
- Đăng nhập thành công trả **access token** trong JSON (sống 15 phút). FE giữ trong bộ nhớ (không lưu localStorage) và gửi ở header `Authorization: Bearer <token>`.
- **Refresh token** nằm trong cookie `httpOnly`, FE không đọc được. Mọi request phải gửi `credentials: 'include'`.
- Khi API trả `401` với `error.code = "TOKEN_EXPIRED"`: FE gọi `POST /auth/refresh` một lần, rồi gửi lại request cũ. Nếu refresh cũng `401` thì chuyển về `/login?next=<trang hiện tại>`.
- Endpoint đánh dấu **public** không bắt buộc token. Riêng các endpoint công khai đọc máy (`GET /cameras`, `GET /cameras/:slug`, `GET /hosts/:id`) chấp nhận header `Authorization: Bearer <token>` tùy chọn: nếu có token thì tính trường `isFavorite` theo người dùng đang đăng nhập, không có thì mặc định `isFavorite: false`. Endpoint còn lại cần token; thiếu quyền trả `403`.

### 1.2 Định dạng dữ liệu

| Loại | Quy ước | Ví dụ |
|---|---|---|
| Tiền | Số nguyên VND, không thập phân | `350000` |
| Ngày thuê | Chuỗi `YYYY-MM-DD` (không giờ) | `"2026-12-03"` |
| Thời điểm | ISO 8601 UTC | `"2026-11-07T08:30:00Z"` |
| ID | Chuỗi | `"b3f1..."` |
| Phân trang | Query `page` (từ 1), `pageSize` (mặc định 32, tối đa 100) | |
| Danh sách | `{ "items": [...], "page": 1, "pageSize": 32, "total": 199 }` | |

FE tự định dạng hiển thị (`350.000 đ`, `03/12/2026`), BE không trả chuỗi đã định dạng.

### 1.3 Quy tắc tính ngày thuê

- Người thuê chọn **ngày nhận** (`startDate`) và **ngày trả** (`endDate`).
- **Số ngày = `endDate` − `startDate`**, tối thiểu 1. Ví dụ nhận 12/12, trả 14/12 là 2 ngày.
- Ngày trả máy **không** bị tính là kín: người khác có thể nhận máy đúng ngày đó.
- Do đó `unavailableDates` (xem 4.3) chỉ chứa các đêm máy đang bị giữ, tức từ `startDate` đến ngày trước `endDate`.

### 1.4 Định dạng lỗi (mọi endpoint)

```json
{
  "error": {
    "code": "BOOKING_DATE_UNAVAILABLE",
    "message": "Máy đã có người đặt trong khoảng ngày này.",
    "details": {}
  }
}
```

Với lỗi form (`400 VALIDATION_ERROR`), `details` là `{ "fields": { "email": "Email không hợp lệ", "password": "Tối thiểu 8 ký tự" } }`. FE hiển thị lỗi dưới từng ô theo `fields`. `message` là tiếng Việt, có thể hiển thị thẳng cho người dùng.

| HTTP | `code` | Khi nào |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Dữ liệu gửi lên sai |
| 401 | `UNAUTHENTICATED` | Chưa đăng nhập |
| 401 | `TOKEN_EXPIRED` | Access token hết hạn |
| 401 | `INVALID_CREDENTIALS` | Sai email hoặc mật khẩu |
| 403 | `FORBIDDEN` | Không đủ quyền |
| 403 | `HOST_NOT_ENABLED` | Chưa bật vai trò chủ máy |
| 404 | `NOT_FOUND` | Không tồn tại hoặc không có quyền xem |
| 409 | `EMAIL_ALREADY_USED` | Đăng ký trùng email |
| 409 | `BOOKING_DATE_UNAVAILABLE` | Ngày đã bị đặt hoặc bị chặn |
| 409 | `INVALID_STATUS_TRANSITION` | Hành động không hợp lệ với trạng thái hiện tại |
| 422 | `CANNOT_BOOK_OWN_CAMERA` | Chủ máy tự đặt máy của mình |
| 422 | `CAMERA_NOT_BOOKABLE` | Máy không ở trạng thái `ACTIVE` |
| 429 | `RATE_LIMITED` | Gọi quá nhiều (đặc biệt `/auth/*`) |

### 1.5 Các giá trị liệt kê (enum) và nhãn hiển thị

**Trạng thái đơn thuê (`booking.status`)**

| Giá trị | Nhãn tiếng Việt | Màu badge |
|---|---|---|
| `PENDING` | Chờ chủ máy duyệt | warning |
| `OWNER_APPROVED` | Chủ máy đã duyệt | success |
| `REJECTED` | Bị từ chối | danger |
| `CANCELLED` | Đã hủy | danger |

(Các trạng thái `PAID`, `HANDED_OVER`, `RETURNED`, `COMPLETED`, `DISPUTED` sẽ thêm khi có thanh toán; FE nên xử lý giá trị lạ bằng nhãn mặc định, không để vỡ giao diện.)

**Trạng thái tin đăng (`camera.status`)**: `DRAFT` (Nháp), `PENDING_REVIEW` (Chờ duyệt), `ACTIVE` (Đang hiển thị), `PAUSED` (Tạm ẩn), `REJECTED` (Bị từ chối).

**Loại máy (`cameraType`)**: `DIGITAL`, `FILM`. **Vai trò (`roles`)**: `RENTER`, `HOST`, `ADMIN`. **KYC (`kycStatus`)**: `NONE`, `PENDING`, `VERIFIED`, `REJECTED`.

### 1.6 Quy tắc "nút hiển thị theo vai trò"

Mọi response chi tiết đơn có `viewerRole` và `allowedActions` (xem 4.5). **FE chỉ cần hiển thị nút theo `allowedActions`**, không tự suy luận từ vai trò và trạng thái. BE vẫn kiểm tra quyền lần nữa ở mỗi endpoint.

---

## 2. DANH SÁCH TRANG CẦN LÀM

Ưu tiên: **P1** = làm đầu tiên (luồng người thuê xem máy), **P2** = luồng đặt thuê và chủ máy, **P3** = admin và hoàn thiện, **Sau** = chưa có API.

### 2.1 Khu vực công khai

| Trang | Route | Quyền | API dùng | Ưu tiên |
|---|---|---|---|---|
| Trang chủ | `/` | public | `GET /cameras?badge=HOT` (máy nổi bật), `GET /categories` | P1 |
| Cho thuê máy (danh sách + lọc) | `/rent` | public | `GET /cameras`, `GET /categories`, `GET /brands` | P1 |
| Chi tiết máy | `/camera/[slug]` | public | `GET /cameras/:slug`, `GET /cameras/:id/availability`, `POST /bookings/quote`, `POST/DELETE /favorites/:id`, `GET /cameras?category=&excludeId=` (máy tương tự) | P1 |
| Đăng nhập | `/login` | khách | `POST /auth/login` | P1 |
| Đăng ký | `/register` | khách | `POST /auth/register` | P1 |
| Hồ sơ chủ máy (công khai) | `/host-profile/[id]` | public | `GET /hosts/:id` | P3 |
| 403 / 404 / lỗi chung | `/403`, `not-found` | — | — | P1 |

### 2.2 Người thuê (cần đăng nhập)

| Trang | Route | API dùng | Ưu tiên |
|---|---|---|---|
| Xác nhận đặt thuê | `/checkout?camera=<slug>&from=&to=` | `POST /bookings/quote`, `POST /bookings` | P2 |
| Đơn của tôi | `/bookings` | `GET /bookings` | P2 |
| Chi tiết đơn | `/bookings/[id]` | `GET /bookings/:id`, `POST /bookings/:id/cancel` | P2 |
| Yêu thích | `/favorites` | `GET /favorites`, `DELETE /favorites/:cameraId` | P3 |
| Hồ sơ cá nhân | `/settings` | `GET/PATCH /me`, `POST /me/avatar/presign` | P2 |
| Xác minh danh tính (KYC) | `/settings/kyc` | `GET /me/kyc`, `POST /me/kyc/presign`, `POST /me/kyc` | P3 |
| Tin nhắn | `/messages` | chưa có | Sau |

### 2.3 Chủ máy (`/host/*`, cần role `HOST`)

| Trang | Route | API dùng | Ưu tiên |
|---|---|---|---|
| Bật chế độ chủ máy (onboarding) | `/host/onboarding` | `POST /me/become-host` | P2 |
| Tổng quan | `/host` | (trang khung, có thể lấy số liệu từ `/host/bookings`) | P2 |
| Tin đăng của tôi | `/host/listings` | `GET /host/cameras`, `POST /host/cameras/:id/pause`, `/resume`, `DELETE /host/cameras/:id` (chỉ tin nháp) | P2 |
| Tạo tin đăng (form nhiều bước) | `/host/listings/new` | `POST /host/cameras`, `POST /host/cameras/:id/images/presign`, `POST /host/cameras/:id/images`, `POST /host/cameras/:id/submit` | P2 |
| Sửa tin đăng | `/host/listings/[id]/edit` | `GET /host/cameras/:id`, `PATCH /host/cameras/:id`, quản lý ảnh | P2 |
| Lịch | `/host/calendar` | `GET /cameras/:id/availability`, `GET /host/blocked-dates`, `POST /host/blocked-dates`, `DELETE /host/blocked-dates/:id` | P2 |
| Đơn nhận | `/host/orders` | `GET /host/bookings` | P2 |
| Chi tiết đơn nhận | `/host/orders/[id]` | `GET /bookings/:id`, `POST /host/bookings/:id/approve`, `/reject` | P2 |
| Ví / rút tiền | `/host/wallet` | chưa có | Sau |

### 2.4 Admin (`/admin/*`, cần role `ADMIN`)

| Trang | Route | API dùng | Ưu tiên |
|---|---|---|---|
| Duyệt tin đăng | `/admin/listings-review` | `GET /admin/cameras`, `POST /admin/cameras/:id/approve`, `/reject`, `PATCH /admin/cameras/:id/promotion` (gắn nhãn Hot) | P3 |
| Duyệt KYC | `/admin/kyc` | `GET /admin/kyc-submissions`, `POST /admin/kyc-submissions/:id/approve`, `/reject` | P3 |
| Tranh chấp, đối soát, người dùng | `/admin/disputes`, `/admin/users` | chưa có | Sau |

### 2.5 Những chỗ KHÔNG có API (FE xử lý riêng)

- **Đánh giá** (khối ở trang chủ, tab ở chi tiết máy): chưa có module đánh giá. Dùng dữ liệu mẫu cố định hoặc ẩn khối này.
- **Giỏ hàng** ở header: hệ thống đặt thuê **từng máy một**, không có giỏ hàng. Bỏ nút giỏ hàng hoặc đổi thành lối tắt tới "Đơn của tôi".
- **Số lượt cho thuê** của chủ máy (`completedRentals`): luôn là `0` cho đến khi có thanh toán và trạng thái `COMPLETED`. FE nên ẩn số khi bằng 0.
- **Giảm giá:** chưa hỗ trợ. Không có `discountPercent`; nhãn tin chỉ gồm `NEW`, `HOT`.
- **Tổng quan chủ máy** (`/host`): chưa có API số liệu riêng; dựng từ `GET /host/bookings` và `GET /host/cameras`.

---

## 3. USER STORIES

Định dạng: **Là** (vai trò), **tôi muốn** (việc), **để** (lý do). Dưới mỗi story là tiêu chí chấp nhận.

### 3.1 Tài khoản

**US-01 Đăng ký** — Là khách, tôi muốn tạo tài khoản bằng email để có thể đặt thuê máy.
- Nhập họ tên, email, số điện thoại, mật khẩu (tối thiểu 8 ký tự), tích đồng ý điều khoản.
- Email trùng thì hiện lỗi dưới ô email (`EMAIL_ALREADY_USED`).
- Thành công thì tự đăng nhập và chuyển về trang trước đó (`next`) hoặc `/`.

**US-02 Đăng nhập / đăng xuất** — Là người dùng, tôi muốn đăng nhập để truy cập đơn và tin đăng của mình.
- Sai thông tin thì hiện "Email hoặc mật khẩu không đúng" (`INVALID_CREDENTIALS`), không nói cụ thể cái nào sai.
- Đăng xuất gọi `POST /auth/logout` rồi xóa token trong bộ nhớ.
- Reload trang vẫn giữ đăng nhập (FE gọi `POST /auth/refresh` khi khởi động ứng dụng).

**US-03 Cập nhật hồ sơ** — Là người dùng, tôi muốn sửa họ tên, số điện thoại, ảnh đại diện.
- Ảnh đại diện tải theo luồng hai bước (xin URL → `PUT` file → `PATCH /me` với `avatarPath`); tối đa 2 MB, JPG/PNG/WebP.

**US-04 Chuyển chế độ thuê / cho thuê** — Là người dùng, tôi muốn chuyển qua lại giữa "Chế độ thuê" và "Chế độ cho thuê" trong menu tài khoản.
- Nếu `roles` chưa có `HOST`: bấm "Chế độ cho thuê" dẫn tới `/host/onboarding`.
- Nếu đã có `HOST`: dẫn tới `/host`.

**US-05 Bật vai trò chủ máy** — Là người dùng, tôi muốn trở thành chủ máy để đăng máy cho thuê.
- Cần có họ tên và số điện thoại trong hồ sơ; thiếu thì lỗi `VALIDATION_ERROR` kèm `fields`.
- Sau khi bật, `GET /me` trả `roles` có `HOST`.

**US-06 Xác minh danh tính** — Là chủ máy, tôi muốn gửi ảnh CCCD và selfie để được gắn huy hiệu "Đã xác minh".
- Tải 3 ảnh (mặt trước, mặt sau, selfie) lên URL do BE cấp, rồi gửi hồ sơ.
- Trang gọi `GET /me/kyc` để hiển thị trạng thái (Chưa gửi / Đang chờ / Đã xác minh / Bị từ chối kèm `rejectReason`). Bị từ chối thì cho gửi lại.

### 3.2 Tìm và xem máy (người thuê, cả khách vãng lai)

**US-10 Xem trang chủ** — Là khách, tôi muốn thấy máy nổi bật và danh mục để bắt đầu tìm.
- Máy nổi bật lấy bằng `GET /cameras?badge=HOT`; nếu chưa có máy nào được gắn nhãn Hot thì dùng `sort=newest`.

**US-11 Tìm và lọc máy** — Là người thuê, tôi muốn lọc theo ngày thuê, giá, danh mục, hãng, khu vực để thấy máy phù hợp.
- Mọi bộ lọc và sắp xếp nằm trong URL query để chia sẻ được.
- Sidebar hiển thị số lượng `(n)` cho từng khoảng giá, danh mục, hãng (lấy từ `facets`).
- Khi chọn ngày nhận/trả, chỉ hiện máy còn trống trong khoảng đó.
- Phân trang 32 máy mỗi trang.

**US-12 Xem chi tiết máy** — Là người thuê, tôi muốn xem ảnh, thông số, tình trạng, phụ kiện kèm, giá, tiền cọc, chủ máy, chính sách hủy.
- Lịch hiển thị ngày hết máy dựa trên `unavailableDates`; không cho chọn khoảng chứa ngày kín.
- Chọn xong khoảng ngày thì hiện tóm tắt chi phí (tiền thuê, cọc, phí dịch vụ, tổng) từ `POST /bookings/quote`.

**US-13 Yêu thích máy** — Là người thuê, tôi muốn lưu máy vào danh sách yêu thích.
- Chưa đăng nhập mà bấm tim thì chuyển tới `/login?next=...`.

**US-14 Tìm nhanh bằng từ khóa** — Là người thuê, tôi muốn gõ tên máy ở ô tìm kiếm trên header để tới danh sách kết quả.
- Gửi `q` tới `GET /cameras`; tìm không phân biệt hoa thường và **không cần gõ dấu** (gõ "may anh" vẫn ra "máy ảnh").
- Bấm tìm chuyển tới `/rent?q=...`.

**US-15 Xem hồ sơ chủ máy** — Là người thuê, tôi muốn xem hồ sơ công khai của chủ máy (huy hiệu xác minh, ngày tham gia, các máy đang cho thuê) để yên tâm trước khi thuê.
- Chủ máy không tồn tại hoặc chưa bật vai trò HOST thì `404`.

### 3.3 Đặt thuê (người thuê)

**US-20 Gửi yêu cầu thuê** — Là người thuê, tôi muốn chọn ngày và gửi yêu cầu thuê đến chủ máy.
- Trang `/checkout` hiển thị lại máy, ngày, bảng chi phí; nút "Gửi yêu cầu thuê".
- Đơn mới có trạng thái `PENDING`; sau khi gửi chuyển tới `/bookings/[id]`.
- Ngày vừa bị người khác đặt: hiện lỗi `BOOKING_DATE_UNAVAILABLE` và cho chọn lại ngày.
- Máy của chính mình: hiện lỗi `CANNOT_BOOK_OWN_CAMERA`.
- **Lưu ý:** giai đoạn này **chưa có thanh toán**. Hiển thị rõ "Chủ máy sẽ xác nhận trong 24 giờ; bạn chưa bị trừ tiền".

**US-21 Xem đơn của tôi** — Là người thuê, tôi muốn xem danh sách và trạng thái các đơn.
- Mỗi đơn có badge trạng thái theo bảng 1.5.

**US-22 Xem chi tiết và hủy đơn** — Là người thuê, tôi muốn xem chi tiết đơn và hủy khi còn được phép.
- Nút "Hủy đơn" chỉ hiện khi `allowedActions` chứa `"cancel"`.
- Đơn `PENDING` quá 24 giờ chưa được duyệt sẽ tự chuyển `CANCELLED` (FE chỉ cần hiển thị theo trạng thái trả về).

### 3.4 Chủ máy

**US-30 Đăng máy** — Là chủ máy, tôi muốn tạo tin đăng với ảnh, thông số, giá, cọc để cho thuê.
- Form nhiều bước: (1) loại máy, hãng, model; (2) thông số và tình trạng (số shutter với máy digital, khổ film với máy film); (3) ảnh (kéo thả, tối đa 10 ảnh, sắp xếp được); (4) giá/ngày, giá/tuần (tùy chọn), tiền cọc, khu vực; (5) phụ kiện kèm và chính sách hủy; (6) xem lại và gửi duyệt.
- Có thể lưu nháp ở mọi bước (`DRAFT`). Các trường bắt buộc khi gửi duyệt (`submit`): ít nhất 1 ảnh, `title`, `model`, `cameraType`, danh mục, hãng, `pricePerDay`, `deposit`, `city`, `district`. Các trường còn lại là tùy chọn.
- Gửi duyệt xong tin chuyển `PENDING_REVIEW` và không sửa được các trường chính cho đến khi có kết quả.

**US-31 Quản lý tin đăng** — Là chủ máy, tôi muốn thấy tất cả tin của mình kèm trạng thái, sửa, tạm ẩn/hiện lại.
- Tin bị từ chối hiện lý do (`rejectReason`).

**US-32 Duyệt hoặc từ chối đơn** — Là chủ máy, tôi muốn xem đơn gửi đến và duyệt hoặc từ chối.
- Trang đơn nhận có lọc theo trạng thái; đơn `PENDING` hiện nổi bật.
- Nút "Duyệt" / "Từ chối" chỉ hiện khi có trong `allowedActions`. Từ chối nên kèm lý do (tùy chọn).

**US-33 Chặn lịch** — Là chủ máy, tôi muốn chặn những ngày không cho thuê (đi vắng, máy đang dùng riêng) và bỏ chặn khi cần.
- Danh sách các khoảng đã chặn lấy từ `GET /host/blocked-dates` (có `id` để xóa).
- Lịch hiển thị ba loại ngày: trống, có đơn, tự chặn.
- Chặn trùng ngày đã có đơn thì lỗi `BOOKING_DATE_UNAVAILABLE`.

### 3.5 Admin

**US-40 Duyệt tin đăng** — Là admin, tôi muốn xem hàng chờ tin `PENDING_REVIEW` và duyệt hoặc từ chối kèm lý do.

**US-41 Duyệt KYC** — Là admin, tôi muốn xem hồ sơ KYC và xác minh hoặc từ chối.
- Ảnh giấy tờ được xem qua URL có thời hạn, không hiển thị công khai.

---

## 4. HỢP ĐỒNG API

> Ký hiệu: 🌐 public · 🔑 cần đăng nhập · 🏠 cần role HOST · 🛡 cần role ADMIN.
> Mọi ví dụ response dưới đây chỉ nêu các trường chính; BE có thể **thêm** trường mới, nhưng sẽ không đổi tên hoặc xóa trường đã thỏa thuận mà không báo trước.

### 4.1 Xác thực và tài khoản

**🌐 `POST /auth/register`**
```json
// request
{ "fullName": "Nguyễn Văn A", "email": "a@example.com", "phone": "0912345678", "password": "matkhau123" }
// 201
{ "accessToken": "eyJ...", "user": { "id": "u1", "fullName": "Nguyễn Văn A", "email": "a@example.com", "roles": ["RENTER"] } }
```
Lỗi: `409 EMAIL_ALREADY_USED`, `400 VALIDATION_ERROR`.

**🌐 `POST /auth/login`**
```json
// request
{ "email": "a@example.com", "password": "matkhau123" }
// 200 (kèm Set-Cookie refresh token)
{ "accessToken": "eyJ...", "user": { "id": "u1", "fullName": "...", "email": "...", "roles": ["RENTER"] } }
```
Lỗi: `401 INVALID_CREDENTIALS`, `429 RATE_LIMITED`.

**🌐 `POST /auth/refresh`** (không body, dựa vào cookie) → `200 { "accessToken": "eyJ..." }`. Lỗi: `401 UNAUTHENTICATED`.

**🔑 `POST /auth/logout`** → `204`.

**🔑 `GET /me`**
```json
{
  "id": "u1", "fullName": "Nguyễn Văn A", "email": "a@example.com", "phone": "0912345678",
  "avatarUrl": null, "roles": ["RENTER", "HOST"], "kycStatus": "VERIFIED"
}
```

**🔑 `PATCH /me`** — body gồm các trường cần đổi (`fullName`, `phone`, `avatarPath`) → trả lại đối tượng `me` (có `avatarUrl` đầy đủ, BE tự dựng từ `avatarPath`). `avatarPath` phải là path nhận được từ `/me/avatar/presign` của chính mình, nếu không `400 VALIDATION_ERROR`. Gửi `"avatarPath": null` để xóa ảnh.

**🔑 `POST /me/become-host`** (không body) → `200` trả `me` mới (có `HOST`). Lỗi: `400 VALIDATION_ERROR` nếu thiếu họ tên hoặc số điện thoại.

**🔑 `POST /me/kyc/presign`**
```json
// request
{ "files": [ { "kind": "ID_FRONT", "contentType": "image/jpeg" }, { "kind": "ID_BACK", "contentType": "image/jpeg" }, { "kind": "SELFIE", "contentType": "image/jpeg" } ] }
// 200
{ "uploads": [ { "kind": "ID_FRONT", "uploadUrl": "https://...", "path": "kyc/u1/front.jpg" }, ... ] }
```
FE dùng `PUT` tải từng file lên `uploadUrl` (kèm đúng header `Content-Type`), rồi gọi:

**🔑 `POST /me/kyc`** — body `{ "idFrontPath": "...", "idBackPath": "...", "selfiePath": "..." }` → `200 { "kycStatus": "PENDING" }`.

**🔑 `GET /me/kyc`** — hồ sơ xác minh mới nhất của tôi.
```json
{ "status": "REJECTED", "rejectReason": "Ảnh CCCD bị mờ", "submittedAt": "2026-11-07T08:30:00Z", "reviewedAt": "2026-11-08T02:00:00Z" }
```
Chưa từng gửi: `{ "status": "NONE", "rejectReason": null, "submittedAt": null, "reviewedAt": null }`.

**🔑 `POST /me/avatar/presign`**
```json
// request
{ "contentType": "image/jpeg" }
// 200
{ "uploadUrl": "https://...", "path": "avatars/u1/abc.jpg" }
```
FE `PUT` file lên `uploadUrl` rồi gọi `PATCH /me` với `avatarPath`.

### 4.2 Danh mục và hãng

**🌐 `GET /categories`** → cây danh mục
```json
{ "items": [
  { "id": "c1", "slug": "may-anh", "name": "Máy ảnh", "type": "CAMERA_DIGITAL",
    "children": [ { "id": "c2", "slug": "digital-mirrorless", "name": "Digital Mirrorless", "children": [] } ] }
] }
```

**🌐 `GET /brands`** → `{ "items": [ { "id": "b1", "slug": "sony", "name": "Sony" } ] }`

### 4.3 Tìm và xem máy

**🌐 `GET /cameras`**

Query: `q`, `category` (slug, nhiều giá trị cách nhau dấu phẩy), `brand` (slug, nhiều giá trị), `mount`, `cameraType` (`DIGITAL|FILM`), `minPrice`, `maxPrice` (VND/ngày), `city`, `district`, `from`, `to` (cả hai cùng có mới lọc ngày trống), `sort` (`default` | `price_asc` | `price_desc` | `newest`), `badge` (`HOT` | `NEW`), `excludeId`, `page`, `pageSize`.

```json
{
  "items": [
    {
      "id": "cam1", "slug": "fujifilm-x100vi-ha-noi", "title": "Fujifilm X100VI",
      "cameraType": "DIGITAL", "brand": { "slug": "fujifilm", "name": "Fujifilm" },
      "category": { "slug": "compact", "name": "Compact" },
      "pricePerDay": 450000, "pricePerWeek": 2500000, "deposit": 8000000,
      "city": "Hà Nội", "district": "Tây Hồ",
      "thumbnailUrl": "https://...", "badges": ["NEW"],
      "accessories": [ { "name": "Pin dự phòng", "icon": "battery" } ],
      "host": { "id": "u2", "fullName": "Trần B", "verified": true },
      "isFavorite": false,
      "availableForRange": true
    }
  ],
  "page": 1, "pageSize": 32, "total": 199,
  "facets": {
    "price": [
      { "key": "lt100k",   "min": 0,      "max": 100000, "count": 90 },
      { "key": "100k-300k","min": 100000, "max": 300000, "count": 68 },
      { "key": "300k-600k","min": 300000, "max": 600000, "count": 36 },
      { "key": "gte600k",  "min": 600000, "max": null,   "count": 12 }
    ],
    "categories": [ { "slug": "compact", "name": "Compact", "parentSlug": "may-anh", "count": 2 } ],
    "brands": [ { "slug": "sony", "name": "Sony", "count": 14 } ]
  }
}
```
- `isFavorite` nằm trong cấu trúc thẻ máy tóm tắt (`CameraSummary` dùng chung cho `GET /cameras`, `GET /favorites`, danh sách máy trong `GET /hosts/:id`). Với các endpoint công khai này, header token là tùy chọn: có token thì tính `isFavorite` theo người dùng, không có thì `false`.
- `badges` có thể gồm `NEW` (tự gắn cho tin mới được duyệt trong 14 ngày) và `HOT` (admin gắn tay). Chưa có giảm giá.
- `availableForRange` chỉ có khi truyền `from` và `to`.
- Số lượng trong `facets` được tính theo các bộ lọc **khác** đang áp dụng, để sidebar luôn đúng.
- Chỉ trả máy `ACTIVE`.
- `q`: tìm theo tiêu đề, model và tên hãng; không phân biệt hoa thường, **không phân biệt dấu tiếng Việt**.
- `badge=HOT`: dùng cho "máy nổi bật" ở trang chủ.
- **Máy tương tự** (ở trang chi tiết): gọi `GET /cameras?category=<slug danh mục của máy>&excludeId=<id máy đang xem>&pageSize=4`. `excludeId` loại máy đó khỏi kết quả.

**🌐 `GET /cameras/:slug`**
```json
{
  "id": "cam1", "slug": "fujifilm-x100vi-ha-noi", "title": "Fujifilm X100VI",
  "description": "...", "model": "X100VI", "cameraType": "DIGITAL", "mount": null,
  "shutterCount": 3200, "filmFormat": null, "conditionNote": "Máy như mới, có trầy nhẹ ở viền",
  "brand": { "slug": "fujifilm", "name": "Fujifilm" },
  "category": { "slug": "compact", "name": "Compact" },
  "pricePerDay": 450000, "pricePerWeek": 2500000, "deposit": 8000000,
  "city": "Hà Nội", "district": "Tây Hồ",
  "images": [ { "id": "i1", "url": "https://...", "sortOrder": 0 } ],
  "accessories": [ { "name": "Pin dự phòng", "icon": "battery" } ],
  "cancellationPolicy": "Hủy trước 24 giờ được hoàn toàn bộ.",
  "host": { "id": "u2", "fullName": "Trần B", "avatarUrl": null, "verified": true, "completedRentals": 0 },
  "isFavorite": false
}
```
`isFavorite` chỉ chính xác khi có token; khách vãng lai luôn `false`. Không có hoặc không `ACTIVE` thì `404 NOT_FOUND`.

**🌐 `GET /cameras/:id/availability?month=2026-12`**
```json
{ "month": "2026-12", "unavailableDates": ["2026-12-03", "2026-12-04"], "blockedByHostDates": ["2026-12-10"] }
```
`unavailableDates` là ngày đã có đơn; `blockedByHostDates` là ngày chủ máy tự chặn. Chủ sở hữu máy (🏠) thấy cả hai nhóm để vẽ lịch ba màu; người khác nên gộp cả hai thành "hết máy".

**🌐 `POST /bookings/quote`** — tính tiền trước khi đặt, **không** giữ chỗ.
```json
// request
{ "cameraId": "cam1", "startDate": "2026-12-12", "endDate": "2026-12-15" }
// 200
{
  "days": 3, "pricePerDay": 450000,
  "rentalAmount": 1350000, "depositAmount": 8000000, "platformFee": 135000,
  "totalDueAtPickup": 9350000, "available": true
}
```
`available: false` kèm `conflictingDates` khi khoảng ngày không còn trống. `totalDueAtPickup` = tiền thuê + phí + cọc.

### 4.3a Hồ sơ chủ máy công khai

**🌐 `GET /hosts/:id`**
```json
{
  "id": "u2", "fullName": "Trần B", "avatarUrl": null, "verified": true,
  "completedRentals": 0, "joinedAt": "2026-10-01T00:00:00Z",
  "cameras": {
    "items": [ /* cùng cấu trúc CameraSummary như GET /cameras, chỉ tin ACTIVE của chủ máy này */ ],
    "page": 1, "pageSize": 12, "total": 5
  }
}
```
Query: `page`, `pageSize` (áp dụng cho `cameras`). Không có người dùng này, hoặc người này chưa có vai trò `HOST`: `404 NOT_FOUND`. Không trả email, số điện thoại.

### 4.4 Yêu thích

- 🔑 `POST /favorites/:cameraId` → `204`. 🔑 `DELETE /favorites/:cameraId` → `204`.
- 🔑 `GET /favorites?page=1` → danh sách có cùng cấu trúc `items` như `GET /cameras` (không có `facets`).

### 4.5 Đơn thuê

Cấu trúc đơn dùng chung:
```json
{
  "id": "bk1", "code": "BR-8K2F9", "status": "PENDING",
  "camera": { "id": "cam1", "slug": "fujifilm-x100vi-ha-noi", "title": "Fujifilm X100VI", "thumbnailUrl": "https://..." },
  "renter": { "id": "u1", "fullName": "Nguyễn Văn A", "phone": "0912345678" },
  "host":   { "id": "u2", "fullName": "Trần B", "phone": "0987654321" },
  "startDate": "2026-12-12", "endDate": "2026-12-15", "days": 3,
  "rentalAmount": 1350000, "depositAmount": 8000000, "platformFee": 135000,
  "createdAt": "2026-11-07T08:30:00Z", "expiresAt": "2026-11-08T08:30:00Z",
  "cancelledReason": null, "rejectedReason": null,
  "viewerRole": "RENTER",
  "allowedActions": ["cancel"]
}
```
- `phone` của bên kia chỉ được trả khi đơn đã `OWNER_APPROVED` (trước đó là `null`).
- `expiresAt` chỉ có ý nghĩa khi `PENDING`: FE có thể hiển thị đếm ngược.
- `allowedActions` có thể gồm: `cancel`, `approve`, `reject`.

**🔑 `POST /bookings`** — tạo đơn `PENDING`
```json
// request
{ "cameraId": "cam1", "startDate": "2026-12-12", "endDate": "2026-12-15", "note": "Mình lấy máy lúc 9h sáng" }
// 201 → đối tượng đơn như trên
```
Lỗi: `409 BOOKING_DATE_UNAVAILABLE`, `422 CANNOT_BOOK_OWN_CAMERA`, `422 CAMERA_NOT_BOOKABLE`, `400 VALIDATION_ERROR` (ngày trả không sau ngày nhận, ngày nhận ở quá khứ).

**🔑 `GET /bookings?status=&page=`** — đơn tôi thuê → `{ items: [đơn], page, pageSize, total }`.

**🏠 `GET /host/bookings?status=&page=`** — đơn gửi đến máy của tôi, cùng cấu trúc.

**🔑 `GET /bookings/:id`** — chỉ renter, host của đơn hoặc admin xem được; người khác `404`.

**🔑 `POST /bookings/:id/cancel`** — chỉ dành cho renter của đơn; body `{ "reason": "..." }` (tùy chọn) → trả đơn mới (`CANCELLED`). Lỗi: `409 INVALID_STATUS_TRANSITION`.

**🏠 `POST /host/bookings/:id/approve`** (không body) → trả đơn mới (`OWNER_APPROVED`).

**🏠 `POST /host/bookings/:id/reject`** — body `{ "reason": "..." }` (tùy chọn) → trả đơn mới (`REJECTED`).

### 4.6 Tin đăng của chủ máy

Đối tượng tin đăng của chủ máy (`HostCamera`) gồm tất cả trường của "chi tiết máy" ở 4.3, cộng thêm:
```json
{ "status": "DRAFT", "rejectReason": null, "updatedAt": "2026-11-07T08:30:00Z" }
```

- **🏠 `POST /host/cameras`** — tạo `DRAFT`. Body: `categorySlug`, `brandSlug`, `title`, `model`, `cameraType`, `description`, `mount`, `shutterCount`, `filmFormat`, `conditionNote`, `pricePerDay`, `pricePerWeek`, `deposit`, `city`, `district`, `cancellationPolicy`, `accessories: [{name, icon}]`. BE tự tra `categorySlug` và `brandSlug` sang ID tương ứng (nếu slug không tồn tại trả `400 VALIDATION_ERROR` kèm `details.fields`). Bản nháp cho phép thiếu trường; `submit` mới kiểm tra đủ.
- **🏠 `PATCH /host/cameras/:id`** — sửa; chỉ chủ sở hữu. Tin `PENDING_REVIEW` không sửa được (`409 INVALID_STATUS_TRANSITION`).
- **🏠 `GET /host/cameras`** — danh sách của tôi. **🏠 `GET /host/cameras/:id`** — chi tiết `HostCamera`.
- **🏠 `POST /host/cameras/:id/submit`** — gửi duyệt → `PENDING_REVIEW`. Thiếu trường bắt buộc (ít nhất 1 ảnh, `title`, `model`, `cameraType`, danh mục, hãng, `pricePerDay`, `deposit`, `city`, `district`) thì `400 VALIDATION_ERROR` kèm `fields`. Các trường còn lại là tùy chọn.
- **🏠 `POST /host/cameras/:id/pause`** và **`/resume`** — tạm ẩn / hiện lại tin `ACTIVE`.
- **🏠 `DELETE /host/cameras/:id`** → `204`. **Chỉ xóa được tin `DRAFT`**; tin ở trạng thái khác `409 INVALID_STATUS_TRANSITION` (dùng tạm ẩn thay thế).

**Tải ảnh (hai bước):**
1. **🏠 `POST /host/cameras/:id/images/presign`** — body `{ "contentType": "image/jpeg" }` → `{ "uploadUrl": "https://...", "path": "cameras/cam1/abc.jpg" }`. FE `PUT` file lên `uploadUrl`.
2. **🏠 `POST /host/cameras/:id/images`** — body `{ "path": "cameras/cam1/abc.jpg", "sortOrder": 0 }` → trả ảnh `{ id, url, sortOrder }`.
- **🏠 `PATCH /host/cameras/:id/images/order`** — body `{ "imageIds": ["i2", "i1"] }`. **🏠 `DELETE /host/cameras/:id/images/:imageId`** → `204`.
- Giới hạn: ảnh JPG/PNG/WebP, tối đa 5 MB mỗi ảnh, tối đa 10 ảnh mỗi tin.

**Chặn lịch:**
- Chống race condition: trong transaction tạo đơn và transaction tạo khoảng chặn, hệ thống khóa dòng máy trước bằng `SELECT id FROM cameras WHERE id = $1 FOR UPDATE`, sau đó mới kiểm tra chéo và insert.
- **🏠 `POST /host/blocked-dates`** — `{ "cameraId": "cam1", "startDate": "2026-12-10", "endDate": "2026-12-12", "reason": "Đi vắng" }` → `{ id, ... }`. Lỗi: `409 BOOKING_DATE_UNAVAILABLE`.
- **🏠 `GET /host/blocked-dates?cameraId=&from=&to=`** — các khoảng đã chặn của máy tôi (`cameraId` bắt buộc; `from`/`to` dạng `YYYY-MM-DD` để giới hạn tháng đang xem).
```json
{ "items": [ { "id": "bd1", "cameraId": "cam1", "startDate": "2026-12-10", "endDate": "2026-12-12", "reason": "Đi vắng" } ] }
```
- **🏠 `DELETE /host/blocked-dates/:id`** → `204`. Chỉ chủ sở hữu máy xóa được.

### 4.7 Admin

- **🛡 `POST /admin/bookings/:id/cancel`** — body `{ "reason": "Lý do hủy đơn" }` (`reason` bắt buộc). Chỉ hủy được đơn ở trạng thái `PENDING` hoặc `OWNER_APPROVED`; ghi `audit_logs` → trả đối tượng đơn mới (`CANCELLED`). Lỗi: `400 VALIDATION_ERROR` (nếu thiếu reason), `409 INVALID_STATUS_TRANSITION` (nếu đơn không ở trạng thái PENDING hoặc OWNER_APPROVED).
- **🛡 `GET /admin/cameras?status=&page=&pageSize=`** — query `status` nhận bất kỳ giá trị trạng thái tin đăng nào (`DRAFT`, `PENDING_REVIEW`, `ACTIVE`, `PAUSED`, `REJECTED`); bỏ trống thì mặc định `PENDING_REVIEW`; có phân trang `{ items, page, pageSize, total }` trả danh sách `HostCamera` kèm thông tin chủ máy.
- **🛡 `POST /admin/cameras/:id/approve`** → `ACTIVE`. **🛡 `POST /admin/cameras/:id/reject`** — body `{ "reason": "Ảnh mờ, vui lòng chụp lại" }` (bắt buộc) → `REJECTED`.
- **🛡 `PATCH /admin/cameras/:id/promotion`** — body `{ "hot": true }` gắn hoặc bỏ nhãn `HOT` → trả `HostCamera`.
- **🛡 `GET /admin/kyc-submissions?status=PENDING`** → `{ items: [ { id, user: {...}, idFrontUrl, idBackUrl, selfieUrl, status, createdAt } ] }`. Các URL ảnh có thời hạn ngắn, FE không lưu lại.
- **🛡 `POST /admin/kyc-submissions/:id/approve`**; **`/reject`** với body `{ "reason": "..." }` (bắt buộc).

### 4.8 Chưa có (sẽ bổ sung sau, FE chưa làm)

- Thanh toán, giữ cọc, hoàn cọc, các trạng thái đơn sau `OWNER_APPROVED`.
- Chat, đánh giá, tranh chấp, thông báo.
- Số liệu tổng quan chủ máy (doanh thu, tỷ lệ lấp đầy).
- Đánh giá, giỏ hàng, giảm giá (xem mục 2.5).

---

## 5. LUỒNG CHÍNH (để FE hình dung)

**Đặt thuê:**
1. `/rent` → `GET /cameras` (kèm `from`/`to` nếu đã chọn ngày).
2. `/camera/[slug]` → `GET /cameras/:slug` + `GET /cameras/:id/availability?month=` cho mỗi tháng đang xem trên lịch.
3. Người dùng chọn ngày → `POST /bookings/quote` để hiện chi phí.
4. Bấm "Đặt thuê" → nếu chưa đăng nhập: `/login?next=/checkout?camera=...&from=...&to=...`; nếu đã đăng nhập: `/checkout`.
5. `/checkout` gọi lại `quote`, bấm gửi → `POST /bookings` → chuyển `/bookings/[id]`.
6. Chủ máy vào `/host/orders` → mở đơn → duyệt hoặc từ chối.
7. Người thuê thấy đơn đổi sang `OWNER_APPROVED` hoặc `REJECTED` ở `/bookings`.

**Đăng máy:** `/host/listings/new` → tạo `DRAFT` ở bước 1 → tải ảnh (presign → PUT → đăng ký ảnh) → cập nhật các bước sau bằng `PATCH` → `submit` → admin duyệt ở `/admin/listings-review` → tin `ACTIVE` xuất hiện ở `/rent`.

---

## 6. CÁCH FE LÀM KHI BE CHƯA XONG

- Dựng mock (MSW hoặc Prism) theo **đúng các ví dụ JSON trong tài liệu này**. Khi BE xong chỉ cần tắt mock.
- BE sẽ xuất `docs/openapi.yaml`; FE chạy `gen:api` để sinh kiểu TypeScript. Nếu ví dụ trong tài liệu và file OpenAPI khác nhau, **file OpenAPI đúng**, hãy báo BE sửa tài liệu.
- Thứ tự gợi ý: P1 (đăng ký/đăng nhập, trang chủ, `/rent`, chi tiết máy) → P2 (đặt thuê, đơn, khu vực chủ máy) → P3 (admin, yêu thích, KYC).

## 7. QUY TRÌNH ĐỔI API

1. Bên nào muốn đổi mở một Pull Request sửa `openapi.yaml` (hoặc ghi vào tài liệu này) và gắn thẻ bên kia.
2. Hai bên đồng ý rồi mới merge. BE chỉ **thêm** trường; đổi tên, xóa trường hoặc đổi ý nghĩa phải báo trước và sửa cùng lúc ở hai phía.
3. Mọi thay đổi ghi vào mục "Lịch sử thay đổi" ở cuối tài liệu.

## 8. CÂU HỎI CẦN HAI BÊN THỐNG NHẤT

1. Cách tính số ngày thuê (mục 1.3: trả máy không tính ngày kín) có đúng với thực tế cho thuê máy ảnh bạn muốn không? Có cần thuê theo giờ không?
2. Có cho người thuê bỏ qua đăng nhập khi xem lịch/giá? (hiện tại: có, public).
3. Khoảng giá trong bộ lọc (dưới 100k, 100k–300k, 300k–600k, từ 600k) có cần chỉnh theo giá thực tế?
4. Tỉ lệ phí dịch vụ (đang đặt 10% tiền thuê) và chính sách hủy mặc định.
5. Có hiển thị số điện thoại hai bên sau khi duyệt đơn (đang là có), hay chỉ liên lạc qua chat khi chat hoàn thiện?
6. Tin đăng có cần admin duyệt trước khi hiển thị? (đang là có; có thể tắt ở giai đoạn đầu cho nhanh).

## 9. LỊCH SỬ THAY ĐỔI

| Ngày | Thay đổi | Người sửa |
|---|---|---|
| 2026-11-07 | Bản đầu tiên | BE |
| 2026-11-08 | Thêm `GET /hosts/:id`, `GET /me/kyc`, `POST /me/avatar/presign` (`avatarUrl` → `avatarPath` khi ghi), `GET /host/blocked-dates`, `DELETE /host/cameras/:id`, `PATCH /admin/cameras/:id/promotion`; thêm tham số `badge`, `excludeId`, `q` không dấu cho `GET /cameras`; bỏ `DISCOUNT`; thêm mục 2.5 (chỗ không có API) | BE |
| 2026-11-08 | Thống nhất quy tắc: trường bắt buộc khi submit tin (ít nhất 1 ảnh, title, model, cameraType, category, brand, pricePerDay, deposit, city, district); thêm isFavorite vào thẻ máy dùng chung kèm token tùy chọn; sửa completedRentals = 0; khóa SELECT FOR UPDATE chống race condition giữa booking và blocked_dates; GET /admin/cameras nhận query status tùy chọn (mặc định PENDING_REVIEW) kèm phân trang | BE |
| 2026-11-08 | Thêm endpoint POST /admin/bookings/:id/cancel (body reason bắt buộc, chỉ PENDING/OWNER_APPROVED, ghi audit); làm rõ POST /bookings/:id/cancel chỉ dành cho renter; làm rõ POST /host/cameras BE tự tra categorySlug/brandSlug và trả 400 nếu slug không tồn tại; chốt schema public. | BE |
