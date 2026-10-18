import { expect, test } from "@playwright/test";

/**
 * Phase 2 — chụp với hướng dẫn trực tiếp, dùng camera giả của Chromium (video mẫu 640×480).
 * Đăng nhập dev → mở camera → đổi lưới/tỉ lệ → giả lập cảm biến nghiêng → chụp → phân tích → xoá.
 */

const SHOTS = process.env.E2E_SCREENSHOT_DIR;

test.use({
  launchOptions: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] },
  permissions: ["camera"],
});

test("PWA: manifest và icon", async ({ request }) => {
  const manifest = await request.get("/manifest.webmanifest");
  expect(manifest.ok()).toBe(true);
  const json = await manifest.json();
  expect(json.display).toBe("standalone");
  for (const icon of json.icons as { src: string }[]) {
    const res = await request.get(icon.src);
    expect(res.ok(), icon.src).toBe(true);
    expect(res.headers()["content-type"]).toContain("image/png");
  }
  expect((await request.get("/apple-icon")).ok()).toBe(true);
});

test("camera trực tiếp → chụp → phân tích → xoá", async ({ page }, testInfo) => {
  const consoleErrors: string[] = [];
  page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
  page.on("pageerror", (e) => consoleErrors.push(e.message));
  const shot = (name: string) => SHOTS && page.screenshot({ path: `${SHOTS}/${testInfo.project.name}-camera-${name}.png`, caret: "initial" });

  await page.context().addCookies([{ name: "NEXT_LOCALE", value: "vi", url: "http://localhost:3000" }]);

  // 1. Đăng nhập dev → mở camera từ khung upload
  await page.goto("/");
  await page.getByLabel("Tên hiển thị").fill(`E2E camera ${testInfo.project.name}`);
  await page.getByRole("button", { name: "Vào thử" }).click();
  await page.getByTestId("open-camera").click();
  await page.waitForURL(/\/camera$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Chụp với hướng dẫn");
  await shot("01-intro");

  // 2. Bật camera
  await page.getByTestId("start-camera").click();
  await expect(page.getByTestId("camera-live")).toBeVisible();
  // Nút "N" của Next dev (chỉ có khi chạy dev) nằm đè góc dưới trái
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  await expect.poll(() => page.getByTestId("camera-video").evaluate((v: HTMLVideoElement) => v.videoWidth)).toBeGreaterThan(0);
  const video = await page.getByTestId("camera-video").evaluate((v: HTMLVideoElement) => ({ w: v.videoWidth, h: v.videoHeight }));
  expect(video.w).toBeGreaterThan(video.h); // camera giả cho video ngang

  // 3. Đổi lưới & tỉ lệ (lưu lại cho lần sau)
  await page.getByTestId("grid-toggle").click();
  await expect(page.getByTestId("grid-toggle")).toContainText("Tỉ lệ vàng");
  await page.getByTestId("aspect-toggle").click();
  await expect(page.getByTestId("aspect-toggle")).toContainText("4:5");

  // 4. Giả lập cảm biến: nghiêng 5° → hiện cảnh báo nghiêng; rồi thẳng lại → "Thẳng"
  const orient = (beta: number, gamma: number, times = 1) =>
    page.evaluate(
      ([b, g, n]) => {
        for (let i = 0; i < n; i++) window.dispatchEvent(new DeviceOrientationEvent("deviceorientation", { beta: b, gamma: g }));
      },
      [beta, gamma, times] as const,
    );
  await orient(90, 0);
  await expect(page.getByTestId("level")).toContainText("Thẳng");
  await orient(85, -90, 40);
  await expect(page.getByTestId("level")).toContainText("Nghiêng 5.0°");
  await shot("02-live");

  // 5. Chụp → sang bước phân tích với ảnh đã cắt 4:5 (video ngang → khung 5:4, giữ nguyên chiều cao)
  await page.getByTestId("shutter").click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Ảnh vừa chụp");
  await expect(page.getByText("Ảnh chụp bằng camera trong app")).toBeVisible();
  await expect(page.getByText(`${Math.round(video.h * 1.25)} × ${video.h} px`, { exact: false })).toBeVisible();
  await expect(page.getByTestId("save-capture")).toHaveAttribute("download", /^photo-coach-\d{8}-\d{6}\.jpg$/);
  await expect(page.getByRole("button", { name: "Chụp lại" })).toBeVisible();
  await shot("03-captured");

  // 6. Phân tích → kết quả có facts của ảnh chụp trong app
  await page.getByRole("button", { name: "Phân tích ảnh" }).click();
  await page.waitForURL(/\/analyze\/[0-9a-f-]{36}$/, { timeout: 120_000 });
  const resultUrl = page.url();
  await expect(page.getByText("Chụp bằng camera trong app — trình duyệt không ghi thông số máy.")).toBeVisible();
  await expect(page.getByText("Lúc bấm chụp máy nghiêng 5°.")).toBeVisible();
  await shot("04-result");

  // 7. Dọn dữ liệu test
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Xoá ảnh" }).click();
  await page.waitForURL(/\/history$/);
  await page.goto(resultUrl);
  await expect(page.getByText(/404|could not be found|không tìm thấy/i).first()).toBeVisible();

  const real = consoleErrors.filter((e) => !/404|Failed to load resource/.test(e));
  expect(real, real.join("\n")).toEqual([]);
});
