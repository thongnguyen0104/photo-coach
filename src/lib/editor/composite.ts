/**
 * Ghép kết quả xoá vật thể vào ảnh với mép mềm: trong vùng xoá, càng gần mép thì càng pha nhiều ảnh cũ.
 * Model thường lấp hơi lệch màu → mép cứng lộ thành "khung" mờ; làm mềm vài pixel phía trong là hết.
 * Chỉ pha vào PHÍA TRONG vùng tô (nét cọ luôn tô rộng hơn vật thể), ngoài vùng tô giữ nguyên ảnh cũ.
 *
 * holeMask: 0 = vùng xoá, 255 = giữ. Ghi kết quả vào `after`.
 */
export function featherComposite(before: Uint8ClampedArray, after: Uint8ClampedArray, holeMask: Uint8Array, width: number, height: number, feather: number) {
  if (feather <= 0) return;
  // Khoảng cách (chamfer 3-4) từ mỗi pixel trong vùng xoá tới pixel "giữ" gần nhất
  const INF = 1e9;
  const d = new Float32Array(width * height);
  for (let i = 0; i < d.length; i++) d[i] = holeMask[i] === 0 ? INF : 0;
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= width || y >= height ? INF : d[y * width + x]);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (d[i] === 0) continue;
      d[i] = Math.min(d[i], at(x - 1, y) + 3, at(x, y - 1) + 3, at(x - 1, y - 1) + 4, at(x + 1, y - 1) + 4);
    }
  }
  for (let y = height - 1; y >= 0; y--) {
    for (let x = width - 1; x >= 0; x--) {
      const i = y * width + x;
      if (d[i] === 0) continue;
      d[i] = Math.min(d[i], at(x + 1, y) + 3, at(x, y + 1) + 3, at(x + 1, y + 1) + 4, at(x - 1, y + 1) + 4);
    }
  }
  const f3 = feather * 3; // chamfer đo theo đơn vị 1/3 pixel
  for (let i = 0; i < d.length; i++) {
    if (d[i] === 0) {
      // Ngoài vùng xoá: luôn là ảnh cũ
      after[i * 4] = before[i * 4];
      after[i * 4 + 1] = before[i * 4 + 1];
      after[i * 4 + 2] = before[i * 4 + 2];
      continue;
    }
    if (d[i] >= f3) continue;
    const a = d[i] / f3;
    for (let k = 0; k < 3; k++) after[i * 4 + k] = before[i * 4 + k] * (1 - a) + after[i * 4 + k] * a;
  }
}

/** Độ rộng mép mềm (pixel) theo kích thước vùng xoá. */
export const featherWidth = (holeW: number, holeH: number) => Math.round(Math.min(12, Math.max(2, Math.min(holeW, holeH) * 0.06)));
