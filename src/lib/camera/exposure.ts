/**
 * Cảnh báo sáng/tối khi đang ngắm — chạy trên frame thu nhỏ của camera.
 * Hàm thuần — test được bằng Vitest.
 */
import { dominantRegion } from "@/lib/analysis/facts";
import type { ImageStats } from "@/lib/image/stats";

export type ExposureHint = "backlit" | "sky_clipped" | "highlights_clipped" | "too_dark" | "too_bright";

/** Cạnh dài của frame dùng để đo — nhỏ để chạy nhanh trên điện thoại. */
export const FRAME_SAMPLE_EDGE = 160;
/** Khoảng cách giữa 2 lần đo (ms). */
export const FRAME_INTERVAL_MS = 200;

type Input = Pick<ImageStats, "meanLuma" | "p2Luma" | "p98Luma" | "stdLuma" | "clippedHighlights" | "clippedShadows" | "highlightGrid">;

/** Các cảnh báo cho 1 frame, xếp theo mức quan trọng. */
export function exposureHints(s: Input): ExposureHint[] {
  const hints: ExposureHint[] = [];
  const backlit = (s.clippedHighlights > 0.03 && s.clippedShadows > 0.08) || (s.p2Luma < 8 && s.p98Luma > 248 && s.stdLuma > 75);
  if (backlit) hints.push("backlit");

  if (s.clippedHighlights > 0.06) {
    hints.push(dominantRegion(s.highlightGrid).startsWith("top") ? "sky_clipped" : "highlights_clipped");
  }

  if (s.meanLuma < 55 && s.p98Luma < 170) hints.push("too_dark");
  else if (!backlit && (s.meanLuma > 200 || s.clippedHighlights > 0.25)) hints.push("too_bright");

  return hints;
}

/**
 * Chống nhấp nháy: một cảnh báo chỉ hiện khi xuất hiện ở ít nhất `need` trong `window` frame gần nhất.
 */
export class HintStabilizer<T extends string = ExposureHint> {
  private history: T[][] = [];

  constructor(
    private readonly window = 5,
    private readonly need = 3,
  ) {}

  push(hints: T[]): T[] {
    this.history.push(hints);
    if (this.history.length > this.window) this.history.shift();
    const count = new Map<T, number>();
    for (const frame of this.history) for (const h of frame) count.set(h, (count.get(h) ?? 0) + 1);
    // Giữ thứ tự ưu tiên của frame mới nhất, rồi tới các cảnh báo cũ còn đủ số lần
    const order = [...new Set([...hints, ...this.history.flat()])];
    return order.filter((h) => (count.get(h) ?? 0) >= this.need);
  }

  reset() {
    this.history = [];
  }
}
