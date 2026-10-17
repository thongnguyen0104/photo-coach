# Photo Coach — App hướng dẫn chụp ảnh

Upload 1 tấm ảnh → app đọc toàn bộ thông tin gốc (EXIF, GPS, XMP, IPTC, ICC, histogram) → AI (Google Gemini) phân tích bố cục, tỉ lệ, phơi sáng, khẩu độ, HDR, vị trí người → hiển thị **đánh dấu trực tiếp trên ảnh** + nhận xét kiểu "khen thật, góp ý như lời khen".

- Kế hoạch tổng: [.claude/PLAN.md](.claude/PLAN.md)
- Phase 0 (tạo tài khoản, lấy key): [docs/PHASE0-SETUP.md](docs/PHASE0-SETUP.md)
- Đưa lên mạng (Vercel): [docs/PHASE1-DEPLOY.md](docs/PHASE1-DEPLOY.md)

## Chạy trên máy

Cần Node.js 20+ (đang dùng 24).

```bash
npm install
npm run dev          # tự migrate DB rồi mở http://localhost:3000
```

### Chế độ local — chạy được khi CHƯA có đủ tài khoản

App tự nhìn `.env.local`: dịch vụ nào đã điền thì dùng thật, chưa điền thì dùng bản thay thế. Trên đầu trang có banner vàng báo đang thay thế cái gì.

| Thành phần | Có biến môi trường | Chưa có (chỉ khi chạy local) |
|---|---|---|
| Database | Neon (`DATABASE_URL`) | Postgres nhúng PGlite, lưu ở `.data/pglite` |
| Lưu ảnh | Oracle Object Storage (`OCI_*`) | Thư mục `.data/storage` |
| AI | Gemini (`GEMINI_API_KEY`) | AI giả lập — dựng kết quả từ số đo thật, nhưng không "nhìn" được ảnh |
| Đăng nhập | Google (`AUTH_GOOGLE_*`) | Nút "Đăng nhập thử" (luôn có khi chạy local, không bao giờ có trên production) |

Trên production (Vercel) mà thiếu biến nào → app báo lỗi rõ ràng, không âm thầm dùng bản giả.

## Lệnh hay dùng

| Lệnh | Việc |
|---|---|
| `npm run dev` | Chạy app ở chế độ phát triển |
| `npm test` | 57 unit/integration test (Vitest, DB thật trong RAM) |
| `npm run test:e2e` | Test bằng trình duyệt thật (Playwright): đăng nhập → upload → phân tích → xoá, trên desktop + điện thoại. **Tốn 2 lượt Gemini nếu đã cấu hình** |
| `npm run typecheck` / `npm run lint` | Kiểm tra kiểu / code style |
| `npm run build` | Build production (giống Vercel) |
| `npm run db:generate` | Sinh file migration sau khi sửa `src/lib/db/schema.ts` |
| `npm run db:migrate` | Áp migration vào DB |
| `cd tools/setup-check && npm run check` | Kiểm tra kết nối Neon / Gemini / Google / Oracle |

## Công nghệ

Next.js 16 (App Router) · TypeScript · Tailwind CSS 4 · Auth.js v5 · Drizzle ORM · Neon Postgres · Oracle Object Storage (S3 API) · Google Gemini (`@google/genai`) · next-intl (vi/en) · exifr · heic2any · Vitest · Playwright

## Cấu trúc

```
src/
  app/                    trang + API
    page.tsx              trang chủ / upload
    analyze/[id]/         trang kết quả
    history/  privacy/
    api/uploads           tạo bản ghi ảnh + URL upload thẳng lên storage
    api/analyses          gọi AI phân tích
    api/photos/[id]       xoá ảnh
    api/local-storage/    (chỉ chế độ local) giả lập pre-signed URL
  components/
    upload/Uploader.tsx   chọn ảnh → đọc EXIF → upload → phân tích
    result/               PhotoOverlay (lớp đánh dấu), điểm, nhận xét, histogram, EXIF
  lib/
    image/                đọc metadata (exifr), đo pixel, tạo preview — chạy ở trình duyệt
    analysis/             schema output AI, prompt, facts đo bằng code, hậu xử lý, Gemini, AI giả lập
    server/               logic server: upload, phân tích, quota, lỗi
    storage/              Oracle (S3 API) / local
    db/                   schema Drizzle + kết nối Neon/PGlite
  messages/vi.json, en.json   toàn bộ chữ trên giao diện
drizzle/                  file SQL migration
tests/unit, tests/e2e     test
tools/setup-check/        công cụ Phase 0
```

## Ghi chú kỹ thuật quan trọng

- **Ảnh không đi qua server Vercel** (giới hạn 4.5MB/request): trình duyệt upload thẳng lên Oracle bằng pre-signed URL. Server chỉ đọc bản preview 1536px để gửi Gemini.
- **Gemini từ chối JSON schema có `minimum/maximum/minItems/maxItems`** (lỗi 400 "invalid argument"). Giới hạn chỉ ghi trong `description`; `src/lib/analysis/postprocess.ts` kẹp giá trị và cắt mảng. Có test chặn lỗi này quay lại.
- **Số đo bằng code (facts)** — độ sáng, cháy sáng, rung tay, ISO… — được đưa vào prompt để AI không bịa thông số, và hiển thị riêng ở mục "Số liệu đo được".
- Đổi prompt → tăng `PROMPT_VERSION` trong `src/lib/analysis/prompt.ts` (kết quả cũ không bị dùng lại từ cache).
