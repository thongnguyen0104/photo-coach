import type { AnalysisResult } from "@/lib/analysis/types";
import type { ImageStats } from "@/lib/image/stats";

/** Các thanh chỉnh màu & sáng, mỗi thanh −100…100 (0 = giữ nguyên). */
export interface Adjustments {
  exposure: number;
  contrast: number;
  highlights: number;
  shadows: number;
  saturation: number;
  warmth: number;
}

export const ADJUSTMENT_KEYS = ["exposure", "contrast", "highlights", "shadows", "saturation", "warmth"] as const;

export const NEUTRAL: Adjustments = { exposure: 0, contrast: 0, highlights: 0, shadows: 0, saturation: 0, warmth: 0 };

/** Thanh phơi sáng ±100 tương ứng ±1.5 EV. */
export const EXPOSURE_EV_RANGE = 1.5;

export const isNeutral = (a: Adjustments) => ADJUSTMENT_KEYS.every((k) => a[k] === 0);

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const clampSlider = (v: number) => Math.round(clamp(v, -100, 100));

const SRGB_TO_LINEAR = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  SRGB_TO_LINEAR[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

const OUT_STEPS = 4096;

/**
 * Đường cong tông (áp dụng sau khi về sRGB). Các hàm trọng số giữ nguyên điểm đen (0) và trắng (1)
 * → vùng đã cháy sáng vẫn trắng, không bị xám đục. Hệ số được chọn để đường cong luôn đồng biến.
 */
function toneCurve(x: number, a: Adjustments): number {
  // Tương phản: đường cong chữ S quanh 0.5
  x += 0.25 * (a.contrast / 100) * 4 * x * (1 - x) * (2 * x - 1);
  // Vùng tối: đỉnh ảnh hưởng ở ~1/3
  const sh = a.shadows / 100;
  x += (sh > 0 ? 0.35 : 0.14) * sh * 6.75 * x * (1 - x) ** 2;
  // Vùng sáng: đỉnh ảnh hưởng ở ~2/3
  const hl = a.highlights / 100;
  x += (hl < 0 ? 0.35 : 0.14) * hl * 6.75 * x * x * (1 - x);
  return clamp(x, 0, 1);
}

/** Bảng tra: giá trị tuyến tính (0…1, chia OUT_STEPS bậc) → sRGB 0…255 đã qua đường cong tông. */
function buildOutputLut(a: Adjustments): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(OUT_STEPS + 1);
  for (let i = 0; i <= OUT_STEPS; i++) {
    const lin = i / OUT_STEPS;
    const s = lin <= 0.0031308 ? lin * 12.92 : 1.055 * lin ** (1 / 2.4) - 0.055;
    lut[i] = Math.round(toneCurve(s, a) * 255);
  }
  return lut;
}

/** Áp dụng chỉnh màu & sáng trực tiếp lên mảng RGBA (vd ImageData.data). */
export function applyAdjustments(data: Uint8ClampedArray, a: Adjustments): void {
  if (isNeutral(a)) return;
  const lut = buildOutputLut(a);
  const gain = 2 ** ((a.exposure / 100) * EXPOSURE_EV_RANGE);
  const w = a.warmth / 100;
  const gR = gain * (1 + 0.12 * w);
  const gG = gain * (1 + 0.02 * w);
  const gB = gain * (1 - 0.12 * w);
  const sat = 1 + a.saturation / 100;
  const doSat = a.saturation !== 0;

  for (let i = 0; i < data.length; i += 4) {
    let r = lut[Math.min(OUT_STEPS, (SRGB_TO_LINEAR[data[i]] * gR * OUT_STEPS) | 0)];
    let g = lut[Math.min(OUT_STEPS, (SRGB_TO_LINEAR[data[i + 1]] * gG * OUT_STEPS) | 0)];
    let b = lut[Math.min(OUT_STEPS, (SRGB_TO_LINEAR[data[i + 2]] * gB * OUT_STEPS) | 0)];
    if (doSat) {
      const l = 0.299 * r + 0.587 * g + 0.114 * b;
      r = l + (r - l) * sat;
      g = l + (g - l) * sat;
      b = l + (b - l) * sat;
    }
    data[i] = r; // Uint8ClampedArray tự kẹp 0…255
    data[i + 1] = g;
    data[i + 2] = b;
  }
}

// ---------------------------------------------------------------------------
// Gợi ý từ kết quả phân tích
// ---------------------------------------------------------------------------

const RULES: { key: keyof Adjustments; re: RegExp }[] = [
  { key: "highlights", re: /highlight|vùng sáng|chi tiết sáng/i },
  { key: "shadows", re: /shadow|vùng tối|chi tiết tối/i },
  { key: "contrast", re: /contrast|tương phản/i },
  // "hoà" và "hòa" đều đúng chính tả (hai kiểu đặt dấu)
  { key: "saturation", re: /saturation|vibrance|bão h(?:oà|òa)|độ rực|sống động/i },
  { key: "warmth", re: /temp|warmth|white balance|nhiệt độ màu|nhiệt màu|cân bằng trắng/i },
  { key: "exposure", re: /exposure|phơi sáng/i },
];

const NUMBER = /([+\-−–]?)\s*(\d+(?:[.,]\d+)?)\s*(ev|k\b)?/i;

/**
 * Đọc các dòng hậu kỳ AI gợi ý (vd "Highlights −40", "Exposure +0.3 EV", "Nhiệt độ màu +300K")
 * thành giá trị thanh trượt. Dòng nào không hiểu (Clarity, Dehaze…) thì bỏ qua.
 */
export function parseEditingSuggestions(lines: string[] | undefined): Partial<Adjustments> {
  const out: Partial<Adjustments> = {};
  for (const raw of lines ?? []) {
    const line = raw.normalize("NFC"); // chữ Việt có thể ở dạng dấu tách rời
    const rule = RULES.find((r) => r.re.test(line));
    if (!rule || out[rule.key] !== undefined) continue;
    // Lấy số đứng sau từ khoá (tránh nhầm số trong tên như "HSL 2")
    const after = line.slice(line.search(rule.re));
    const m = NUMBER.exec(after);
    if (!m) continue;
    let v = Number(m[2].replace(",", ".")) * (m[1] && m[1] !== "+" ? -1 : 1);
    const unit = m[3]?.toLowerCase();
    if (rule.key === "exposure" && (unit === "ev" || Math.abs(v) <= 5)) v = (v / EXPOSURE_EV_RANGE) * 100;
    else if (rule.key === "warmth" && (unit === "k" || Math.abs(v) > 100)) v = v / 20; // ±2000K ≈ cả thanh
    if (Number.isFinite(v) && v !== 0) out[rule.key] = clampSlider(v);
  }
  return out;
}

/** Gợi ý nhẹ dựa trên số đo pixel — dùng khi AI không đưa giá trị hậu kỳ (chế độ Cơ bản). */
export function adjustmentsFromStats(stats: ImageStats): Partial<Adjustments> {
  const out: Partial<Adjustments> = {};
  if (stats.clippedHighlights > 0.02) out.highlights = -Math.min(60, Math.round(20 + stats.clippedHighlights * 400));
  if (stats.clippedShadows > 0.04 || stats.p2Luma < 8) out.shadows = Math.min(50, Math.round(20 + stats.clippedShadows * 300));
  if (stats.meanLuma < 85 && stats.clippedHighlights < 0.01) out.exposure = Math.min(50, Math.round((105 - stats.meanLuma) / 1.2));
  else if (stats.meanLuma > 185) out.exposure = -Math.min(40, Math.round((stats.meanLuma - 165) / 1.2));
  if (stats.stdLuma < 40) out.contrast = Math.min(30, Math.round((48 - stats.stdLuma) * 1.5));
  if (Math.abs(stats.warmth) > 0.12) out.warmth = Math.round(clamp(-stats.warmth * 80, -30, 30));
  if (stats.saturation < 0.15) out.saturation = 15;
  return out;
}

/** Giá trị thanh trượt khi bấm "Áp dụng gợi ý AI": AI ưu tiên, số đo bổ sung chỗ AI không nói tới. */
export function suggestedAdjustments(result: AnalysisResult | null, stats: ImageStats | null): Adjustments {
  const fromAi = parseEditingSuggestions(result?.suggestedSettings?.editing);
  const fromStats = stats ? adjustmentsFromStats(stats) : {};
  // Ám màu thường là cố ý (hoàng hôn vàng, ảnh đêm xanh) → chỉ sửa nhiệt màu khi AI chê cân bằng trắng
  if (result && !result.improvements.some((i) => i.category === "white_balance")) delete fromStats.warmth;
  return { ...NEUTRAL, ...fromStats, ...fromAi };
}
