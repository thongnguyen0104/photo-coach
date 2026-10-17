import type { Box } from "@/lib/analysis/types";

/**
 * Khung cắt, toạ độ chuẩn hoá 0–1 theo khung ảnh (sau khi xoay):
 * - ratio: rộng/cao tính theo pixel thật
 * - size: 0.2–1, tỉ lệ so với khung lớn nhất vừa ảnh ở tỉ lệ đó
 * - cx, cy: tâm khung
 */
export interface CropState {
  ratio: number;
  size: number;
  cx: number;
  cy: number;
  /** Preset đang chọn — chỉ để hiển thị */
  preset: string;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const MIN_CROP_SIZE = 0.2;
export const MAX_ROTATION = 15;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** "4:5" → 0.8 ; không hợp lệ → null */
export function parseRatio(s: string): number | null {
  const m = /^\s*(\d+(?:\.\d+)?)\s*[:/x×]\s*(\d+(?:\.\d+)?)\s*$/.exec(s);
  if (!m) return null;
  const r = Number(m[1]) / Number(m[2]);
  return Number.isFinite(r) && r > 0 ? r : null;
}

export const fullCrop = (width: number, height: number): CropState => ({ ratio: width / height, size: 1, cx: 0.5, cy: 0.5, preset: "original" });

/** Khung cắt (đơn vị 0–1) từ trạng thái; tự kẹp để không tràn ra ngoài ảnh. */
export function cropRect(c: CropState, width: number, height: number): Rect {
  const frame = width / height;
  // Khung lớn nhất có tỉ lệ c.ratio vừa trong ảnh, tính theo phần của chiều rộng/cao
  let w = 1;
  let h = 1;
  if (c.ratio > frame) h = frame / c.ratio;
  else w = c.ratio / frame;
  const size = clamp(c.size, MIN_CROP_SIZE, 1);
  w *= size;
  h *= size;
  const x = clamp(c.cx - w / 2, 0, 1 - w);
  const y = clamp(c.cy - h / 2, 0, 1 - h);
  return { x, y, w, h };
}

/** Chuẩn hoá lại tâm sau khi kẹp (để kéo khung không bị "dính" ở mép). */
export function normalizeCrop(c: CropState, width: number, height: number): CropState {
  const r = cropRect(c, width, height);
  return { ...c, size: clamp(c.size, MIN_CROP_SIZE, 1), cx: r.x + r.w / 2, cy: r.y + r.h / 2 };
}

/** Đổi tỉ lệ, giữ tâm; khung to nhất có thể. */
export function cropForRatio(ratio: number, preset: string, prev: CropState, width: number, height: number): CropState {
  return normalizeCrop({ ratio, size: 1, cx: prev.cx, cy: prev.cy, preset }, width, height);
}

/** Khung crop AI gợi ý (box [ymin, xmin, ymax, xmax] 0–1000) → trạng thái khung. */
export function cropFromBox(box: Box, width: number, height: number): CropState {
  const [y0, x0, y1, x1] = box.map((v) => v / 1000);
  const wPx = (x1 - x0) * width;
  const hPx = (y1 - y0) * height;
  const ratio = wPx / hPx;
  const max = cropRect({ ratio, size: 1, cx: 0.5, cy: 0.5, preset: "" }, width, height);
  return normalizeCrop(
    { ratio, size: (x1 - x0) / max.w, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, preset: "ai" },
    width,
    height,
  );
}

/** Hệ số phóng để ảnh xoay `deg` độ vẫn phủ kín khung cũ (không lộ góc trống). */
export function coverScale(width: number, height: number, deg: number): number {
  const t = (Math.abs(deg) * Math.PI) / 180;
  const cos = Math.cos(t);
  const sin = Math.sin(t);
  return Math.max(cos + (height / width) * sin, cos + (width / height) * sin);
}

/**
 * Góc xoay (độ, dương = theo chiều kim đồng hồ trên màn hình) để làm thẳng chân trời.
 * tiltDeg dương = phía phải thấp hơn → xoay ngược chiều kim đồng hồ.
 */
export function rotationForTilt(tiltDeg: number | undefined): number {
  if (tiltDeg === undefined || Math.abs(tiltDeg) < 0.3) return 0;
  return Math.round(clamp(-tiltDeg, -MAX_ROTATION, MAX_ROTATION) * 10) / 10;
}

/** Thu nhỏ để tổng số pixel ≤ maxPixels (Safari iOS giới hạn canvas ~16.7 triệu pixel). */
export function fitPixels(width: number, height: number, maxPixels: number): { width: number; height: number; scale: number } {
  const scale = Math.min(1, Math.sqrt(maxPixels / (width * height)));
  return { width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale)), scale };
}

/**
 * Vùng ảnh đưa cho model xoá vật thể: bao quanh vùng tô + phần nền xung quanh để model "hiểu" bối cảnh.
 * Tất cả tính bằng pixel.
 */
export function contextRect(mask: Rect, width: number, height: number): Rect {
  const side = Math.max(256, Math.max(mask.w, mask.h) * 2);
  const w = Math.min(width, Math.max(side, mask.w + 64));
  const h = Math.min(height, Math.max(side, mask.h + 64));
  const x = clamp(Math.round(mask.x + mask.w / 2 - w / 2), 0, width - w);
  const y = clamp(Math.round(mask.y + mask.h / 2 - h / 2), 0, height - h);
  return { x, y, w: Math.round(w), h: Math.round(h) };
}
