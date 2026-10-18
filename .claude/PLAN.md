# Kế hoạch: App Hướng Dẫn Chụp Ảnh (photo-coach)

## 0. Trạng thái (cập nhật 2026-10-18)

| Phase | Trạng thái |
|---|---|
| Phase 0 | Công cụ + hướng dẫn xong (`docs/PHASE0-SETUP.md`, `tools/setup-check`). Đã có: Neon, Gemini. **Còn thiếu: Google OAuth, Oracle + spike CORS** |
| Phase 1 | **Code xong + test xong** (57 unit/integration, E2E desktop + mobile với Gemini thật). Còn: deploy Vercel (`docs/PHASE1-DEPLOY.md`) — cần Google OAuth + Oracle trước |
| Phase 2 | **2A xong** (2026-10-18): trang `/camera` — camera trực tiếp, lưới bố cục, khung tỉ lệ, thước cân bằng, cảnh báo sáng/tối, bù sáng (máy hỗ trợ), chụp → phân tích; PWA manifest + icon. Test E2E bằng camera giả. **Chưa test trên điện thoại thật.** Còn 2B (MediaPipe người/mặt, chế độ thể loại) và 2C (MediaPipe + đo chân trời cho ảnh upload) |
| Phase 3 | **Trình chỉnh sửa ảnh xong** (2026-10-18): xoá vật thể (MI-GAN trên trình duyệt), cắt & xoay, màu & sáng, "Áp dụng gợi ý AI", tải ảnh về. Phần còn lại của Phase 3 chưa làm |

### Khác so với kế hoạch ban đầu (và lý do)
- **Next.js 16.4** thay vì 15 — bản ổn định mới nhất. Đã tắt `cacheComponents` (app cá nhân hoá theo user → render động hợp lý hơn).
- **Không dùng shadcn/ui** — tự viết vài class Tailwind (`card`, `btn`) trong `globals.css`, đủ dùng và ít phụ thuộc.
- **Ngôn ngữ lưu bằng cookie** (`next-intl` không routing) thay vì URL `/[locale]` → không cần middleware/proxy.
- **Đo pixel chạy trên main thread** (ảnh thu về 800px, < 50ms) thay vì Web Worker — đơn giản hơn; chuyển sang Worker nếu thấy giật.
- **Auth.js dùng JWT session** (không lưu session trong DB) — bắt buộc để có nút "Đăng nhập thử" khi chạy local, nhẹ hơn cho DB free.
- **Thêm "chế độ local"**: thiếu dịch vụ nào thì dùng bản thay thế (PGlite / thư mục `.data` / AI giả lập / đăng nhập thử) → chạy & test được khi chưa có đủ tài khoản. Production thiếu biến → báo lỗi, không dùng bản giả.
- **Gemini không nhận JSON schema có min/max** (lỗi 400) → ràng buộc chuyển vào description + `postprocess.ts`.
- **Quota Gemini free rất thấp với model mới nhất**: `gemini-flash-latest` chỉ 20 request/ngày (đo 10/2026). `gemini-3.5-flash-lite` có quota riêng, nhanh hơn (~8s so với ~20s) nhưng kém chính xác (vd không nhận ra chân trời nghiêng 2.5°).
- Thêm `vercel.json` đặt function ở Singapore (`sin1`) cạnh Neon.
- Thêm phát hiện ảnh trùng (sha256) → không upload/phân tích lại, không tốn lượt.

## 1. Context

Người dùng upload 1 tấm ảnh → app đọc **toàn bộ thông tin gốc** (EXIF, XMP, IPTC, ICC, GPS, kích thước, histogram) → AI (Google Gemini) phân tích bố cục, tỉ lệ, cân bằng sáng, khẩu độ, vị trí người, HDR… → trả kết quả lên UI, **đánh dấu trực tiếp trên ảnh** chỗ cần căn chỉnh, kèm nhận xét theo giọng **“khen thật — góp ý như lời khen rồi mới chỉ ra điểm cần sửa”**.

Quyết định đã chốt với bạn:
| Hạng mục | Lựa chọn |
|---|---|
| AI | Google Gemini (Flash, free tier) |
| Lưu ảnh | Oracle Cloud OCI Object Storage (Always Free 20GB) |
| Đăng nhập | Google, có lịch sử phân tích + giới hạn lượt/ngày |
| Người dùng | Cả người mới (điện thoại) lẫn người dùng máy ảnh → chế độ Cơ bản / Nâng cao |
| Định dạng | JPEG / PNG / WebP / HEIC, ≤ 25MB (RAW để sau) |
| Ngôn ngữ | Việt + Anh |
| Chi phí | Dự án cá nhân, mục tiêu 0đ (toàn free tier) |
| Live camera | Phase 2 (có plan chi tiết bên dưới) |

## 2. Công nghệ đề xuất

| Lớp | Công nghệ | Lý do |
|---|---|---|
| Framework | **Next.js 15 (App Router) + TypeScript** | Deploy Vercel “zero-config”, API routes + UI 1 repo |
| UI | Tailwind CSS + shadcn/ui, lucide-react | Nhanh, đẹp, dễ tùy biến |
| Overlay trên ảnh | SVG layer tuyệt đối trên `<img>` (toạ độ chuẩn hoá 0–1) | Nhẹ, responsive, không cần canvas lib |
| i18n | `next-intl` (vi mặc định, en) | Hỗ trợ App Router tốt |
| Auth | **Auth.js v5** (Google provider) + Drizzle adapter | Free, session lưu DB |
| ORM / DB | **Drizzle ORM + Neon Postgres** | Neon có tích hợp Vercel Marketplace, free tier |
| Validation | Zod (validate input API + output JSON của AI) | AI có thể trả sai schema |
| Đọc metadata | **`exifr`** (EXIF, GPS, XMP, IPTC, ICC, HEIC/TIFF) chạy ở browser | Đọc từ file gốc, không tốn server |
| HEIC → JPEG | `heic2any` (lazy-load) | Trình duyệt không hiển thị HEIC |
| Phân tích pixel | Canvas API: histogram luminance + RGB, % clipping, độ sáng TB, ước lượng nhiệt màu, độ nét (Laplacian variance) | Số liệu **chính xác** để AI không “bịa” |
| AI | `@google/genai` — Gemini Flash, `responseMimeType: application/json` + `responseSchema`, model đặt qua env `GEMINI_MODEL` | Có vision + trả bounding box (`box_2d` 0–1000) |
| Storage | OCI Object Storage qua **S3 Compatibility API** (`@aws-sdk/client-s3` + `s3-request-presigner`) | Upload thẳng từ browser bằng pre-signed URL |
| Rate limit | Bảng `usage_quota` trong Postgres | Không cần thêm dịch vụ |

### Postgres free — so sánh nhanh
| Dịch vụ | Free | Ghi chú |
|---|---|---|
| **Neon** (đề xuất) | ~0.5GB, serverless, auto-suspend | Cài 1 click từ Vercel Marketplace, có branch DB cho preview |
| Supabase | ~500MB | Bị pause sau ~1 tuần không hoạt động |
| Prisma Postgres | Có free tier | Gắn với Prisma |
| Tự host trên OCI Always Free VM (ARM) | Miễn phí, dư tài nguyên | Phải tự vận hành/backup — không khuyến nghị cho MVP |

### Lưu ý ràng buộc quan trọng
- **Vercel giới hạn body request ~4.5MB** → ảnh 25MB **không được đi qua API route**; browser upload thẳng lên OCI bằng pre-signed PUT URL.
- **Vercel Hobby chỉ dùng phi thương mại** → nếu sau này thu phí phải lên Pro.
- **Gemini free tier**: có giới hạn RPM/RPD và dữ liệu có thể được Google dùng để cải thiện sản phẩm → ghi rõ trong trang Privacy; khi public nên chuyển paid tier.
- **OCI CORS** cho upload trực tiếp từ browser cần kiểm chứng sớm (xem Phase 0 – spike). Phương án dự phòng: browser resize ảnh còn ≤ 4MB rồi upload qua API route, hoặc đổi sang Cloudflare R2.

## 3. Luồng xử lý (MVP)

```
[Browser]
 1. Chọn ảnh → validate (type, ≤25MB)
 2. exifr đọc FULL metadata từ file gốc (EXIF/XMP/IPTC/ICC/GPS)
 3. Nếu HEIC → convert JPEG để hiển thị/phân tích
 4. Tạo bản "analysis preview" JPEG cạnh dài 1536px
 5. Canvas tính clientStats: histogram, clipping %, mean/median luminance,
    cast màu (R/G/B balance), độ nét, tỉ lệ khung hình
 6. POST /api/uploads  → server kiểm quota, tạo record photo, trả 2 pre-signed PUT URL
 7. PUT original + preview thẳng lên OCI
 8. POST /api/analyses {photoId, metadata, clientStats, locale, mode}
[Server – Vercel Function]
 9. Lấy preview từ OCI → gọi Gemini (ảnh + metadata + clientStats + prompt)
10. Zod validate JSON → lưu analyses → trả về
[Browser]
11. Render: điểm tổng + từng hạng mục, nhận xét, overlay đánh dấu, panel EXIF
```

## 4. Nội dung phân tích & cách hiển thị

| Hạng mục | Nguồn dữ liệu | Hiển thị trên ảnh |
|---|---|---|
| **Bố cục / canh góc** (1/3, tỉ lệ vàng, đường dẫn, khoảng thở, đường chân trời nghiêng) | Gemini (horizon line endpoints, điểm nhấn) | Lưới 1/3 & golden ratio bật/tắt; đường chân trời thực tế (đỏ) vs chuẩn (xanh) + góc lệch “nghiêng 2.3°” |
| **Tỉ lệ khung / crop** | Kích thước ảnh + Gemini đề xuất crop box | Khung crop gợi ý (nét đứt), xem trước sau crop; gợi ý 4:5 (Instagram), 3:2, 16:9… |
| **Vị trí người** (headroom, cắt ngang khớp, mắt trên đường 1/3, hướng nhìn có khoảng trống) | Gemini bounding box người/mặt | Box quanh người/mặt, mũi tên đề xuất dịch chuyển |
| **Cân bằng sáng / phơi sáng / cân bằng trắng** | clientStats (histogram, clipping) + EXIF (ExposureBias, WhiteBalance, MeteringMode) | Histogram, highlight vùng cháy sáng (đỏ) / mất chi tiết tối (xanh) |
| **Khẩu độ / tốc độ / ISO / DOF** | EXIF (FNumber, ExposureTime, ISO, FocalLength, FocalLengthIn35mm, LensModel) | Panel “Thông số”: cảnh báo rung tay (tốc độ < 1/tiêu cự), ISO cao gây nhiễu, khẩu độ vs xoá phông mong muốn, gợi ý bộ thông số thay thế |
| **HDR / dải tương phản động** | clipping 2 đầu histogram + Gemini | Gợi ý: bật HDR trên điện thoại / chụp bracketing ±2EV / chỉnh Highlights −, Shadows + (con số cụ thể) |
| **Độ nét / focus** | Laplacian variance + Gemini | Vùng nghi mất nét |

Mỗi vấn đề có **marker đánh số** trên ảnh ↔ thẻ nhận xét tương ứng (hover/click liên kết hai chiều).

Chế độ **Cơ bản** (ngôn ngữ đời thường, mẹo điện thoại) / **Nâng cao** (thuật ngữ, EV, stop, thông số máy) — tự gợi ý theo `Make/Model` trong EXIF, user có thể đổi.

### Giọng nhận xét (prompt rules)
1. **Khen thật**: mỗi lời khen phải gắn với bằng chứng cụ thể trong ảnh/số liệu; cấm khen chung chung; ảnh tệ thì khen ít nhưng vẫn thật.
2. **Góp ý kiểu “khen trước, chê sau”**: `[điểm làm được liên quan] + [nếu … thì sẽ còn tốt hơn] + [cách làm cụ thể]`.
   Ví dụ: *“Ánh sáng hoàng hôn rất ấm và có chiều sâu — nếu giảm phơi sáng khoảng −0.7EV thì bầu trời sẽ giữ lại được những sắc cam đậm đang bị cháy.”*
3. Kết thúc bằng **Top 3 việc nên làm cho lần chụp sau**.
4. Không bịa thông số: nếu EXIF thiếu thì nói “không đọc được”, không đoán.

### Output schema (Zod + Gemini responseSchema) — rút gọn
```ts
{
  overallScore: number,             // 0–100
  summary: string,
  strengths: { title, detail, evidence }[],
  improvements: {
    id, category: 'composition'|'crop'|'subject'|'exposure'|'white_balance'|'settings'|'hdr'|'focus',
    severity: 'low'|'medium'|'high',
    praiseFirst: string, suggestion: string, howTo: string,
    marker?: { x, y } , box?: [ymin,xmin,ymax,xmax]   // 0–1000
  }[],
  scores: Record<category, number>,
  horizon?: { x1,y1,x2,y2, tiltDeg },
  subjects: { label, box, faceBox? }[],
  suggestedCrop?: { box, aspectRatio, reason },
  suggestedSettings?: { aperture?, shutter?, iso?, hdr?: boolean, notes },
  nextShotTips: string[3]
}
```
Prompt lưu thành file có version (`PROMPT_VERSION`) để so sánh chất lượng giữa các phiên bản.

## 5. Data model (Drizzle)

- `users`, `accounts`, `sessions`, `verification_tokens` — chuẩn Auth.js
- `photos`: id, userId, originalKey, previewKey, mime, sizeBytes, width, height, sha256, createdAt, deletedAt
- `photo_metadata`: photoId, make, model, lensModel, fNumber, exposureTime, iso, focalLength, focalLength35, exposureBias, whiteBalance, flash, takenAt, gpsLat/Lng (chỉ lưu nếu user đồng ý), `raw jsonb` (toàn bộ exifr output), `clientStats jsonb`
- `analyses`: id, photoId, status (`pending|done|failed`), model, promptVersion, locale, mode, `result jsonb`, overallScore, latencyMs, inputTokens, outputTokens, error, createdAt
- `usage_quota`: userId, date, count (unique userId+date) — mặc định 10 ảnh/ngày

## 6. Cấu trúc thư mục dự kiến

```
src/
  app/[locale]/
    page.tsx                 # landing + upload
    analyze/[id]/page.tsx    # kết quả
    history/page.tsx         # lịch sử
    privacy/page.tsx
  app/api/
    auth/[...nextauth]/route.ts
    uploads/route.ts         # quota + pre-signed URLs
    analyses/route.ts        # gọi Gemini
    photos/[id]/route.ts     # signed GET URL, xoá ảnh
  components/
    upload/Dropzone.tsx
    result/PhotoOverlay.tsx  # SVG: grid, horizon, boxes, crop, markers
    result/ScoreCard.tsx, FeedbackList.tsx, ExifPanel.tsx, Histogram.tsx
  lib/
    exif.ts                  # exifr wrapper → normalized metadata
    image-stats.ts           # histogram, clipping, sharpness (Web Worker)
    heic.ts
    storage/oci.ts           # S3 client trỏ endpoint OCI, presign
    ai/gemini.ts, ai/prompt.ts, ai/schema.ts
    db/schema.ts, db/index.ts
    quota.ts
  messages/vi.json, en.json
drizzle/                     # migrations
```

## 7. Lộ trình

### Phase 0 — Chuẩn bị (0.5–1 ngày)
- Tạo: Vercel project, Neon DB (qua Vercel Marketplace), Google Cloud OAuth client, Gemini API key (Google AI Studio).
- OCI: tạo bucket **private**, tạo *Customer Secret Key* (cho S3 API), xác định namespace + region → endpoint `https://<namespace>.compat.objectstorage.<region>.oraclecloud.com`.
- Hướng dẫn chi tiết: `docs/PHASE0-SETUP.md`; công cụ kiểm tra: `tools/setup-check` (`npm run check`, `npm run cors`).
- **Spike**: thử pre-signed PUT từ browser lên OCI (kiểm tra CORS). Nếu không được → chọn phương án dự phòng ở mục 2.
- Env: `DATABASE_URL, AUTH_SECRET, AUTH_GOOGLE_ID/SECRET, GEMINI_API_KEY, GEMINI_MODEL, OCI_NAMESPACE, OCI_REGION, OCI_S3_ENDPOINT (tuỳ chọn), OCI_ACCESS_KEY_ID, OCI_SECRET_ACCESS_KEY, OCI_BUCKET, DAILY_QUOTA`.

### Phase 1 — MVP (≈ 2–3 tuần)
1. Khởi tạo Next.js + Tailwind + shadcn + next-intl + Drizzle + Auth.js Google.
2. Upload: Dropzone, validate, HEIC convert, exifr đọc metadata, tạo preview, image-stats trong Web Worker.
3. API uploads (quota + presign) → upload trực tiếp OCI.
4. API analyses: prompt + schema, gọi Gemini, Zod validate, retry 1 lần khi sai schema, lưu DB.
5. Trang kết quả: ScoreCard, PhotoOverlay (toggle từng layer), FeedbackList liên kết marker, ExifPanel (bảng đầy đủ + tab “raw”), Histogram, xem trước crop.
6. Lịch sử, xoá ảnh (xoá cả object trên OCI), trang Privacy, tuỳ chọn **xoá GPS** trước khi lưu.
7. Deploy Vercel, kiểm thử trên điện thoại.

### Phase 2 — Hướng dẫn trực tiếp khi chụp (Live Camera, PWA) (≈ 3–4 tuần)
Mục tiêu: mở camera trên điện thoại, app hướng dẫn **real-time trước khi bấm chụp**, chụp xong tự đưa vào luồng phân tích Phase 1.

| Tính năng | Kỹ thuật |
|---|---|
| PWA cài lên màn hình chính | `manifest.webmanifest`, service worker (Serwist), HTTPS (Vercel sẵn) |
| Mở camera sau, độ phân giải cao | `getUserMedia({ video: { facingMode: 'environment', width: {ideal: 3840} } })`; chụp bằng `ImageCapture.takePhoto()` nếu có, fallback vẽ frame lên canvas |
| Lưới bố cục overlay | SVG: 1/3, golden ratio, đường chéo, tâm — chọn được |
| **Thước cân bằng (level)** | `DeviceOrientationEvent` (beta/gamma) → hiện góc nghiêng, đổi màu xanh khi < 1°; iOS cần `DeviceOrientationEvent.requestPermission()` sau thao tác người dùng |
| **Cảnh báo sáng/tối/ngược sáng** | Mỗi ~200ms lấy frame thu nhỏ (160px) trên `OffscreenCanvas` trong Web Worker → mean luminance + % clipping → “Thiếu sáng”, “Cháy sáng vùng trời”, “Ngược sáng – bật HDR/đổi góc” |
| **Vị trí người** | MediaPipe Tasks Vision (`FaceDetector` + `PoseLandmarker` lite, WASM/GPU) chạy ~10–15 fps → kiểm tra: mắt gần đường 1/3 trên, headroom, không cắt ngang khớp (cổ tay/đầu gối/mắt cá), khoảng trống theo hướng nhìn → mũi tên “dịch máy sang trái” |
| Gợi ý tỉ lệ khung | Mask hiển thị khung 4:5 / 1:1 / 9:16 trên preview |
| Chế độ hướng dẫn theo thể loại | Chân dung / Phong cảnh / Đồ ăn / Sản phẩm — mỗi chế độ bật bộ quy tắc khác nhau |
| Sau khi chụp | Ảnh + snapshot trạng thái hướng dẫn (góc nghiêng, độ sáng) → chạy pipeline Phase 1 |
| Hiệu năng & pin | Giảm fps khi máy nóng/tab ẩn (`visibilitychange`), chỉ load model MediaPipe khi vào chế độ có người |

Giới hạn cần nói rõ với người dùng: trình duyệt **không điều khiển được khẩu độ/tốc độ/ISO thật** của camera điện thoại (chỉ một số máy Android hỗ trợ `exposureCompensation`, `torch`, `zoom` qua `MediaStreamTrack.applyConstraints`). → App hướng dẫn **cách cầm/đặt máy/ánh sáng**, còn thông số chỉ gợi ý (vd “chạm vào mặt để lấy nét, kéo thanh phơi sáng xuống”).

#### Chia nhỏ & điều chỉnh khi làm (2026-10-18)
- **2A — xong**: `/camera`, lưới (1/3, tỉ lệ vàng, chéo, tâm), khung 4:5 / 1:1 / 9:16 / 3:2 (**cắt luôn khi chụp**, không chỉ vẽ mask), thước cân bằng, cảnh báo sáng/tối, thanh bù sáng khi camera hỗ trợ `exposureCompensation`, nút "Dùng camera gốc" (`<input capture>`), manifest + icon (vẽ bằng `next/og`).
- **Không dùng Serwist/service worker**: Chrome & iOS đã cho cài PWA chỉ cần manifest; app cần mạng để phân tích nên offline không có ích. Thêm sau nếu cần push notification.
- **Đo frame trên main thread** (frame 160px, ~1ms) thay vì Web Worker — giống quyết định Phase 1.
- **Thước cân bằng tính từ véc-tơ trọng lực** (beta/gamma → góc xoay quanh trục nhìn, trừ `screen.orientation.angle`) thay vì đọc thẳng gamma — đúng cả khi cầm dọc lẫn ngang. Không chặn theo kết quả xin quyền (Chrome trả "prompt" mà vẫn gửi dữ liệu); có dữ liệu thì hiện.
- **Ảnh chụp trong app không có EXIF** → thay fact `no_exif` bằng `live_capture`, gửi kèm góc nghiêng lúc bấm chụp (`raw.capture`) → fact `capture_level` / `capture_tilt` và AI biết không được đoán thông số. `PROMPT_VERSION` = 2026-10-18.1.
- `ImageCapture.takePhoto()` chỉ dùng khi ảnh cùng hướng và lớn hơn frame video (một số máy Android trả ảnh chưa xoay); ngược lại lấy frame video.
- **2B — tiếp theo**: MediaPipe FaceDetector + PoseLandmarker (lazy-load), quy tắc vị trí người, chế độ Chân dung / Phong cảnh (bỏ Đồ ăn / Sản phẩm cho tới khi cần).
- **2C**: MediaPipe cho ảnh upload; đo chân trời bằng Hough **tự viết bằng TypeScript** trên ảnh 800px (thay OpenCV.js ~8MB).

Cũng đưa vào Phase 2:
- Bổ sung MediaPipe vào luồng **phân tích ảnh upload** để box người/mặt chính xác hơn, Gemini chỉ lo nhận xét.
- Thêm OpenCV.js (lazy-load) phát hiện đường chân trời bằng Hough transform để đo độ nghiêng chính xác.

### Phase 3+ — Hướng phát triển
- **Xem trước chỉnh sửa**: áp dụng crop + exposure/contrast/WB gợi ý ngay trên ảnh (canvas/WebGL), slider before/after, tải ảnh đã chỉnh.
- **So sánh tiến bộ**: biểu đồ điểm theo thời gian, hạng mục user hay mắc lỗi → bài học cá nhân hoá.
- **Thư viện bài học** ngắn (1/3, tam giác phơi sáng, HDR…) liên kết từ từng nhận xét.
- **RAW** (DNG/CR3/NEF/ARW): đọc EXIF bằng exifr, lấy embedded JPEG preview để phân tích.
- **Chia sẻ** kết quả bằng link công khai + ảnh thẻ tóm tắt (OG image).
- Thử thách chụp ảnh hàng tuần / cộng đồng.
- Khi có người dùng thật: Gemini paid tier, Vercel Pro, Neon paid, CDN cho ảnh, monitoring (Sentry), analytics.

## 8. Rủi ro & cách xử lý
| Rủi ro | Xử lý |
|---|---|
| OCI không cho CORS upload từ browser | Spike Phase 0; fallback resize ≤4MB qua API hoặc Cloudflare R2 |
| AI trả sai schema / bịa thông số | responseSchema + Zod + retry; truyền số liệu đo được và yêu cầu chỉ dùng chúng |
| Hết quota Gemini free | Quota/ngày/user, hàng đợi thông báo “thử lại sau”, cache theo sha256 ảnh |
| Lộ vị trí GPS | Mặc định không lưu GPS; bucket private; chỉ cấp signed GET URL ngắn hạn |
| Hàm Vercel timeout | Preview 1536px để Gemini nhanh; trạng thái `pending` + polling nếu cần |

## 9. Kiểm thử / Verification
- **Unit (Vitest)**: `exif.ts` normalize với bộ ảnh mẫu (iPhone HEIC, Android JPEG, Canon/Sony JPEG, ảnh không EXIF, PNG screenshot); `image-stats.ts` với ảnh tổng hợp (toàn đen/trắng/gradient) cho kết quả clipping đúng; Zod schema với output AI mẫu hợp lệ/hỏng.
- **Integration**: mock Gemini → `/api/analyses` lưu đúng DB; quota chặn lượt thứ 11.
- **E2E (Playwright)**: đăng nhập (mock) → upload → thấy điểm, overlay, marker liên kết thẻ nhận xét; đổi vi/en.
- **Thủ công**: bộ ~20 ảnh cố ý lỗi (nghiêng, cháy sáng, ngược sáng, cắt đầu gối, rung tay) → kiểm tra AI phát hiện đúng và giọng “khen trước chê sau”.
- **Phase 2**: test trên iPhone Safari + Android Chrome thật (quyền camera, quyền cảm biến nghiêng iOS, fps, nhiệt độ máy).
- Deploy Preview trên Vercel cho mỗi PR, Neon branch DB riêng.
