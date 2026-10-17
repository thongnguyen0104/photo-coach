import { describe, expect, it } from "vitest";
import { deriveFacts, describeFactForPrompt, dominantRegion } from "@/lib/analysis/facts";
import { horizonTilt, normalizeBox, postprocess } from "@/lib/analysis/postprocess";
import { mockAnalysis } from "@/lib/analysis/mock";
import { buildSystemInstruction, buildUserPrompt } from "@/lib/analysis/prompt";
import { aiOutputSchema, type AiOutput } from "@/lib/analysis/types";
import type { ImageStats } from "@/lib/image/stats";
import type { NormalizedMetadata } from "@/lib/image/metadata";

const baseStats: ImageStats = {
  sampleWidth: 800,
  sampleHeight: 600,
  histogram: { luma: Array(64).fill(1 / 64), r: Array(64).fill(1 / 64), g: Array(64).fill(1 / 64), b: Array(64).fill(1 / 64) },
  meanLuma: 120,
  medianLuma: 118,
  p2Luma: 10,
  p98Luma: 240,
  stdLuma: 60,
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
const ids = (meta: NormalizedMetadata, stats: Partial<ImageStats> = {}) => deriveFacts(meta, { ...baseStats, ...stats }).map((f) => f.id);

describe("deriveFacts", () => {
  it("ảnh cân bằng + nét → chỉ có nhận định tích cực", () => {
    expect(ids({ hasExif: true, deviceType: "phone" })).toEqual(["well_exposed", "sharp"]);
  });

  it("máy ảnh 1/30s ở 85mm → rủi ro rung tay mức medium", () => {
    const facts = deriveFacts({ hasExif: true, deviceType: "camera", exposureTime: 1 / 30, focalLength: 85, focalLength35: 85 }, baseStats);
    const shake = facts.find((f) => f.id === "shake_risk")!;
    expect(shake.severity).toBe("medium");
    expect(shake.values).toEqual({ shutter: "1/30", safeShutter: "1/85" });
  });

  it("điện thoại 1/2s → high; 1/30s → an toàn nhờ chống rung", () => {
    expect(deriveFacts({ hasExif: true, deviceType: "phone", exposureTime: 1 / 2 }, baseStats).find((f) => f.id === "shake_risk")?.severity).toBe("high");
    expect(ids({ hasExif: true, deviceType: "phone", exposureTime: 1 / 30 })).not.toContain("shake_risk");
  });

  it("ISO cao: ngưỡng khác nhau cho điện thoại và máy ảnh", () => {
    expect(ids({ hasExif: true, deviceType: "phone", iso: 1600 })).toContain("high_iso");
    expect(ids({ hasExif: true, deviceType: "camera", iso: 1600 })).not.toContain("high_iso");
  });

  it("cháy sáng phía trên + tối đen → gợi ý HDR, có vùng", () => {
    const grid = Array(36).fill(0).map((_, i) => (i < 12 ? 0.3 : 0));
    const facts = deriveFacts({ hasExif: false, deviceType: "unknown" }, { ...baseStats, clippedHighlights: 0.1, clippedShadows: 0.06, highlightGrid: grid });
    const hi = facts.find((f) => f.id === "highlights_clipped")!;
    expect(hi.severity).toBe("high");
    expect(hi.values.region).toBe("top");
    expect(facts.map((f) => f.id)).toEqual(expect.arrayContaining(["no_exif", "shadows_clipped", "high_dynamic_range"]));
    for (const f of facts) expect(describeFactForPrompt(f)).not.toMatch(/undefined/);
  });

  it("dominantRegion nhận ra góc trên-phải", () => {
    const grid = Array(36).fill(0);
    grid[4] = grid[5] = grid[10] = grid[11] = 1;
    expect(dominantRegion(grid)).toBe("top-right");
  });
});

describe("postprocess", () => {
  const ai: AiOutput = {
    overallScore: 72.6,
    headline: "h",
    summary: "s",
    genre: "landscape",
    scores: [{ category: "composition", score: 101 }],
    strengths: [],
    improvements: [
      { id: "Low One", category: "focus", severity: "low", title: "a", praiseFirst: "p", suggestion: "s", howTo: "h" },
      { id: "dup", category: "exposure", severity: "high", title: "b", praiseFirst: "p", suggestion: "s", howTo: "h", box: [500, 600, 100, 200] },
      { id: "dup", category: "crop", severity: "medium", title: "c", praiseFirst: "p", suggestion: "s", howTo: "h", marker: { x: 1200, y: -5 } },
    ],
    horizon: { x1: 0, y1: 500, x2: 1000, y2: 550 },
    subjects: [{ label: "người", box: [100, 100, 100, 300] }, { label: "cây", box: [100, 100, 600, 400] }],
    suggestedCrop: { box: [0, 0, 1000, 990], aspectRatio: "3:2", reason: "r" },
    nextShotTips: ["1", "2", "3"],
  };

  it("sắp theo mức độ, đánh số, id duy nhất, kẹp toạ độ", () => {
    const r = postprocess(ai, 6000, 4000);
    expect(r.overallScore).toBe(73);
    expect(r.scores[0].score).toBe(100);
    expect(r.improvements.map((i) => [i.n, i.severity])).toEqual([
      [1, "high"],
      [2, "medium"],
      [3, "low"],
    ]);
    expect(new Set(r.improvements.map((i) => i.id)).size).toBe(3);
    expect(r.improvements[0].box).toEqual([100, 200, 500, 600]);
    expect(r.improvements[1].marker).toEqual({ x: 1000, y: 0 });
    expect(r.improvements[2].id).toBe("low-one");
  });

  it("bỏ subject có box rỗng, bỏ crop gần như toàn ảnh", () => {
    const r = postprocess(ai, 6000, 4000);
    expect(r.subjects.map((s) => s.label)).toEqual(["cây"]);
    expect(r.suggestedCrop).toBeUndefined();
  });

  it("tính góc nghiêng theo tỉ lệ ảnh thật", () => {
    // Lệch 50/1000 chiều cao trên toàn bộ chiều rộng, ảnh 3:2 → atan(0.05*4000/6000)
    const expected = (Math.atan((0.05 * 4000) / 6000) * 180) / Math.PI;
    expect(postprocess(ai, 6000, 4000).horizon!.tiltDeg).toBeCloseTo(expected, 1);
    expect(horizonTilt({ x1: 1000, y1: 550, x2: 0, y2: 500 }, 6000, 4000)).toBeCloseTo(expected, 5);
  });

  it("bỏ đường chân trời quá dốc (không phải chân trời)", () => {
    expect(postprocess({ ...ai, horizon: { x1: 0, y1: 0, x2: 300, y2: 900 } }, 1000, 1000).horizon).toBeUndefined();
  });

  it("normalizeBox loại box không hợp lệ", () => {
    expect(normalizeBox([1, 2, 3])).toBeUndefined();
    expect(normalizeBox([0, 0, 2, 2])).toBeUndefined();
    expect(normalizeBox([10, 20, 500, 600])).toEqual([10, 20, 500, 600]);
  });
});

describe("mock AI + schema", () => {
  const stats = { ...baseStats, clippedHighlights: 0.1, clippedShadows: 0.08, meanLuma: 60, p98Luma: 190 };

  it.each(["vi", "en"] as const)("mockAnalysis (%s) luôn khớp schema output AI", (locale) => {
    const facts = deriveFacts({ hasExif: true, deviceType: "phone", iso: 3200, exposureTime: 0.5 }, stats);
    const out = mockAnalysis(facts, stats, locale, "advanced");
    expect(aiOutputSchema.safeParse(out).success).toBe(true);
    expect(out.improvements.length).toBeGreaterThan(3);
  });

  it("prompt chứa ngôn ngữ, chế độ và số đo", () => {
    expect(buildSystemInstruction("vi", "basic")).toMatch(/Vietnamese/);
    expect(buildSystemInstruction("en", "advanced")).toMatch(/ADVANCED/);
    const p = buildUserPrompt({ meta: { hasExif: true, deviceType: "camera", fNumber: 2.8, exposureTime: 1 / 200 }, stats, facts: [], width: 6000, height: 4000 });
    expect(p).toContain("f/2.8");
    expect(p).toContain("1/200");
    expect(p).toContain("3:2");
  });
});

describe("schema gửi Gemini", () => {
  it("không chứa ràng buộc mà Gemini từ chối (min/max → lỗi 400)", async () => {
    const { z } = await import("zod");
    const { toGeminiSchema } = await import("@/lib/analysis/gemini");
    const json = JSON.stringify(toGeminiSchema(z.toJSONSchema(aiOutputSchema)));
    for (const key of ["minimum", "maximum", "minItems", "maxItems", "additionalProperties", "$schema"]) {
      expect(json).not.toContain(`"${key}"`);
    }
  });

  it("postprocess cắt mảng quá dài và kẹp toạ độ ngoài khoảng", () => {
    const many = <T,>(n: number, f: (i: number) => T) => Array.from({ length: n }, (_, i) => f(i));
    const r = postprocess(
      {
        overallScore: 150,
        headline: "",
        summary: "",
        genre: "other",
        scores: [],
        strengths: many(9, (i) => ({ title: `${i}`, detail: "", evidence: "" })),
        improvements: many(12, (i) => ({ id: `i${i}`, category: "focus", severity: "low", title: "", praiseFirst: "", suggestion: "", howTo: "" })),
        horizon: { x1: -50, y1: 500, x2: 1300, y2: 520 },
        subjects: many(15, () => ({ label: "x", box: [0, 0, 500, 500] })),
        suggestedSettings: { notes: "", editing: many(10, (i) => `e${i}`) },
        nextShotTips: ["1", "2", "3", "4"],
      },
      1000,
      1000,
    );
    expect(r.overallScore).toBe(100);
    expect(r.strengths).toHaveLength(5);
    expect(r.improvements).toHaveLength(8);
    expect(r.subjects).toHaveLength(10);
    expect(r.suggestedSettings!.editing).toHaveLength(6);
    expect(r.nextShotTips).toHaveLength(3);
    expect(r.horizon).toMatchObject({ x1: 0, x2: 1000 });
  });
});
