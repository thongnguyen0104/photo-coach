import { expect, test } from "@playwright/test";
import { makeTestJpeg } from "../fixtures/test-photo";

/**
 * Luồng chính: đăng nhập dev → upload ảnh JPEG có EXIF → phân tích → xem kết quả
 * → đổi ngôn ngữ → lịch sử → xoá ảnh (dọn dữ liệu test).
 * Dùng dịch vụ nào là tuỳ .env.local (Gemini thật hoặc AI giả lập).
 */

const SHOTS = process.env.E2E_SCREENSHOT_DIR;

test("upload → phân tích → kết quả → lịch sử → xoá", async ({ page }, testInfo) => {
  const consoleErrors: string[] = [];
  page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
  page.on("pageerror", (e) => consoleErrors.push(e.message));
  const shot = (name: string) => SHOTS && page.screenshot({ path: `${SHOTS}/${testInfo.project.name}-${name}.png`, fullPage: true, caret: "initial" });

  // Luôn bắt đầu bằng tiếng Việt
  await page.context().addCookies([{ name: "NEXT_LOCALE", value: "vi", url: "http://localhost:3000" }]);

  // 1. Đăng nhập dev
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Chụp ảnh đẹp hơn");
  await shot("01-landing");
  await page.getByLabel("Tên hiển thị").fill(`E2E ${testInfo.project.name}`);
  await page.getByRole("button", { name: "Vào thử" }).click();
  await expect(page.getByTestId("quota")).toBeVisible();

  // 2. Chọn ảnh có EXIF + GPS
  const jpeg = await makeTestJpeg(page);
  await page.getByTestId("file-input").setInputFiles({ name: "hoang-hon.jpg", mimeType: "image/jpeg", buffer: jpeg });
  await expect(page.getByText("Canon EOS R6 · f/1.8 · 1/30 · ISO 3200 · 85mm")).toBeVisible();
  await expect(page.getByText(/1200 × 800 px · \d+ KB/)).toBeVisible();
  // Máy ảnh → gợi ý chế độ Nâng cao
  await expect(page.getByRole("radio", { name: /Nâng cao/ })).toBeChecked();
  await expect(page.getByText("Ảnh có thông tin vị trí GPS.")).toBeVisible();
  await shot("02-ready");

  // 3. Phân tích
  await page.getByRole("button", { name: "Phân tích ảnh" }).click();
  await page.waitForURL(/\/analyze\/[0-9a-f-]{36}$/, { timeout: 120_000 });

  // 4. Kết quả
  const score = Number(await page.getByTestId("overall-score").textContent());
  expect(score).toBeGreaterThanOrEqual(0);
  expect(score).toBeLessThanOrEqual(100);
  await expect(page.getByText("Điểm bạn làm tốt")).toBeVisible();
  expect(await page.getByTestId("improvement").count()).toBeGreaterThan(0);
  await expect(page.getByText("Số liệu đo được")).toBeVisible();
  // Facts đo bằng code luôn có: rung tay (1/30 ở 85mm) và ISO 3200 không cao với máy ảnh
  await expect(page.getByText(/Tốc độ 1\/30 chậm hơn mức an toàn/)).toBeVisible();

  const exif = page.getByTestId("exif-panel");
  await expect(exif).toContainText("Canon EOS R6");
  await expect(exif).toContainText("f/1.8");
  await expect(exif).toContainText("tương đương 85mm");
  await expect(exif).toContainText("Không lưu (bạn chọn ẩn vị trí)");

  // Hover marker ↔ thẻ nhận xét
  const firstMarker = page.getByTestId("marker").first();
  if (await firstMarker.isVisible()) {
    await firstMarker.hover();
    await expect(page.getByTestId("improvement").first()).toHaveClass(/ring-accent/);
  }
  // Bật lớp vùng cháy sáng
  await page.getByRole("button", { name: "Vùng cháy / tối" }).click();
  await expect(page.locator('[data-testid="photo-overlay"] canvas')).toBeVisible();
  await expect(page.getByText("Không tải được dữ liệu ảnh")).toHaveCount(0);
  await shot("03-result");

  // 5. Đổi sang tiếng Anh → giao diện đổi, có gợi ý viết lại nhận xét
  await page.getByRole("button", { name: "en", exact: true }).click();
  await expect(page.getByText("What you did well")).toBeVisible();
  await expect(page.getByRole("button", { name: "Rewrite in English" })).toBeVisible();
  await page.getByRole("button", { name: "vi", exact: true }).click();
  await expect(page.getByText("Điểm bạn làm tốt")).toBeVisible();

  // 6. Lịch sử
  const resultUrl = page.url();
  await page.goto("/history");
  await expect(page.getByTestId("history-item").first()).toBeVisible();
  await shot("04-history");

  // 7. Xoá ảnh (dọn dữ liệu test)
  await page.goto(resultUrl);
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Xoá ảnh" }).click();
  await page.waitForURL(/\/history$/);
  await page.goto(resultUrl);
  await expect(page.getByText(/404|could not be found|không tìm thấy/i).first()).toBeVisible();

  // Không có lỗi JS / hydration trên trình duyệt (bỏ qua 404 cố ý ở bước cuối)
  expect(consoleErrors.filter((e) => !/404|Not Found/i.test(e))).toEqual([]);
});

test("chưa đăng nhập không vào được trang kết quả / API", async ({ page, request }) => {
  await page.context().clearCookies();
  await page.goto("/history");
  await expect(page).toHaveURL("http://localhost:3000/");
  const res = await request.post("/api/analyses", { data: { photoId: crypto.randomUUID(), locale: "vi", mode: "basic" } });
  expect(res.status()).toBe(401);
});
