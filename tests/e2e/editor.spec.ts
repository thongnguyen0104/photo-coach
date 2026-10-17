import fs from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { makeTestJpeg } from "../fixtures/test-photo";

/**
 * Trình chỉnh sửa: mở từ trang kết quả → (nếu bật ENABLE_OBJECT_REMOVAL) tải model, tô xoá người trong ảnh
 * → áp dụng gợi ý AI → tải ảnh về (kiểm tra đúng kích thước) → xoá ảnh test.
 * Lần đầu chạy sẽ tải model ~28MB từ Hugging Face.
 */

const SHOTS = process.env.E2E_SCREENSHOT_DIR;

/** Kích thước ảnh JPEG đọc từ marker SOF. */
function jpegSize(buf: Buffer) {
  let i = 2;
  while (i < buf.length) {
    const marker = buf[i + 1];
    const len = buf.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xc3) return { w: buf.readUInt16BE(i + 7), h: buf.readUInt16BE(i + 5) };
    i += 2 + len;
  }
  throw new Error("not a JPEG");
}

/** Độ sáng trung bình 1 vùng nhỏ trên canvas xem trước (toạ độ 0–1). */
async function canvasLuma(page: Page, x: number, y: number) {
  return page.getByTestId("editor-canvas").evaluate(
    (c: HTMLCanvasElement, [x, y]) => {
      const d = c.getContext("2d")!.getImageData(Math.round(x * c.width) - 4, Math.round(y * c.height) - 4, 8, 8).data;
      let sum = 0;
      for (let i = 0; i < d.length; i += 4) sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      return sum / (d.length / 4);
    },
    [x, y],
  );
}

/** Tải model (lần đầu) → tô lên người trong ảnh → kiểm tra đã xoá, hoàn tác, làm lại. */
async function removePerson(page: Page) {
  const download = page.getByRole("button", { name: "Tải model AI" });
  if (await download.isVisible()) await download.click();
  await expect(page.getByTestId("model-ready")).toBeVisible({ timeout: 180_000 });
  await page.getByLabel("Cỡ cọ").fill("12");

  // Điện thoại: ảnh và thanh cọ cách xa nhau → cuộn ảnh vào giữa màn hình (tránh thanh menu dính ở trên che mất)
  await page.getByTestId("editor-mask").evaluate((el) => el.scrollIntoView({ block: "center" }));
  const box = (await page.getByTestId("editor-mask").boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.36);
  await page.mouse.down();
  for (let i = 1; i <= 20; i++) await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * (0.36 + (0.58 * i) / 20));
  await page.mouse.up();

  const undo = page.getByRole("button", { name: /Hoàn tác/ });
  await expect(undo).toBeEnabled({ timeout: 60_000 });
  // Thân người đã bị xoá → vùng đó giờ là nền (đất xanh đậm / trời), sáng hơn hẳn màu đen
  expect(await canvasLuma(page, 0.5, 0.6)).toBeGreaterThan(30);
  expect(await canvasLuma(page, 0.5, 0.42)).toBeGreaterThan(60);

  // Hoàn tác → người hiện lại; làm lại → biến mất
  await undo.click();
  await expect.poll(() => canvasLuma(page, 0.5, 0.6)).toBeLessThan(40);
  await page.getByRole("button", { name: /Làm lại/ }).click();
  await expect.poll(() => canvasLuma(page, 0.5, 0.6)).toBeGreaterThan(30);
}

test("chỉnh sửa: xoá vật thể → gợi ý AI → tải ảnh về", async ({ page }, testInfo) => {
  test.setTimeout(300_000);
  const consoleErrors: string[] = [];
  page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
  page.on("pageerror", (e) => consoleErrors.push(e.message));
  // Xác nhận "xoá ảnh" + cảnh báo rời trang khi chưa tải ảnh đã chỉnh
  page.on("dialog", (d) => d.accept());
  const shot = (name: string) => SHOTS && page.screenshot({ path: `${SHOTS}/${testInfo.project.name}-editor-${name}.png`, fullPage: true });

  await page.context().addCookies([{ name: "NEXT_LOCALE", value: "vi", url: "http://localhost:3000" }]);
  await page.goto("/");
  await page.getByLabel("Tên hiển thị").fill(`E2E editor ${testInfo.project.name}`);
  await page.getByRole("button", { name: "Vào thử" }).click();
  await expect(page.getByTestId("quota")).toBeVisible();

  const jpeg = await makeTestJpeg(page);
  await page.getByTestId("file-input").setInputFiles({ name: "hoang-hon.jpg", mimeType: "image/jpeg", buffer: jpeg });
  await page.getByRole("button", { name: "Phân tích ảnh" }).click();
  await page.waitForURL(/\/analyze\/[0-9a-f-]{36}$/, { timeout: 120_000 });
  const resultUrl = page.url();

  // 1. Mở trình chỉnh sửa
  await page.getByRole("link", { name: "Chỉnh sửa ảnh" }).click();
  await page.waitForURL(/\/edit$/);
  await expect(page.getByRole("heading", { name: "Chỉnh sửa ảnh" })).toBeVisible();
  await expect(page.getByTestId("output-size")).toContainText("1200 × 800 px", { timeout: 30_000 });
  // Người đứng giữa ảnh: thân màu gần đen
  expect(await canvasLuma(page, 0.5, 0.6)).toBeLessThan(40);

  // 2. Xoá vật thể — chỉ khi server bật ENABLE_OBJECT_REMOVAL (mặc định tắt → tab bị ẩn)
  const removeTab = page.getByRole("tab", { name: "Xoá vật thể" });
  if (await removeTab.count()) {
    await removePerson(page);
    await shot("01-removed");
  } else {
    await expect(page.getByRole("tab")).toHaveCount(2);
    await expect(page.getByRole("tab", { name: "Cắt & xoay" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("editor-mask")).toHaveCount(0);
  }

  // 3. Áp dụng gợi ý AI → chuyển sang tab Màu & sáng, có danh sách đã áp dụng
  await page.getByRole("button", { name: "Áp dụng gợi ý AI" }).click();
  await expect(page.getByRole("tab", { name: "Màu & sáng" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("ai-applied").or(page.getByText("không cần chỉnh thêm"))).toBeVisible();
  await shot("02-ai");

  // 4. Cắt 1:1 → ảnh tải về vuông 800 × 800
  await page.getByRole("tab", { name: "Cắt & xoay" }).click();
  await page.getByRole("button", { name: "1:1", exact: true }).click();
  await expect(page.getByTestId("crop-box")).toBeVisible();
  await expect(page.getByTestId("output-size")).toContainText("800 × 800 px");
  await shot("03-crop");

  const [file] = await Promise.all([page.waitForEvent("download"), page.getByTestId("editor-download").click()]);
  expect(file.suggestedFilename()).toBe("hoang-hon-edited.jpg");
  const buf = await fs.readFile((await file.path())!);
  expect(jpegSize(buf)).toEqual({ w: 800, h: 800 });

  // 5. Dọn dữ liệu test
  await page.goto(resultUrl);
  await page.getByRole("button", { name: "Xoá ảnh" }).click();
  await page.waitForURL(/\/history$/);

  expect(consoleErrors).toEqual([]);
});
