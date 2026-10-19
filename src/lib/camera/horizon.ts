/**
 * Ước lượng đường chân trời trên frame thu nhỏ (chế độ Phong cảnh): tìm ranh giới trời sáng ở trên / đất tối ở dưới.
 * Chỉ cần độ cao của đường chân trời — góc nghiêng đã có thước cân bằng đo bằng cảm biến.
 * Hàm thuần — test được bằng Vitest.
 */

/** Số dải dọc dùng để kiểm tra ranh giới có nằm ngang và liền mạch không. */
const BANDS = 4;
/** Chênh lệch độ sáng tối thiểu giữa trời và đất (0..255). */
const MIN_CONTRAST = 22;
const MIN_BAND_CONTRAST = 12;
/** Ranh giới ở các dải lệch nhau tối đa bao nhiêu phần chiều cao. */
const MAX_SPREAD = 0.12;

/** Hàng có độ chênh trên-dưới lớn nhất (trên sáng hơn dưới). */
function bestSplit(rows: Float64Array, k: number): { y: number; diff: number } {
  const h = rows.length;
  const prefix = new Float64Array(h + 1);
  for (let y = 0; y < h; y++) prefix[y + 1] = prefix[y] + rows[y];
  let best = { y: -1, diff: -Infinity };
  for (let y = k; y <= h - k; y++) {
    const above = (prefix[y] - prefix[y - k]) / k;
    const below = (prefix[y + k] - prefix[y]) / k;
    if (above - below > best.diff) best = { y, diff: above - below };
  }
  return best;
}

/**
 * @returns y của đường chân trời (0..1 theo chiều cao frame), hoặc null nếu không thấy ranh giới rõ ràng.
 */
export function estimateHorizon(rgba: Uint8ClampedArray | Uint8Array, w: number, h: number): number | null {
  if (w < BANDS || h < 12) return null;
  const all = new Float64Array(h);
  const bands = Array.from({ length: BANDS }, () => new Float64Array(h));
  const bandW = w / BANDS;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const l = 0.2126 * rgba[i] + 0.7152 * rgba[i + 1] + 0.0722 * rgba[i + 2];
      all[y] += l;
      bands[Math.min(BANDS - 1, Math.floor(x / bandW))][y] += l;
    }
    all[y] /= w;
    for (const b of bands) b[y] /= bandW;
  }

  const k = Math.max(3, Math.round(h * 0.08));
  const overall = bestSplit(all, k);
  if (overall.diff < MIN_CONTRAST) return null;

  const ys: number[] = [];
  for (const b of bands) {
    const s = bestSplit(b, k);
    if (s.diff < MIN_BAND_CONTRAST) return null;
    ys.push(s.y);
  }
  if ((Math.max(...ys) - Math.min(...ys)) / h > MAX_SPREAD) return null;
  ys.sort((a, b) => a - b);
  return (ys[1] + ys[2]) / 2 / h;
}

export type HorizonHint = "horizon_center" | "horizon_third";

/** Lời nhắc theo vị trí chân trời trong khung sẽ chụp (0..1). */
export function horizonHint(y: number): HorizonHint | null {
  if (y < 0 || y > 1) return null;
  if (y > 0.42 && y < 0.58) return "horizon_center";
  if (Math.abs(y - 1 / 3) < 0.05 || Math.abs(y - 2 / 3) < 0.05) return "horizon_third";
  return null;
}
