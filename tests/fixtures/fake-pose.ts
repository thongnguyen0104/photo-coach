/**
 * Dựng 33 điểm BlazePose của một người đứng thẳng — dùng cho unit test quy tắc bố cục và E2E (bộ nhận diện giả).
 * Tỉ lệ cơ thể tính theo chiều cao đầu H (mắt → đỉnh đầu ≈ 0.5H, mắt → cổ chân ≈ 7H).
 */
import type { Landmark, PersonObservation } from "@/lib/camera/subject";

/** [dx, dy] so với điểm giữa hai mắt, đơn vị H. dx dương = sang phải trong ảnh. */
const OFFSETS: [number, number][] = [
  [0, 0.2], // 0 mũi
  [0.08, 0], [0.15, 0], [0.22, 0], // 1-3 mắt trái (của người)
  [-0.08, 0], [-0.15, 0], [-0.22, 0], // 4-6 mắt phải
  [0.4, 0.05], [-0.4, 0.05], // 7-8 tai
  [0.1, 0.3], [-0.1, 0.3], // 9-10 miệng
  [0.9, 1.2], [-0.9, 1.2], // 11-12 vai
  [0.95, 2.4], [-0.95, 2.4], // 13-14 khuỷu tay
  [1.05, 3.4], [-1.05, 3.4], // 15-16 cổ tay
  [1.05, 3.7], [-1.05, 3.7], [1.05, 3.75], [-1.05, 3.75], [1.0, 3.6], [-1.0, 3.6], // 17-22 bàn tay
  [0.5, 3.6], [-0.5, 3.6], // 23-24 hông
  [0.5, 5.3], [-0.5, 5.3], // 25-26 đầu gối
  [0.5, 7.0], [-0.5, 7.0], // 27-28 cổ chân
  [0.5, 7.2], [-0.5, 7.2], // 29-30 gót
  [0.6, 7.35], [-0.6, 7.35], // 31-32 mũi chân
];

export interface FakePersonOptions {
  /** Kích thước video (pixel) */
  vw: number;
  vh: number;
  /** Điểm giữa hai mắt, toạ độ video 0..1 */
  eyes: { x: number; y: number };
  /** Chiều cao đầu theo chiều cao video (0..1) */
  head: number;
  /** -1 nhìn sang trái ảnh, 1 nhìn sang phải ảnh */
  facing?: -1 | 0 | 1;
}

export function fakePose({ vw, vh, eyes, head, facing = 0 }: FakePersonOptions): PersonObservation {
  const H = head * vh;
  const pose: Landmark[] = OFFSETS.map(([dx, dy], i) => {
    const shift = i === 0 ? 0.35 * facing : 0;
    const x = eyes.x + ((dx + shift) * H) / vw;
    const y = eyes.y + (dy * H) / vh;
    // Như BlazePose: điểm ngoài khung có độ "thấy" thấp
    const visibility = x >= 0 && x <= 1 && y >= 0 && y <= 1 ? 0.95 : 0.05;
    return { x, y, visibility };
  });
  return { pose };
}

/** Chỉ có khuôn mặt (FaceDetector): mắt phải, mắt trái, mũi, miệng, tai phải, tai trái. */
export function fakeFace({ vw, vh, eyes, head, facing = 0 }: FakePersonOptions): PersonObservation {
  const H = head * vh;
  const at = (dx: number, dy: number) => ({ x: eyes.x + (dx * H) / vw, y: eyes.y + (dy * H) / vh });
  return {
    face: [at(-0.15, 0), at(0.15, 0), at(0.35 * facing, 0.2), at(0, 0.3), at(-0.4, 0.05), at(0.4, 0.05)],
  };
}
