/**
 * Thước cân bằng: tính góc nghiêng của khung hình từ cảm biến hướng (DeviceOrientationEvent).
 * Hàm thuần — test được bằng Vitest.
 */

const RAD = Math.PI / 180;

export interface LevelReading {
  /** Góc nghiêng so với đường ngang của màn hình, độ, khoảng -45..45. Dương = chân trời trong khung bị xoay theo chiều kim đồng hồ */
  tiltDeg: number;
  /** Máy đang gần như nằm ngang (chụp từ trên xuống / chĩa lên trời) → góc nghiêng không có ý nghĩa */
  flat: boolean;
}

/**
 * @param beta   DeviceOrientationEvent.beta (độ, quanh trục x)
 * @param gamma  DeviceOrientationEvent.gamma (độ, quanh trục y)
 * @param screenAngle  screen.orientation.angle (0, 90, 180, 270)
 */
export function levelFromOrientation(beta: number, gamma: number, screenAngle = 0): LevelReading {
  // Véc-tơ "hướng lên" của thế giới trong hệ toạ độ thiết bị (R = Rz(α)·Rx(β)·Ry(γ), u = Rᵀ·[0,0,1])
  const b = beta * RAD;
  const g = gamma * RAD;
  const ux = -Math.cos(b) * Math.sin(g);
  const uy = Math.sin(b);
  // Hình chiếu lên mặt màn hình quá ngắn → máy gần nằm ngang
  const flat = Math.hypot(ux, uy) < 0.35;
  // Góc của "hướng lên" so với cạnh trên thiết bị, trừ đi góc xoay màn hình
  const roll = Math.atan2(ux, uy) / RAD - screenAngle;
  return { tiltDeg: wrap45(roll), flat };
}

/** Đưa góc về khoảng -45..45 (khung ngang hay dọc đều có đường chuẩn gần nhất). */
export function wrap45(deg: number): number {
  const r = ((((deg + 45) % 90) + 90) % 90) - 45;
  return Math.round(r * 10) / 10;
}

/** Làm mượt góc (EMA) để số không nhảy liên tục. */
export function smoothAngle(prev: number | null, next: number, alpha = 0.25): number {
  if (prev === null || Math.abs(next - prev) > 20) return next;
  return prev + (next - prev) * alpha;
}

/** Ngưỡng coi là "thẳng" — đổi màu xanh. */
export const LEVEL_OK_DEG = 1;
