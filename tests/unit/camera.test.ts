import { describe, expect, it } from "vitest";
import { levelFromOrientation, smoothAngle, wrap45 } from "@/lib/camera/level";
import { exposureHints, HintStabilizer } from "@/lib/camera/exposure";
import { aspectRect, gridLines } from "@/lib/camera/frame";
import { deriveFacts, describeFactForPrompt } from "@/lib/analysis/facts";
import { normalizeMetadata } from "@/lib/image/metadata";
import type { ImageStats } from "@/lib/image/stats";

const stats: ImageStats = {
  sampleWidth: 160,
  sampleHeight: 90,
  histogram: { luma: Array(64).fill(1 / 64), r: Array(64).fill(1 / 64), g: Array(64).fill(1 / 64), b: Array(64).fill(1 / 64) },
  meanLuma: 120,
  medianLuma: 118,
  p2Luma: 15,
  p98Luma: 235,
  stdLuma: 55,
  clippedHighlights: 0,
  clippedShadows: 0,
  highlightGrid: Array(36).fill(0),
  shadowGrid: Array(36).fill(0),
  meanRgb: [120, 120, 120],
  warmth: 0,
  tint: 0,
  saturation: 0.3,
  sharpness: 120,
  sharpnessMax: 300,
  sharpestCell: 4,
};

/** Lưới 6×6 có giá trị ở các hàng chỉ định */
const gridRows = (rows: number[], v = 0.5) => Array.from({ length: 36 }, (_, i) => (rows.includes(Math.floor(i / 6)) ? v : 0));

describe("thước cân bằng", () => {
  it("điện thoại dựng đứng, thẳng → 0°", () => {
    const r = levelFromOrientation(90, 0);
    expect(r.flat).toBe(false);
    expect(Math.abs(r.tiltDeg)).toBe(0);
  });

  it("dựng đứng nghiêng sang một bên → đúng góc nghiêng, dấu theo hướng xoay", () => {
    // Máy đứng (beta 90) xoay quanh trục nhìn: gamma không đổi được ở beta=90 → mô phỏng bằng beta 80, gamma ±
    const left = levelFromOrientation(80, -10);
    const right = levelFromOrientation(80, 10);
    expect(left.tiltDeg).toBeGreaterThan(0);
    expect(right.tiltDeg).toBeLessThan(0);
    expect(left.tiltDeg).toBeCloseTo(-right.tiltDeg, 5);
  });

  it("nghiêng đúng 5° quanh trục nhìn khi dựng đứng", () => {
    // Véc-tơ lên u = (sin5°, cos5°, 0) ⇒ beta = asin(cos5°) , gamma = -90°?? → dùng cặp tương đương:
    // beta 85°, gamma −90° cho u = (cos85°, sin85°, 0) ⇒ roll = atan2(cos85, sin85) = 5°
    const r = levelFromOrientation(85, -90);
    expect(r.tiltDeg).toBeCloseTo(5, 1);
  });

  it("cầm ngang (màn hình xoay 90°) → trừ góc màn hình", () => {
    // Máy nằm ngang, cạnh phải hướng lên: u ≈ (1, 0, 0) ⇒ beta 0, gamma −90
    const r = levelFromOrientation(0, -90, 90);
    expect(r.flat).toBe(false);
    expect(Math.abs(r.tiltDeg)).toBeLessThan(0.1);
  });

  it("đặt nằm ngang (chụp từ trên xuống) → flat", () => {
    expect(levelFromOrientation(3, 2).flat).toBe(true);
  });

  it("wrap45 đưa góc về khoảng gần đường chuẩn nhất", () => {
    expect(wrap45(92)).toBe(2);
    expect(wrap45(-88)).toBe(2);
    expect(wrap45(178)).toBe(-2);
    expect(wrap45(-3)).toBe(-3);
  });

  it("smoothAngle làm mượt nhưng nhảy ngay khi thay đổi lớn", () => {
    expect(smoothAngle(null, 4)).toBe(4);
    expect(smoothAngle(0, 4, 0.25)).toBe(1);
    expect(smoothAngle(0, 30)).toBe(30);
  });
});

describe("cảnh báo sáng/tối", () => {
  it("ảnh cân bằng → không cảnh báo", () => {
    expect(exposureHints(stats)).toEqual([]);
  });

  it("tối → too_dark", () => {
    expect(exposureHints({ ...stats, meanLuma: 30, p98Luma: 110 })).toEqual(["too_dark"]);
  });

  it("trời cháy sáng ở phía trên → sky_clipped", () => {
    expect(exposureHints({ ...stats, clippedHighlights: 0.12, highlightGrid: gridRows([0, 1]) })).toEqual(["sky_clipped"]);
  });

  it("cháy sáng ở phía dưới → highlights_clipped", () => {
    expect(exposureHints({ ...stats, clippedHighlights: 0.12, highlightGrid: gridRows([4, 5]) })).toEqual(["highlights_clipped"]);
  });

  it("vừa cháy sáng vừa mất chi tiết tối → backlit đứng đầu, không kèm too_bright", () => {
    const h = exposureHints({ ...stats, meanLuma: 205, clippedHighlights: 0.3, clippedShadows: 0.15, highlightGrid: gridRows([0]) });
    expect(h[0]).toBe("backlit");
    expect(h).not.toContain("too_bright");
  });

  it("quá sáng → too_bright", () => {
    expect(exposureHints({ ...stats, meanLuma: 215 })).toEqual(["too_bright"]);
  });

  it("HintStabilizer chỉ hiện khi lặp lại đủ số frame", () => {
    const s = new HintStabilizer(5, 3);
    expect(s.push(["too_dark"])).toEqual([]);
    expect(s.push(["too_dark"])).toEqual([]);
    expect(s.push(["too_dark"])).toEqual(["too_dark"]);
    // 1 frame lẻ không làm mất cảnh báo
    expect(s.push([])).toEqual(["too_dark"]);
    expect(s.push([])).toEqual(["too_dark"]);
    expect(s.push([])).toEqual([]);
  });
});

describe("khung & tỉ lệ", () => {
  it("full → toàn khung", () => {
    expect(aspectRect(1920, 1080, "full")).toEqual({ x: 0, y: 0, w: 1920, h: 1080 });
  });

  it("khung dọc 4:5 trong video dọc 1080×1920", () => {
    expect(aspectRect(1080, 1920, "4:5")).toEqual({ x: 0, y: 285, w: 1080, h: 1350 });
  });

  it("khung ngang: 4:5 thành 5:4, đặt giữa", () => {
    const r = aspectRect(1920, 1080, "4:5");
    expect(r.h).toBe(1080);
    expect(r.w).toBe(1350);
    expect(r.x).toBe(285);
  });

  it("1:1 lấy cạnh ngắn", () => {
    expect(aspectRect(1920, 1080, "1:1")).toEqual({ x: 420, y: 0, w: 1080, h: 1080 });
  });

  it("lưới 1/3 có 4 đường, tắt lưới không có đường nào", () => {
    expect(gridLines("thirds")).toHaveLength(4);
    expect(gridLines("none")).toHaveLength(0);
  });
});

describe("ảnh chụp bằng camera trong app", () => {
  it("normalizeMetadata đọc raw.capture, điện thoại → deviceType phone", () => {
    const m = normalizeMetadata({ capture: { source: "live-camera", tiltDeg: 2.34, aspect: "4:5", mobile: true } });
    expect(m.hasExif).toBe(false);
    expect(m.deviceType).toBe("phone");
    expect(m.capture).toEqual({ source: "live-camera", tiltDeg: 2.3, aspect: "4:5", mobile: true });
  });

  it("bỏ qua dữ liệu capture không hợp lệ", () => {
    expect(normalizeMetadata({ capture: { source: "other" } }).capture).toBeUndefined();
    expect(normalizeMetadata({ capture: { source: "live-camera", tiltDeg: 400 } }).capture?.tiltDeg).toBeUndefined();
  });

  it("facts: live_capture thay cho no_exif, kèm góc nghiêng lúc chụp", () => {
    const tilted = deriveFacts(normalizeMetadata({ capture: { source: "live-camera", tiltDeg: -3.5, mobile: true } }), stats);
    const ids = tilted.map((f) => f.id);
    expect(ids).toContain("live_capture");
    expect(ids).not.toContain("no_exif");
    const tilt = tilted.find((f) => f.id === "capture_tilt")!;
    expect(tilt.values.tilt).toBe(3.5);
    expect(tilt.severity).toBe("medium");
    expect(describeFactForPrompt(tilt)).toContain("3.5°");

    const level = deriveFacts(normalizeMetadata({ capture: { source: "live-camera", tiltDeg: 0.4 } }), stats);
    expect(level.find((f) => f.id === "capture_level")?.severity).toBe("positive");
  });
});
