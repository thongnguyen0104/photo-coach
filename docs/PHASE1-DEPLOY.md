# Phase 1 — Đưa app lên mạng (Vercel)

> Làm sau khi xong Phase 0 ([PHASE0-SETUP.md](PHASE0-SETUP.md)): `npm run check` báo 4/4 OK **và** `npm run cors` báo Test A OK.
> Thời gian: khoảng 30 phút.

## Checklist

- [ ] Bước 1 — Chạy thử trên máy với dịch vụ thật
- [ ] Bước 2 — Đẩy code lên GitHub
- [ ] Bước 3 — Tạo project trên Vercel + điền biến môi trường
- [ ] Bước 4 — Thêm link Vercel vào Google OAuth
- [ ] Bước 5 — Thử trên điện thoại

---

## Bước 1 — Chạy thử trên máy với dịch vụ thật

1. Điền đủ `.env.local` (xem Phase 0).
2. Trong Terminal: `npm run dev` → mở http://localhost:3000
3. Banner vàng "Đang chạy chế độ local" **phải biến mất** (nghĩa là đã dùng Neon + Oracle + Gemini thật).
4. Bấm **Đăng nhập bằng Google** → upload 1 ảnh chụp bằng điện thoại → bấm **Phân tích ảnh**.
5. Thấy trang kết quả có điểm, đánh dấu trên ảnh, nhận xét → OK.

> ⚠ `npm run cors` (Phase 0) và `npm run dev` cùng dùng cổng 3000 → đừng chạy cùng lúc.

## Bước 2 — Đẩy code lên GitHub

1. Vào https://github.com/new
   - **Repository name:** `photo-coach`
   - Chọn **Private**
   - **Không** tick "Add a README" (đã có sẵn)
   - Bấm **Create repository**.
2. Trong Terminal của VS Code (ở thư mục dự án), chạy lần lượt (thay `TEN_BAN` bằng username GitHub):
   ```bash
   git init
   git add .
   git commit -m "Phase 1: photo coach MVP"
   git branch -M main
   git remote add origin https://github.com/TEN_BAN/photo-coach.git
   git push -u origin main
   ```
   > `.env.local` **không** bị đẩy lên (đã nằm trong `.gitignore`). Kiểm tra trên trang GitHub: không được thấy file `.env.local`.

   (Hoặc nhờ Claude: "commit và push lên GitHub giúp tôi".)

## Bước 3 — Tạo project trên Vercel

1. Vào https://vercel.com/new → mục **Import Git Repository** → chọn `photo-coach` → **Import**.
2. **Framework Preset:** Next.js (tự nhận).
3. Mở **Build and Output Settings** → **Build Command** → bật Override → điền:
   ```
   npm run vercel-build
   ```
   (Lệnh này tạo/cập nhật bảng trong Neon rồi mới build.)
4. Mở **Environment Variables**:
   - Mở file `.env.local` trên máy → **chọn tất cả, copy** → dán vào ô đầu tiên (Vercel tự tách thành từng biến).
   - Xoá các dòng có giá trị trống, và các biến chỉ dùng khi chạy local (`AI_PROVIDER`, `STORAGE_DRIVER`, `AUTH_DEV_LOGIN`) nếu có.
   - Bắt buộc phải có: `DATABASE_URL`, `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `GEMINI_API_KEY`, `GEMINI_MODEL`, `OCI_NAMESPACE`, `OCI_REGION`, `OCI_BUCKET`, `OCI_ACCESS_KEY_ID`, `OCI_SECRET_ACCESS_KEY`, `DAILY_QUOTA`.
5. Bấm **Deploy** → chờ 1–3 phút → nhận link dạng `https://photo-coach-xxxx.vercel.app`.

> Server được đặt ở Singapore (`vercel.json` → `sin1`), cùng khu vực với Neon → truy vấn nhanh.
> Lỗi build? Vào tab **Deployments** → bấm vào bản lỗi → **Build Logs** → copy đoạn đỏ gửi Claude.

## Bước 4 — Thêm link Vercel vào Google OAuth

Nếu bỏ qua bước này, bấm "Đăng nhập bằng Google" trên web thật sẽ báo lỗi `redirect_uri_mismatch`.

1. https://console.cloud.google.com → đúng project → **Google Auth Platform → Clients** → bấm vào client "Photo Coach Web".
2. **Authorized JavaScript origins** → **Add URI** → `https://photo-coach-xxxx.vercel.app`
3. **Authorized redirect URIs** → **Add URI** → `https://photo-coach-xxxx.vercel.app/api/auth/callback/google`
4. **Save** (có thể mất vài phút mới có hiệu lực).
5. App đang ở chế độ **Testing** → chỉ email trong **Audience → Test users** đăng nhập được. Muốn ai cũng dùng được: **Audience → Publish app**.

## Bước 5 — Thử trên điện thoại

Mở link Vercel trên điện thoại → đăng nhập → chụp/chọn 1 ảnh (iPhone: thử cả ảnh HEIC) → phân tích.

---

## Lỗi thường gặp

| Hiện tượng | Nguyên nhân / cách sửa |
|---|---|
| Trang trắng, log có `[config] storage: thiếu OCI_...` | Thiếu biến Oracle trên Vercel → Settings → Environment Variables → thêm → **Redeploy** |
| "AI đang quá tải (giới hạn gói miễn phí)" | Hết quota Gemini của model đang dùng (flash-latest chỉ ~20 lượt/ngày ở gói free). Đợi qua ngày, hoặc đổi `GEMINI_MODEL=gemini-3.5-flash-lite` |
| "Tải ảnh lên thất bại" | Oracle chặn upload từ trình duyệt (CORS) → xem lại Phase 0 Bước 9, báo Claude để làm phương án dự phòng |
| `redirect_uri_mismatch` khi đăng nhập | Làm lại Bước 4, kiểm tra đúng link, không thừa dấu `/` cuối |
| Sửa biến môi trường mà app không đổi | Vercel chỉ áp dụng biến mới sau khi **Redeploy** |
