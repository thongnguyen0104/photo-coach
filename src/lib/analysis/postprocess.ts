import type { AiOutput, AnalysisResult, Box, Improvement, Severity } from "./types";

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Chuẩn hoá box [ymin,xmin,ymax,xmax]: kẹp 0–1000, đảo nếu ngược, bỏ nếu quá nhỏ. */
export function normalizeBox(box: number[] | undefined, minSize = 5): Box | undefined {
  if (!box || box.length !== 4 || box.some((v) => !Number.isFinite(v))) return undefined;
  let [y1, x1, y2, x2] = box.map((v) => clamp(Math.round(v), 0, 1000));
  if (y1 > y2) [y1, y2] = [y2, y1];
  if (x1 > x2) [x1, x2] = [x2, x1];
  if (y2 - y1 < minSize || x2 - x1 < minSize) return undefined;
  return [y1, x1, y2, x2];
}

/**
 * Góc nghiêng (độ) của đường chân trời theo kích thước ảnh thật.
 * Dương = phía phải thấp hơn (cần xoay ngược chiều kim đồng hồ để thẳng).
 */
export function horizonTilt(h: { x1: number; y1: number; x2: number; y2: number }, width: number, height: number): number {
  let { x1, y1, x2, y2 } = h;
  if (x1 > x2) [x1, y1, x2, y2] = [x2, y2, x1, y1];
  const dx = ((x2 - x1) / 1000) * width;
  const dy = ((y2 - y1) / 1000) * height;
  return (Math.atan2(dy, dx) * 180) / Math.PI;
}

const SEVERITY_ORDER: Record<Severity, number> = { high: 0, medium: 1, low: 2 };

const LIMITS = { strengths: 5, improvements: 8, subjects: 10, editing: 6, tips: 3 };

/** Kẹp mọi giá trị về khoảng hợp lệ và cắt độ dài mảng (schema gửi Gemini không có ràng buộc min/max). */
export function postprocess(ai: AiOutput, width: number, height: number): AnalysisResult {
  const seen = new Set<string>();
  const improvements: Improvement[] = [...ai.improvements]
    .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])
    .slice(0, LIMITS.improvements)
    .map((imp, i) => {
      let id = (imp.id || `issue-${i + 1}`).toLowerCase().replace(/[^a-z0-9-]+/g, "-");
      while (seen.has(id)) id = `${id}-${i + 1}`;
      seen.add(id);
      return {
        ...imp,
        id,
        n: i + 1,
        marker: imp.marker ? { x: clamp(Math.round(imp.marker.x), 0, 1000), y: clamp(Math.round(imp.marker.y), 0, 1000) } : undefined,
        box: normalizeBox(imp.box),
      };
    });

  let horizon: AnalysisResult["horizon"];
  const h = ai.horizon && {
    x1: clamp(ai.horizon.x1, 0, 1000),
    y1: clamp(ai.horizon.y1, 0, 1000),
    x2: clamp(ai.horizon.x2, 0, 1000),
    y2: clamp(ai.horizon.y2, 0, 1000),
  };
  if (h && Math.abs(h.x2 - h.x1) >= 200) {
    const tiltDeg = Math.round(horizonTilt(h, width, height) * 10) / 10;
    // > 20° thì gần như chắc không phải đường chân trời
    if (Math.abs(tiltDeg) <= 20) horizon = { ...h, tiltDeg };
  }

  let suggestedCrop: AnalysisResult["suggestedCrop"];
  const cropBox = normalizeBox(ai.suggestedCrop?.box, 100);
  if (ai.suggestedCrop && cropBox) {
    const area = ((cropBox[2] - cropBox[0]) * (cropBox[3] - cropBox[1])) / 1e6;
    // Crop gần như toàn ảnh (>97%) thì vô nghĩa
    if (area <= 0.97) suggestedCrop = { ...ai.suggestedCrop, box: cropBox };
  }

  return {
    ...ai,
    overallScore: clamp(Math.round(ai.overallScore), 0, 100),
    scores: ai.scores.map((s) => ({ ...s, score: clamp(Math.round(s.score), 0, 100) })),
    strengths: ai.strengths.slice(0, LIMITS.strengths),
    improvements,
    horizon,
    subjects: ai.subjects
      .map((s) => ({ label: s.label, box: normalizeBox(s.box), faceBox: normalizeBox(s.faceBox) }))
      .filter((s): s is { label: string; box: Box; faceBox: Box | undefined } => !!s.box)
      .slice(0, LIMITS.subjects),
    suggestedCrop,
    suggestedSettings: ai.suggestedSettings && {
      ...ai.suggestedSettings,
      editing: ai.suggestedSettings.editing?.slice(0, LIMITS.editing),
    },
    nextShotTips: ai.nextShotTips.slice(0, LIMITS.tips),
  };
}
