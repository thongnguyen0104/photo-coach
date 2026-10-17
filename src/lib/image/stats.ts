/**
 * Đo đạc pixel của ảnh (chạy ở trình duyệt trên bản thu nhỏ).
 * Hàm thuần — nhận mảng RGBA, không phụ thuộc DOM → test được bằng Vitest.
 */

export const HIST_BINS = 64;
export const CLIP_GRID = 6;

export interface ImageStats {
  sampleWidth: number;
  sampleHeight: number;
  /** Histogram 64 bin, mỗi bin là tỉ lệ pixel (tổng = 1) */
  histogram: { luma: number[]; r: number[]; g: number[]; b: number[] };
  meanLuma: number;
  medianLuma: number;
  p2Luma: number;
  p98Luma: number;
  /** Độ lệch chuẩn độ sáng — thước đo tương phản */
  stdLuma: number;
  /** Tỉ lệ pixel cháy sáng (có kênh màu ≥ 254) */
  clippedHighlights: number;
  /** Tỉ lệ pixel mất chi tiết tối (luma ≤ 3) */
  clippedShadows: number;
  /** Lưới 6×6 (theo hàng) tỉ lệ cháy sáng / tối mỗi ô — để biết vùng nào bị */
  highlightGrid: number[];
  shadowGrid: number[];
  /** Trung bình RGB của vùng trung tính (bỏ quá tối/quá sáng) */
  meanRgb: [number, number, number];
  /** >0 ấm (vàng/cam), <0 lạnh (xanh dương). Khoảng -1..1 */
  warmth: number;
  /** >0 ám xanh lá, <0 ám tím/hồng. Khoảng -1..1 */
  tint: number;
  /** Độ bão hoà trung bình 0..1 */
  saturation: number;
  /** Phương sai Laplacian toàn ảnh — càng cao càng nét */
  sharpness: number;
  /** Phương sai Laplacian của ô nét nhất trong lưới 3×3 (chủ thể thường nằm ở đó) */
  sharpnessMax: number;
  sharpestCell: number;
}

const luma = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

function percentile(hist256: Uint32Array, total: number, p: number): number {
  const target = total * p;
  let acc = 0;
  for (let i = 0; i < 256; i++) {
    acc += hist256[i];
    if (acc >= target) return i;
  }
  return 255;
}

const round = (n: number, d = 4) => Math.round(n * 10 ** d) / 10 ** d;

export function computeImageStats(data: Uint8ClampedArray | Uint8Array, width: number, height: number): ImageStats {
  const total = width * height;
  const luma256 = new Uint32Array(256);
  const hl = new Float64Array(HIST_BINS);
  const hr = new Float64Array(HIST_BINS);
  const hg = new Float64Array(HIST_BINS);
  const hb = new Float64Array(HIST_BINS);
  const gray = new Float32Array(total);
  const hiGrid = new Float64Array(CLIP_GRID * CLIP_GRID);
  const shGrid = new Float64Array(CLIP_GRID * CLIP_GRID);
  const gridCount = new Float64Array(CLIP_GRID * CLIP_GRID);
  const binShift = 256 / HIST_BINS;

  let sumL = 0;
  let sumL2 = 0;
  let clipHi = 0;
  let clipLo = 0;
  let midR = 0;
  let midG = 0;
  let midB = 0;
  let midN = 0;
  let satSum = 0;

  for (let y = 0; y < height; y++) {
    const gy = Math.min(CLIP_GRID - 1, Math.floor((y / height) * CLIP_GRID));
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const o = i * 4;
      const r = data[o];
      const g = data[o + 1];
      const b = data[o + 2];
      const l = luma(r, g, b);
      gray[i] = l;
      const li = Math.min(255, Math.round(l));
      luma256[li]++;
      hl[Math.floor(li / binShift)]++;
      hr[Math.floor(r / binShift)]++;
      hg[Math.floor(g / binShift)]++;
      hb[Math.floor(b / binShift)]++;
      sumL += l;
      sumL2 += l * l;

      const gx = Math.min(CLIP_GRID - 1, Math.floor((x / width) * CLIP_GRID));
      const cell = gy * CLIP_GRID + gx;
      gridCount[cell]++;
      if (r >= 254 || g >= 254 || b >= 254) {
        clipHi++;
        hiGrid[cell]++;
      }
      if (l <= 3) {
        clipLo++;
        shGrid[cell]++;
      }
      if (l >= 40 && l <= 215) {
        midR += r;
        midG += g;
        midB += b;
        midN++;
      }
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      satSum += max === 0 ? 0 : (max - min) / max;
    }
  }

  // Độ nét: phương sai của Laplacian 4-lân-cận, toàn ảnh và theo lưới 3×3
  const cells = 3;
  const lapSum = new Float64Array(cells * cells);
  const lapSum2 = new Float64Array(cells * cells);
  const lapN = new Float64Array(cells * cells);
  let ls = 0;
  let ls2 = 0;
  let ln = 0;
  for (let y = 1; y < height - 1; y++) {
    const cy = Math.min(cells - 1, Math.floor((y / height) * cells));
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const v = gray[i - 1] + gray[i + 1] + gray[i - width] + gray[i + width] - 4 * gray[i];
      ls += v;
      ls2 += v * v;
      ln++;
      const c = cy * cells + Math.min(cells - 1, Math.floor((x / width) * cells));
      lapSum[c] += v;
      lapSum2[c] += v * v;
      lapN[c]++;
    }
  }
  const variance = (s: number, s2: number, n: number) => (n > 0 ? s2 / n - (s / n) ** 2 : 0);
  let sharpnessMax = 0;
  let sharpestCell = 4;
  for (let c = 0; c < cells * cells; c++) {
    const v = variance(lapSum[c], lapSum2[c], lapN[c]);
    if (v > sharpnessMax) {
      sharpnessMax = v;
      sharpestCell = c;
    }
  }

  const mean = sumL / total;
  const meanRgb: [number, number, number] =
    midN > 0 ? [midR / midN, midG / midN, midB / midN] : [mean, mean, mean];
  const rgbSum = meanRgb[0] + meanRgb[1] + meanRgb[2] || 1;
  const norm = (arr: Float64Array) => Array.from(arr, (v) => round(v / total, 5));

  return {
    sampleWidth: width,
    sampleHeight: height,
    histogram: { luma: norm(hl), r: norm(hr), g: norm(hg), b: norm(hb) },
    meanLuma: round(mean, 2),
    medianLuma: percentile(luma256, total, 0.5),
    p2Luma: percentile(luma256, total, 0.02),
    p98Luma: percentile(luma256, total, 0.98),
    stdLuma: round(Math.sqrt(Math.max(0, sumL2 / total - mean * mean)), 2),
    clippedHighlights: round(clipHi / total),
    clippedShadows: round(clipLo / total),
    highlightGrid: Array.from(hiGrid, (v, i) => round(gridCount[i] ? v / gridCount[i] : 0, 3)),
    shadowGrid: Array.from(shGrid, (v, i) => round(gridCount[i] ? v / gridCount[i] : 0, 3)),
    meanRgb: [round(meanRgb[0], 1), round(meanRgb[1], 1), round(meanRgb[2], 1)],
    warmth: round(((meanRgb[0] - meanRgb[2]) / rgbSum) * 3, 3),
    tint: round(((meanRgb[1] - (meanRgb[0] + meanRgb[2]) / 2) / rgbSum) * 3, 3),
    saturation: round(satSum / total, 3),
    sharpness: round(variance(ls, ls2, ln), 1),
    sharpnessMax: round(sharpnessMax, 1),
    sharpestCell,
  };
}

/** Tỉ lệ khung gần nhất với các chuẩn phổ biến. */
export function nearestAspectRatio(width: number, height: number): string {
  const r = width / height;
  const candidates: [string, number][] = [
    ["1:1", 1],
    ["5:4", 5 / 4],
    ["4:3", 4 / 3],
    ["3:2", 3 / 2],
    ["16:9", 16 / 9],
    ["2:1", 2],
    ["4:5", 4 / 5],
    ["3:4", 3 / 4],
    ["2:3", 2 / 3],
    ["9:16", 9 / 16],
  ];
  let best = candidates[0];
  for (const c of candidates) if (Math.abs(Math.log(r / c[1])) < Math.abs(Math.log(r / best[1]))) best = c;
  return Math.abs(Math.log(r / best[1])) < 0.03 ? best[0] : `${(r >= 1 ? r : 1 / r).toFixed(2)}:1`;
}
