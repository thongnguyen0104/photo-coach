# Phase 0 — Chuẩn bị tài khoản & kiểm tra kết nối

> Mục tiêu: tạo đủ tài khoản miễn phí, lấy các "chìa khoá" (key), điền vào file `.env.local`, rồi chạy 1 lệnh để kiểm tra mọi thứ đã thông.
> Thời gian: khoảng 1–2 giờ (Oracle lâu nhất vì phải xác minh thẻ).
> Không cần biết code. Chỉ cần làm đúng thứ tự và copy-paste cẩn thận.

## Checklist tổng

- [ ] Bước 1 — Tài khoản GitHub
- [ ] Bước 2 — Tài khoản Vercel
- [ ] Bước 3 — Neon Postgres → `DATABASE_URL`
- [ ] Bước 4 — Gemini API key → `GEMINI_API_KEY`
- [ ] Bước 5 — Google OAuth → `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`
- [ ] Bước 6 — Oracle Cloud → `OCI_NAMESPACE`, `OCI_REGION`, `OCI_BUCKET`, `OCI_ACCESS_KEY_ID`, `OCI_SECRET_ACCESS_KEY`
- [ ] Bước 7 — Điền `.env.local`
- [ ] Bước 8 — Chạy `npm run check` (tất cả ✔)
- [ ] Bước 9 — Chạy `npm run cors` (test upload từ trình duyệt)
- [ ] Bước 10 — Báo kết quả cho Claude

---

## ⚠️ 3 quy tắc an toàn (đọc trước)

1. **File `.env.local` chứa toàn bộ chìa khoá.** Nó đã được đưa vào `.gitignore` nên sẽ không bị đẩy lên GitHub. Đừng gửi file này cho ai.
2. **Không dán key/secret vào khung chat với AI.** Khi cần, cứ bảo Claude "chạy check", script chỉ in ra dạng che bớt (`AIza…x7Q`).
3. Có key nào bị lộ → vào trang tạo key đó, **xoá key cũ, tạo key mới**.

### Cách mở file `.env.local` và Terminal trong VS Code
- File `.env.local` đã được tạo sẵn ở thư mục gốc dự án (`D:\Projects\photo-coach\.env.local`). Trong VS Code, xem cột Explorer bên trái → bấm vào file để mở. `AUTH_SECRET` đã được điền sẵn.
- Mở Terminal: menu **Terminal → New Terminal** (hoặc `Ctrl + ` `).
- Viết giá trị **ngay sau dấu `=`, không có dấu cách, không có dấu nháy**. Ví dụ đúng: `OCI_REGION=ap-singapore-1`

---

## Bước 1 — GitHub (nơi lưu code)

1. Vào https://github.com/signup → đăng ký bằng email.
2. Xác minh email.
3. Xong. (Repo sẽ tạo ở Phase 1.)

## Bước 2 — Vercel (nơi chạy web)

1. Vào https://vercel.com/signup → chọn **Hobby** (miễn phí) → **Continue with GitHub**.
2. Cho phép Vercel truy cập GitHub khi được hỏi.
3. Xong. Chưa cần tạo project. Ở Phase 1, Claude sẽ tạo code, đẩy lên GitHub rồi bạn bấm "Import" trên Vercel.

> Lưu ý: gói Hobby chỉ dùng cho mục đích cá nhân/phi thương mại.

## Bước 3 — Neon Postgres (cơ sở dữ liệu) → `DATABASE_URL`

1. Vào https://neon.com → **Sign up** → đăng nhập bằng GitHub hoặc Google.
2. Tạo project:
   - **Project name:** `photo-coach`
   - **Postgres version:** để mặc định
   - **Region:** chọn **AWS Asia Pacific (Singapore)** — gần Việt Nam nhất, app sẽ nhanh hơn.
   - Bấm **Create project**.
3. Ở trang Dashboard của project, bấm nút **Connect** (góc trên).
4. Trong hộp thoại:
   - Bật **Connection pooling** (nếu có công tắc này).
   - Chọn kiểu hiển thị **Connection string** (không chọn psql hay code mẫu).
   - Bấm **Copy snippet** / biểu tượng copy.
5. Dán vào `.env.local`:
   ```
   DATABASE_URL=postgresql://neondb_owner:xxxx@ep-xxxx-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require
   ```
   ✅ Chuỗi đúng thì bắt đầu bằng `postgresql://`, có chữ `-pooler` và kết thúc bằng `sslmode=require` (có thể kèm `&channel_binding=require`, vẫn được).
   ❌ Sai thường gặp: copy cả chữ `psql '...'`. Chỉ lấy phần trong dấu nháy.

## Bước 4 — Gemini API key (AI phân tích ảnh) → `GEMINI_API_KEY`

1. Vào https://aistudio.google.com → đăng nhập bằng tài khoản Google.
2. Đồng ý điều khoản nếu được hỏi.
3. Bấm **Get API key** (menu trái hoặc góc trên) → **Create API key**.
4. Nếu được hỏi chọn project: chọn **Create API key in new project** (hoặc chọn project có sẵn).
5. Copy key (dạng `AIza...`) → dán vào `.env.local`:
   ```
   GEMINI_API_KEY=AIza...
   ```
6. `GEMINI_MODEL=gemini-flash-latest` → **giữ nguyên**. Tên này luôn trỏ tới bản Flash mới nhất.

> 💡 **Đừng bật Billing** cho project này nếu muốn chắc chắn 0đ. Gói miễn phí có giới hạn số lượt/phút và lượt/ngày, đủ cho dùng cá nhân.
> Lưu ý: ở gói miễn phí, Google có thể dùng dữ liệu gửi lên để cải thiện sản phẩm. Ta sẽ ghi rõ điều này ở trang Privacy của app.

## Bước 5 — Google OAuth (nút "Đăng nhập bằng Google") → `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`

1. Vào https://console.cloud.google.com → đăng nhập.
2. **Chọn project:** bấm ô chọn project ở thanh trên cùng → chọn project vừa tạo ở Bước 4 (thường tên "Gemini API" / "Default Gemini Project"), hoặc **New Project** đặt tên `photo-coach`.
3. Gõ vào ô tìm kiếm trên cùng: **"Google Auth Platform"** (hoặc vào menu ☰ → **APIs & Services → OAuth consent screen**) → bấm **Get started**.
4. Điền:
   - **App name:** `Photo Coach` (tên tuỳ ý, user sẽ thấy khi đăng nhập)
   - **User support email:** email của bạn → **Next**
   - **Audience:** chọn **External** → **Next**
   - **Contact information:** email của bạn → **Next**
   - Tick đồng ý → **Create**.
5. Vào mục **Audience** (menu trái) → phần **Test users** → **Add users** → thêm Gmail của bạn (và của người bạn muốn cho dùng thử) → **Save**.
   > Khi app ở chế độ "Testing", chỉ những email trong danh sách này đăng nhập được. Sau này muốn mở cho mọi người thì bấm **Publish app**. App chỉ xin email + tên + ảnh đại diện nên thường không cần Google duyệt.
6. Vào mục **Clients** (menu trái) → **Create client**:
   - **Application type:** `Web application`
   - **Name:** `Photo Coach Web`
   - **Authorized JavaScript origins** → **Add URI** → `http://localhost:3000`
   - **Authorized redirect URIs** → **Add URI** → `http://localhost:3000/api/auth/callback/google`
   - Bấm **Create**.
7. Một hộp thoại hiện **Client ID** và **Client secret**.
   ⚠️ **Copy cả 2 ngay** (nên bấm **Download JSON** để lưu dự phòng vào chỗ an toàn, *không* để trong thư mục dự án). Google có thể không cho xem lại secret sau khi đóng hộp thoại.
   ```
   AUTH_GOOGLE_ID=1234567890-abc...apps.googleusercontent.com
   AUTH_GOOGLE_SECRET=GOCSPX-...
   ```
8. Ở Phase 1, khi có link Vercel thật (vd `https://photo-coach.vercel.app`), ta sẽ quay lại đây thêm link đó vào origins và redirect URIs.

## Bước 6 — Oracle Cloud Object Storage (lưu ảnh) → 5 biến `OCI_*`

### 6.1 Đăng ký tài khoản
1. Vào https://signup.cloud.oracle.com → điền email, tên, quốc gia **Vietnam**.
2. **Home Region:** chọn **Singapore** (`ap-singapore-1`).
   ⚠️ Không đổi được sau khi tạo. Singapore gần Việt Nam nhất và cùng khu vực với Neon.
3. Xác minh số điện thoại và **thẻ Visa/Mastercard**. Oracle có thể tạm giữ một khoản nhỏ để kiểm tra thẻ rồi hoàn lại. Gói **Always Free không tính tiền**, và bạn được thêm $300 dùng thử trong 30 ngày.
   > Nếu thẻ bị từ chối: thử thẻ khác, tắt VPN, dùng đúng địa chỉ của thẻ. Đây là lỗi phổ biến khi đăng ký Oracle.
4. Chờ email "Your account is ready" (vài phút đến vài giờ) → đăng nhập https://cloud.oracle.com.

### 6.2 Tạo bucket (thư mục chứa ảnh)
1. Bấm menu ☰ (góc trái trên) → **Storage** → **Buckets** (nằm trong nhóm *Object Storage & Archive Storage*).
2. Ô **Compartment** (bên trái/trên danh sách): chọn compartment **gốc** (root). Nó có tên giống tên tài khoản (tenancy) của bạn, kèm chữ "(root)".
3. Bấm **Create Bucket**:
   - **Bucket Name:** `photo-coach-uploads`
   - **Default Storage Tier:** `Standard`
   - Các ô khác **để mặc định** (Visibility mặc định là **Private**, đúng như ta cần — **không** chuyển sang Public).
   - Bấm **Create**.
4. Bấm vào bucket vừa tạo → trong phần **Bucket Information**, tìm dòng **Namespace** (một chuỗi chữ-số ngẫu nhiên, vd `axq1b2c3d4e5`). Copy lại.
5. Điền:
   ```
   OCI_NAMESPACE=axq1b2c3d4e5
   OCI_REGION=ap-singapore-1
   OCI_BUCKET=photo-coach-uploads
   ```
   > Nếu bạn chọn region khác ở 6.1: mã region xem ở menu chọn region trên thanh trên cùng → **Manage Regions** (cột *Region Identifier*), vd Tokyo = `ap-tokyo-1`.

### 6.3 Tạo Customer Secret Key (chìa khoá để app ghi/đọc ảnh)
1. Bấm **biểu tượng người** (góc phải trên) → **User settings** (hoặc **My profile**).
2. Tìm mục **Customer secret keys**. Ở giao diện mới nó nằm trong tab **Tokens and keys**; ở giao diện cũ nó nằm ở danh sách **Resources** bên trái.
3. Bấm **Generate secret key** → **Name:** `photo-coach-app` → **Generate secret key**.
4. ⚠️ **Copy chuỗi Secret ngay**. Nó **chỉ hiện 1 lần**. Dán vào:
   ```
   OCI_SECRET_ACCESS_KEY=...chuỗi vừa copy...
   ```
5. Đóng hộp thoại. Trong danh sách Customer secret keys sẽ có dòng mới, cột **Access key** là một chuỗi dài. Bấm vào chuỗi đó (hoặc nút copy cạnh nó) → dán vào:
   ```
   OCI_ACCESS_KEY_ID=...access key...
   ```
6. `OCI_S3_ENDPOINT` → **để trống** (script tự tính).

> Mất Secret? Xoá key đó và tạo key mới. Mỗi user được tối đa 2 Customer secret key.

> Gói Always Free cho Object Storage: 20GB và khoảng 50.000 request/tháng, đủ dư cho dùng cá nhân.

## Bước 7 — Kiểm tra lại `.env.local`

File cuối cùng trông như sau (giá trị là ví dụ):
```
DATABASE_URL=postgresql://neondb_owner:...@ep-...-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require
AUTH_SECRET=đã-điền-sẵn
AUTH_GOOGLE_ID=...apps.googleusercontent.com
AUTH_GOOGLE_SECRET=GOCSPX-...
GEMINI_API_KEY=AIza...
GEMINI_MODEL=gemini-flash-latest
OCI_NAMESPACE=axq1b2c3d4e5
OCI_REGION=ap-singapore-1
OCI_BUCKET=photo-coach-uploads
OCI_ACCESS_KEY_ID=...
OCI_SECRET_ACCESS_KEY=...
OCI_S3_ENDPOINT=
DAILY_QUOTA=10
```
**Nhớ bấm `Ctrl + S` để lưu file.**

## Bước 8 — Chạy kiểm tra tự động

Trong Terminal của VS Code:
```bash
cd tools/setup-check
npm install      # chỉ cần chạy lần đầu
npm run check
```
Kết quả mong muốn:
```
Tổng kết
  ✔ OK  1. Neon Postgres
  ✔ OK  2. Google Gemini
  ✔ OK  3. Google OAuth + AUTH_SECRET
  ✔ OK  4. Oracle Cloud Object Storage
```
- Có dòng **✘ LỖI** → đọc dòng màu xám ngay bên dưới để biết cách sửa, sửa `.env.local`, lưu lại, chạy lại.
- Chỉ kiểm tra 1 dịch vụ: `npm run check -- oci` (hoặc `neon`, `gemini`, `google`).
- 🎁 Thử để AI nhận xét 1 tấm ảnh thật: `npm run check -- gemini "D:\duong-dan\anh.jpg"`

### Lỗi thường gặp
| Thông báo | Cách sửa |
|---|---|
| `DATABASE_URL đang là cả câu lệnh psql` | Chỉ copy phần `postgresql://...` |
| `API key không hợp lệ` (Gemini) | Copy lại key, kiểm tra không thừa dấu cách |
| `model ... not found` | Đổi `GEMINI_MODEL` sang 1 tên trong danh sách "Các model Flash khả dụng" mà script in ra |
| `Không thấy bucket` | Sai tên bucket / namespace / region |
| `Oracle từ chối truy cập (HTTP 403)` | Sai namespace hoặc sai Access/Secret key → tạo Customer secret key mới |
| `Không kết nối được` (Oracle) | Sai `OCI_REGION`, hoặc mạng chặn. Thử tắt VPN. |

## Bước 9 — Test upload thẳng từ trình duyệt (quan trọng nhất của Phase 0)

Đây là "spike" trong kế hoạch. Nó trả lời câu hỏi: **trình duyệt có được phép gửi ảnh thẳng lên Oracle không** (gọi là CORS)? Kết quả quyết định cách làm tính năng upload ở Phase 1.

```bash
npm run cors
```
1. Mở trình duyệt (Chrome/Edge) → vào **http://localhost:3000**
2. Chọn 1 tấm ảnh → bấm **Test A**.
3. Đọc khung kết quả:
   - **🎉 "UPLOAD OK" + "ĐỌC LẠI OK"** → tuyệt vời, bấm **Xoá file test** rồi sang Bước 10.
   - **✘ "Trình duyệt chặn request"** → bấm **F12 → tab Console**, chụp màn hình dòng đỏ, rồi làm **Test B** bên dưới.
4. Xong thì quay lại Terminal, bấm **Ctrl + C** để tắt.

### Test B (chỉ làm nếu Test A lỗi) — Pre-Authenticated Request
1. Oracle Console → bucket `photo-coach-uploads` → mục **Pre-Authenticated Requests** (tab hoặc Resources bên trái) → **Create Pre-Authenticated Request**.
2. Chọn:
   - **Target:** `Bucket`
   - **Access Type:** `Permit object writes`
   - **Expiration:** ngày mai
   - Bấm **Create**.
3. Copy **PAR URL** (chỉ hiện 1 lần) → dán vào ô Test B trên trang test → chọn ảnh → bấm **Test B**.
4. Test xong: quay lại danh sách Pre-Authenticated Requests → **xoá** PAR vừa tạo (ai có link này đều upload được vào bucket).

## Bước 10 — Báo cho Claude

Gửi lại 1 tin nhắn kiểu:
```
Phase 0 xong:
- npm run check: 4/4 OK   (hoặc dán phần "Tổng kết" + dòng lỗi)
- npm run cors: Test A OK / Test A lỗi, Test B OK / cả 2 lỗi (kèm ảnh Console F12)
```
**Không** dán nội dung `.env.local`.

→ Sau đó sang **Phase 1**: dựng app Next.js, đăng nhập Google, upload, phân tích ảnh.
