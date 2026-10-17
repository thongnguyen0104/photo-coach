import type { Page } from "@playwright/test";
import { buildExifApp1, injectExif } from "./exif-jpeg";

/** Vẽ một "phong cảnh" bằng canvas trong trình duyệt: trời cháy sáng, đường chân trời nghiêng, 1 người. */
export async function makeTestJpeg(page: Page): Promise<Buffer> {
  const base64 = await page.evaluate(async () => {
    const c = document.createElement("canvas");
    c.width = 1200;
    c.height = 800;
    const g = c.getContext("2d")!;
    const sky = g.createLinearGradient(0, 0, 0, 420);
    sky.addColorStop(0, "#ffffff");
    sky.addColorStop(0.5, "#fff3c4");
    sky.addColorStop(1, "#f59e0b");
    g.fillStyle = sky;
    g.fillRect(0, 0, 1200, 800);
    // Mặt đất với đường chân trời hơi nghiêng
    g.fillStyle = "#1f3b2d";
    g.beginPath();
    g.moveTo(0, 400);
    g.lineTo(1200, 450);
    g.lineTo(1200, 800);
    g.lineTo(0, 800);
    g.fill();
    // Người đứng giữa khung
    g.fillStyle = "#111";
    g.beginPath();
    g.arc(600, 330, 38, 0, Math.PI * 2);
    g.fill();
    g.fillRect(560, 370, 80, 220);
    g.fillRect(565, 590, 30, 150);
    g.fillRect(605, 590, 30, 150);
    const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), "image/jpeg", 0.9));
    const buf = new Uint8Array(await blob.arrayBuffer());
    let s = "";
    for (const byte of buf) s += String.fromCharCode(byte);
    return btoa(s);
  });
  const exif = buildExifApp1({
    make: "Canon",
    model: "Canon EOS R6",
    exposureTime: [1, 30],
    fNumber: [18, 10],
    iso: 3200,
    focalLength: [85, 1],
    focalLength35: 85,
    dateTimeOriginal: "2025:06:01 18:30:00",
    gps: { lat: 10.7769, lng: 106.7009 },
  });
  return injectExif(Buffer.from(base64, "base64"), exif);
}
