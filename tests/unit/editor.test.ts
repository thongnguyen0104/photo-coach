import { describe, expect, it } from "vitest";
import { NEUTRAL, adjustmentsFromStats, applyAdjustments, parseEditingSuggestions, suggestedAdjustments } from "@/lib/editor/adjust";
import { featherComposite, featherWidth } from "@/lib/editor/composite";
import { contextRect, coverScale, cropFromBox, cropRect, fitPixels, fullCrop, normalizeCrop, parseRatio, rotationForTilt } from "@/lib/editor/geometry";
import type { ImageStats } from "@/lib/image/stats";

const px = (...values: number[]) => new Uint8ClampedArray(values.flatMap((v) => [v, v, v, 255]));
const run = (data: Uint8ClampedArray, a: Partial<typeof NEUTRAL>) => {
  const copy = data.slice();
  applyAdjustments(copy, { ...NEUTRAL, ...a });
  return copy;
};

describe("applyAdjustments", () => {
  const ramp = px(0, 32, 64, 96, 128, 160, 192, 224, 255);

  it("giữ nguyên ảnh khi mọi thanh = 0", () => {
    expect(run(ramp, {})).toEqual(ramp);
  });

  it("phơi sáng + làm sáng, − làm tối, đen vẫn đen", () => {
    const up = run(ramp, { exposure: 50 });
    const down = run(ramp, { exposure: -50 });
    for (let i = 4; i < 32; i += 4) {
      expect(up[i]).toBeGreaterThan(ramp[i]);
      expect(down[i]).toBeLessThan(ramp[i]);
    }
    expect(up[0]).toBe(0);
  });

  it("vùng sáng / vùng tối / tương phản giữ điểm đen & trắng, đường cong luôn đồng biến", () => {
    const full = px(...Array.from({ length: 256 }, (_, i) => i));
    for (const a of [{ highlights: -100 }, { highlights: 100 }, { shadows: 100 }, { shadows: -100 }, { contrast: 100 }, { contrast: -100 }]) {
      const out = run(full, a);
      expect(out[0]).toBe(0);
      expect(out[255 * 4]).toBe(255);
      for (let i = 1; i < 256; i++) expect(out[i * 4]).toBeGreaterThanOrEqual(out[(i - 1) * 4]);
    }
  });

  it("vùng sáng âm kéo tối vùng sáng nhiều hơn vùng tối", () => {
    const out = run(px(60, 200), { highlights: -60 });
    expect(200 - out[4]).toBeGreaterThan(Math.abs(60 - out[0]));
  });

  it("nhiệt màu + ấm hơn (R tăng, B giảm); bão hoà −100 thành ảnh xám", () => {
    const grey = px(128);
    const warm = run(grey, { warmth: 80 });
    expect(warm[0]).toBeGreaterThan(warm[2]);
    const mono = run(new Uint8ClampedArray([200, 50, 50, 255]), { saturation: -100 });
    expect(mono[0]).toBe(mono[1]);
    expect(mono[1]).toBe(mono[2]);
  });

  it("không đụng tới kênh alpha", () => {
    const data = new Uint8ClampedArray([100, 100, 100, 77]);
    applyAdjustments(data, { ...NEUTRAL, exposure: 40, saturation: 20 });
    expect(data[3]).toBe(77);
  });
});

describe("parseEditingSuggestions", () => {
  it("đọc các dòng hậu kỳ tiếng Anh + tiếng Việt, kể cả dấu trừ unicode", () => {
    expect(parseEditingSuggestions(["Highlights −40", "Shadows +25", "Clarity +10", "Contrast +15"])).toEqual({
      highlights: -40,
      shadows: 25,
      contrast: 15,
    });
    expect(parseEditingSuggestions(["Giảm vùng sáng -30", "Tăng độ bão hòa +10", "Nhiệt độ màu +300K"])).toEqual({
      highlights: -30,
      saturation: 10,
      warmth: 15,
    });
  });

  it("phơi sáng theo EV đổi sang thanh trượt (±1.5 EV = ±100)", () => {
    expect(parseEditingSuggestions(["Exposure +0.3 EV"])).toEqual({ exposure: 20 });
    expect(parseEditingSuggestions(["Exposure -0,75"])).toEqual({ exposure: -50 });
    expect(parseEditingSuggestions(["Exposure +3 EV"])).toEqual({ exposure: 100 });
  });

  it("bỏ qua dòng không có số hoặc không hỗ trợ; lấy dòng đầu tiên nếu trùng", () => {
    expect(parseEditingSuggestions(["Dehaze +20", "Exposure a bit up", "Shadows +20", "Shadows +50"])).toEqual({ shadows: 20 });
    expect(parseEditingSuggestions(undefined)).toEqual({});
  });
});

describe("gợi ý từ số đo", () => {
  const base: ImageStats = {
    sampleWidth: 100,
    sampleHeight: 100,
    histogram: { luma: [], r: [], g: [], b: [] },
    meanLuma: 120,
    medianLuma: 120,
    p2Luma: 20,
    p98Luma: 230,
    stdLuma: 55,
    clippedHighlights: 0,
    clippedShadows: 0,
    highlightGrid: [],
    shadowGrid: [],
    meanRgb: [120, 120, 120],
    warmth: 0,
    tint: 0,
    saturation: 0.3,
    sharpness: 100,
    sharpnessMax: 200,
    sharpestCell: 4,
  };

  it("ảnh cân bằng → không chỉnh gì", () => {
    expect(adjustmentsFromStats(base)).toEqual({});
  });

  it("cháy sáng → giảm vùng sáng; tối → tăng phơi sáng; ám vàng → nhiệt màu lạnh hơn", () => {
    expect(adjustmentsFromStats({ ...base, clippedHighlights: 0.05 }).highlights).toBeLessThan(0);
    expect(adjustmentsFromStats({ ...base, meanLuma: 60 }).exposure).toBeGreaterThan(0);
    expect(adjustmentsFromStats({ ...base, warmth: 0.3 }).warmth).toBeLessThan(0);
  });

  it("AI ưu tiên hơn số đo", () => {
    const result = { improvements: [], suggestedSettings: { editing: ["Highlights -10"], notes: "" } } as never;
    expect(suggestedAdjustments(result, { ...base, clippedHighlights: 0.05, meanLuma: 60 })).toMatchObject({ highlights: -10, exposure: expect.any(Number) });
  });

  it("chỉ sửa ám màu khi AI chê cân bằng trắng (hoàng hôn vàng là cố ý)", () => {
    const warm = { ...base, warmth: 0.4 };
    expect(suggestedAdjustments({ improvements: [] } as never, warm).warmth).toBe(0);
    expect(suggestedAdjustments({ improvements: [{ category: "white_balance" }] } as never, warm).warmth).toBeLessThan(0);
    expect(suggestedAdjustments(null, warm).warmth).toBeLessThan(0);
  });
});

describe("featherComposite", () => {
  it("ngoài vùng xoá giữ ảnh cũ, sâu trong vùng xoá là ảnh mới, mép chuyển dần", () => {
    const w = 21;
    const h = 1;
    const before = new Uint8ClampedArray(w * 4).fill(0);
    const after = new Uint8ClampedArray(w * 4).fill(200);
    const mask = new Uint8Array(w).fill(255);
    for (let x = 3; x < 18; x++) mask[x] = 0; // vùng xoá x = 3…17
    featherComposite(before, after, mask, w, h, 4);
    const r = (x: number) => after[x * 4];
    expect(r(0)).toBe(0);
    expect(r(20)).toBe(0);
    expect(r(10)).toBe(200);
    expect(r(3)).toBeGreaterThan(0);
    expect(r(3)).toBeLessThan(r(4));
    expect(r(4)).toBeLessThan(r(10));
  });

  it("độ rộng mép theo kích thước vùng xoá, trong khoảng 2–12px", () => {
    expect(featherWidth(10, 10)).toBe(2);
    expect(featherWidth(144, 560)).toBe(9);
    expect(featherWidth(2000, 2000)).toBe(12);
  });
});

describe("geometry", () => {
  const W = 4000;
  const H = 3000;

  it("parseRatio", () => {
    expect(parseRatio("4:5")).toBe(0.8);
    expect(parseRatio("16 / 9")).toBeCloseTo(16 / 9);
    expect(parseRatio("abc")).toBeNull();
  });

  it("khung gốc = cả ảnh; khung 1:1 trên ảnh ngang lấy hết chiều cao", () => {
    expect(cropRect(fullCrop(W, H), W, H)).toEqual({ x: 0, y: 0, w: 1, h: 1 });
    const sq = cropRect({ ratio: 1, size: 1, cx: 0.5, cy: 0.5, preset: "1:1" }, W, H);
    expect(sq.h).toBe(1);
    expect(sq.w * W).toBeCloseTo(H);
  });

  it("kéo khung ra ngoài thì bị kẹp trong ảnh", () => {
    const c = normalizeCrop({ ratio: 1, size: 0.5, cx: 2, cy: -1, preset: "1:1" }, W, H);
    const r = cropRect(c, W, H);
    expect(r.x + r.w).toBeCloseTo(1);
    expect(r.y).toBe(0);
  });

  it("khung AI gợi ý được dựng lại đúng vị trí", () => {
    const c = cropFromBox([100, 200, 900, 800], W, H);
    const r = cropRect(c, W, H);
    expect(r.x).toBeCloseTo(0.2);
    expect(r.y).toBeCloseTo(0.1);
    expect(r.w).toBeCloseTo(0.6);
    expect(r.h).toBeCloseTo(0.8);
  });

  it("xoay: hệ số phóng ≥ 1, = 1 khi không xoay; chân trời nghiêng phải → xoay ngược chiều", () => {
    expect(coverScale(W, H, 0)).toBe(1);
    expect(coverScale(W, H, 5)).toBeGreaterThan(1);
    expect(rotationForTilt(2.5)).toBe(-2.5);
    expect(rotationForTilt(0.1)).toBe(0);
    expect(rotationForTilt(undefined)).toBe(0);
    expect(rotationForTilt(-40)).toBe(15);
  });

  it("thu nhỏ ảnh quá 16.7MP", () => {
    expect(fitPixels(4000, 3000, 4096 * 4096)).toEqual({ width: 4000, height: 3000, scale: 1 });
    const big = fitPixels(8064, 6048, 4096 * 4096);
    expect(big.width * big.height).toBeLessThanOrEqual(4096 * 4096);
    expect(big.width / big.height).toBeCloseTo(8064 / 6048, 2);
  });

  it("vùng đưa cho model bao trọn vùng tô và nằm trong ảnh", () => {
    const mask = { x: 3900, y: 50, w: 80, h: 60 };
    const r = contextRect(mask, W, H);
    expect(r.x).toBeLessThanOrEqual(mask.x);
    expect(r.y).toBeLessThanOrEqual(mask.y);
    expect(r.x + r.w).toBeLessThanOrEqual(W);
    expect(r.x + r.w).toBeGreaterThanOrEqual(mask.x + mask.w);
    expect(r.w).toBeGreaterThanOrEqual(256);
  });
});
