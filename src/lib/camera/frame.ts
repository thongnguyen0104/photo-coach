/**
 * Khung hình & tỉ lệ khi chụp bằng camera trực tiếp. Hàm thuần — test được bằng Vitest.
 */

export const ASPECTS = ["full", "4:5", "1:1", "9:16", "3:2"] as const;
export type Aspect = (typeof ASPECTS)[number];

export const GRIDS = ["thirds", "golden", "diagonal", "center", "none"] as const;
export type GridKind = (typeof GRIDS)[number];

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Vùng lớn nhất có tỉ lệ `aspect`, đặt giữa khung `w×h`.
 * Tỉ lệ được hiểu theo hướng của khung: khung dọc thì 4:5 là dọc, khung ngang thì 4:5 thành 5:4.
 */
export function aspectRect(w: number, h: number, aspect: Aspect): Rect {
  if (aspect === "full") return { x: 0, y: 0, w, h };
  const [a, b] = aspect.split(":").map(Number);
  const portrait = h >= w;
  // ratio = rộng / cao
  const ratio = portrait ? Math.min(a, b) / Math.max(a, b) : Math.max(a, b) / Math.min(a, b);
  let cw = w;
  let ch = Math.round(w / ratio);
  if (ch > h) {
    ch = h;
    cw = Math.round(h * ratio);
  }
  return { x: Math.round((w - cw) / 2), y: Math.round((h - ch) / 2), w: cw, h: ch };
}

/** Các đường lưới (toạ độ 0..1) cho một kiểu lưới. */
export function gridLines(kind: GridKind): { x1: number; y1: number; x2: number; y2: number }[] {
  const v = (x: number) => ({ x1: x, y1: 0, x2: x, y2: 1 });
  const hz = (y: number) => ({ x1: 0, y1: y, x2: 1, y2: y });
  switch (kind) {
    case "thirds":
      return [v(1 / 3), v(2 / 3), hz(1 / 3), hz(2 / 3)];
    case "golden":
      return [v(0.382), v(0.618), hz(0.382), hz(0.618)];
    case "diagonal":
      return [
        { x1: 0, y1: 0, x2: 1, y2: 1 },
        { x1: 1, y1: 0, x2: 0, y2: 1 },
      ];
    case "center":
      return [
        { x1: 0.46, y1: 0.5, x2: 0.54, y2: 0.5 },
        { x1: 0.5, y1: 0.46, x2: 0.5, y2: 0.54 },
      ];
    default:
      return [];
  }
}
