import { describe, expect, it } from "vitest";
import { computeImageStats, nearestAspectRatio } from "@/lib/image/stats";

function image(w: number, h: number, pixel: (x: number, y: number) => [number, number, number]) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const [r, g, b] = pixel(x, y);
      data.set([r, g, b, 255], (y * w + x) * 4);
    }
  return data;
}

describe("computeImageStats", () => {
  it("ảnh đen hoàn toàn → 100% mất chi tiết tối", () => {
    const s = computeImageStats(image(40, 30, () => [0, 0, 0]), 40, 30);
    expect(s.meanLuma).toBe(0);
    expect(s.clippedShadows).toBe(1);
    expect(s.clippedHighlights).toBe(0);
    expect(s.histogram.luma[0]).toBe(1);
  });

  it("ảnh trắng hoàn toàn → 100% cháy sáng", () => {
    const s = computeImageStats(image(40, 30, () => [255, 255, 255]), 40, 30);
    expect(s.clippedHighlights).toBe(1);
    expect(s.p2Luma).toBe(255);
    expect(s.highlightGrid.every((v) => v === 1)).toBe(true);
  });

  it("gradient ngang → trung vị ở giữa, histogram trải đều", () => {
    const s = computeImageStats(image(256, 10, (x) => [x, x, x]), 256, 10);
    expect(s.medianLuma).toBeGreaterThanOrEqual(126);
    expect(s.medianLuma).toBeLessThanOrEqual(129);
    expect(s.histogram.luma.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 3);
    expect(Math.max(...s.histogram.luma)).toBeLessThan(0.03);
  });

  it("chỉ nửa trên cháy sáng → lưới đánh dấu đúng vùng", () => {
    const s = computeImageStats(image(60, 60, (_, y) => (y < 30 ? [255, 255, 255] : [100, 100, 100])), 60, 60);
    expect(s.clippedHighlights).toBeCloseTo(0.5, 2);
    expect(s.highlightGrid.slice(0, 6).every((v) => v === 1)).toBe(true);
    expect(s.highlightGrid.slice(30).every((v) => v === 0)).toBe(true);
  });

  it("tông cam → warmth dương, tông xanh → warmth âm", () => {
    expect(computeImageStats(image(20, 20, () => [200, 140, 80]), 20, 20).warmth).toBeGreaterThan(0.3);
    expect(computeImageStats(image(20, 20, () => [80, 120, 200]), 20, 20).warmth).toBeLessThan(-0.3);
  });

  it("ảnh caro sắc nét có sharpness cao hơn hẳn ảnh phẳng", () => {
    const sharp = computeImageStats(image(64, 64, (x, y) => ((x + y) % 2 ? [255, 255, 255] : [0, 0, 0])), 64, 64);
    const flat = computeImageStats(image(64, 64, () => [128, 128, 128]), 64, 64);
    expect(sharp.sharpnessMax).toBeGreaterThan(1000);
    expect(flat.sharpnessMax).toBe(0);
  });
});

describe("nearestAspectRatio", () => {
  it.each([
    [6000, 4000, "3:2"],
    [4032, 3024, "4:3"],
    [1080, 1350, "4:5"],
    [1920, 1080, "16:9"],
    [1000, 1000, "1:1"],
    [3000, 1000, "3.00:1"],
  ])("%i×%i → %s", (w, h, expected) => {
    expect(nearestAspectRatio(w, h)).toBe(expected);
  });
});
