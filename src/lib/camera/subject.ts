/**
 * Hướng dẫn vị trí người khi đang ngắm (chế độ Chân dung).
 * Đầu vào là điểm mốc từ MediaPipe (PoseLandmarker / FaceDetector), đầu ra là 1 lời nhắc + hướng dịch máy.
 * Hàm thuần — test được bằng Vitest.
 */
import type { Rect } from "./frame";

export interface Pt {
  x: number;
  y: number;
}

/** Điểm mốc theo toạ độ video chuẩn hoá 0..1 (có thể ra ngoài 0..1 khi điểm nằm ngoài khung). */
export interface Landmark extends Pt {
  /** Khả năng điểm nằm trong khung và không bị che, 0..1 */
  visibility?: number;
}

/** Kết quả nhận diện 1 người, chưa phụ thuộc thư viện. */
export interface PersonObservation {
  /** 33 điểm BlazePose (PoseLandmarker) */
  pose?: Landmark[];
  /** Chỉ có mặt (FaceDetector): mắt phải, mắt trái, mũi, miệng, tai phải, tai trái */
  face?: Landmark[];
}

/** Video gốc và vùng sẽ được chụp (khung tỉ lệ đã chọn), đơn vị pixel video. */
export interface FrameGeometry {
  vw: number;
  vh: number;
  r: Rect;
}

export type JointName = "elbow" | "wrist" | "knee" | "ankle";
export type ShotType = "close" | "medium" | "full";

/** Một người, toạ độ chuẩn hoá theo khung sẽ chụp (0..1, có thể ra ngoài). */
export interface Person {
  eyes: Pt;
  /** Ước lượng đỉnh đầu (kể cả tóc) */
  headTop: number;
  /** Chiều cao đầu, theo đơn vị chiều cao khung */
  headSize: number;
  /** Điểm thấp nhất còn thấy trong khung */
  bottom: number;
  left: number;
  right: number;
  /** Hướng mặt trong ảnh: -1 nhìn sang trái, 1 nhìn sang phải, 0 nhìn thẳng */
  facing: -1 | 0 | 1;
  shot: ShotType;
  joints: { name: JointName; at: Pt; parentVisible: boolean }[];
}

export type Move = "up" | "down" | "left" | "right" | "back" | "closer";

export type SubjectHint = "head_cut" | "cut_joint" | "near_edge" | "eyes_low" | "too_much_headroom" | "look_room" | "too_small";

export interface SubjectAdvice {
  /** null = bố cục ổn */
  hint: SubjectHint | null;
  /** Hướng di chuyển / xoay máy (không phải hướng di chuyển của người trong khung) */
  move?: Move;
  joint?: JointName;
  /** Chỗ khớp bị cắt, để đánh dấu đỏ */
  cutAt?: Pt;
  /** Chỗ nên đặt mắt (giao điểm 1/3) — chỉ cho ảnh cận / nửa người */
  target?: Pt;
  /** Người chính (to nhất) */
  main: Person;
}

/** Ngưỡng "có thấy" của điểm mốc. */
const SEEN = 0.5;
/** Khoảng cách mắt → miệng ≈ 0.3 chiều cao đầu */
const EYE_MOUTH_RATIO = 0.3;
/** Từ mắt lên đỉnh đầu (gồm tóc) ≈ 0.6 chiều cao đầu */
const EYE_TO_TOP = 0.6;

// Chỉ số điểm BlazePose
const NOSE = 0;
const L_EYE = 2;
const R_EYE = 5;
const L_EAR = 7;
const R_EAR = 8;
const MOUTH_L = 9;
const MOUTH_R = 10;
const L_SHOULDER = 11;
const R_SHOULDER = 12;
const L_HIP = 23;
const R_HIP = 24;
const L_ANKLE = 27;
const R_ANKLE = 28;

/** Khớp → điểm cha (phải thấy điểm cha thì vị trí khớp ngoài khung mới đáng tin). */
const JOINTS: { name: JointName; idx: [number, number]; parent: [number, number] }[] = [
  { name: "elbow", idx: [13, 14], parent: [L_SHOULDER, R_SHOULDER] },
  { name: "wrist", idx: [15, 16], parent: [13, 14] },
  { name: "knee", idx: [25, 26], parent: [L_HIP, R_HIP] },
  { name: "ankle", idx: [27, 28], parent: [25, 26] },
];

const mid = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const seen = (l: Landmark | undefined) => !!l && (l.visibility ?? 1) >= SEEN;
const inside = (p: Pt) => p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1;

/** Toạ độ video 0..1 → toạ độ khung sẽ chụp 0..1. */
export function toFrame(p: Pt, g: FrameGeometry): Pt {
  return { x: (p.x * g.vw - g.r.x) / g.r.w, y: (p.y * g.vh - g.r.y) / g.r.h };
}

/** Toạ độ khung 0..1 → pixel video (để vẽ lớp phủ). */
export function fromFrame(p: Pt, g: FrameGeometry): Pt {
  return { x: g.r.x + p.x * g.r.w, y: g.r.y + p.y * g.r.h };
}

/** Khoảng cách theo đơn vị chiều cao khung (khung không vuông → quy x về cùng thước đo với y). */
const dist = (a: Pt, b: Pt, ratio: number) => Math.hypot((a.x - b.x) * ratio, a.y - b.y);

function facingFrom(nose: Pt, earMid: Pt, eyeMouth: number, ratio: number): -1 | 0 | 1 {
  // Mặt quay sang một bên → mũi lệch hẳn khỏi điểm giữa hai tai
  const offset = ((nose.x - earMid.x) * ratio) / eyeMouth;
  return offset > 0.6 ? 1 : offset < -0.6 ? -1 : 0;
}

/** Chuyển kết quả nhận diện sang `Person`. Không thấy mặt → null (không áp được quy tắc về đầu/mắt). */
export function toPerson(obs: PersonObservation, g: FrameGeometry): Person | null {
  const ratio = g.r.w / g.r.h;
  const f = (l: Landmark) => toFrame(l, g);

  if (obs.pose && obs.pose.length >= 33) {
    const lm = obs.pose;
    if (![NOSE, L_EYE, R_EYE, MOUTH_L, MOUTH_R].every((i) => seen(lm[i]))) return null;
    const eyes = mid(f(lm[L_EYE]), f(lm[R_EYE]));
    const mouth = mid(f(lm[MOUTH_L]), f(lm[MOUTH_R]));
    const eyeMouth = Math.max(dist(eyes, mouth, ratio), 1e-4);
    const headSize = eyeMouth / EYE_MOUTH_RATIO;
    const visible = lm.map(f).filter((p, i) => seen(lm[i]) && inside(p));
    const xs = visible.map((p) => p.x);
    const ankleIn = [L_ANKLE, R_ANKLE].some((i) => seen(lm[i]) && f(lm[i]).y <= 1);
    const hipIn = [L_HIP, R_HIP].some((i) => seen(lm[i]) && f(lm[i]).y <= 1);
    return {
      eyes,
      headTop: eyes.y - EYE_TO_TOP * headSize,
      headSize,
      bottom: Math.max(...visible.map((p) => p.y)),
      left: Math.min(...xs) - (0.25 * headSize) / ratio,
      right: Math.max(...xs) + (0.25 * headSize) / ratio,
      facing: facingFrom(f(lm[NOSE]), mid(f(lm[L_EAR]), f(lm[R_EAR])), eyeMouth, ratio),
      shot: ankleIn ? "full" : hipIn ? "medium" : "close",
      joints: JOINTS.flatMap((j) =>
        j.idx.map((idx, side) => ({ name: j.name, at: f(lm[idx]), parentVisible: seen(lm[j.parent[side]]) })),
      ),
    };
  }

  if (obs.face && obs.face.length >= 6) {
    const [rEye, lEye, nose, mouth, rEar, lEar] = obs.face.map(f);
    const eyes = mid(rEye, lEye);
    const eyeMouth = Math.max(dist(eyes, mouth, ratio), 1e-4);
    const headSize = eyeMouth / EYE_MOUTH_RATIO;
    const half = (0.5 * headSize) / ratio;
    return {
      eyes,
      headTop: eyes.y - EYE_TO_TOP * headSize,
      headSize,
      bottom: Math.min(1, eyes.y + 0.6 * headSize),
      left: eyes.x - half,
      right: eyes.x + half,
      facing: facingFrom(nose, mid(rEar, lEar), eyeMouth, ratio),
      shot: "close",
      joints: [],
    };
  }
  return null;
}

/** Giao điểm 1/3 nên đặt mắt: nhìn sang phải → đặt bên trái để chừa khoảng trống phía trước, và ngược lại. */
export function eyeTarget(p: Person): Pt {
  if (p.facing === 1) return { x: 1 / 3, y: 1 / 3 };
  if (p.facing === -1) return { x: 2 / 3, y: 1 / 3 };
  const xs = [1 / 3, 1 / 2, 2 / 3];
  const x = xs.reduce((best, x) => (Math.abs(x - p.eyes.x) < Math.abs(best - p.eyes.x) ? x : best));
  return { x, y: 1 / 3 };
}

/** Khớp nằm sát mép khung (trong khoảng ±EDGE) → khung đang cắt ngang khớp. */
const EDGE = 0.04;

function cutJoint(p: Person): Pick<SubjectAdvice, "joint" | "cutAt" | "move"> | null {
  // Ưu tiên khớp chân (dễ thấy nhất khi bị cắt), rồi tới tay
  const order: JointName[] = ["knee", "ankle", "wrist", "elbow"];
  for (const name of order) {
    for (const j of p.joints) {
      if (j.name !== name || !j.parentVisible) continue;
      const { x, y } = j.at;
      if (Math.abs(y - 1) <= EDGE && x > 0 && x < 1) return { joint: name, cutAt: { x, y: 1 }, move: "back" };
      if ((name === "wrist" || name === "elbow") && y > 0 && y < 1) {
        if (Math.abs(x) <= EDGE) return { joint: name, cutAt: { x: 0, y }, move: "left" };
        if (Math.abs(x - 1) <= EDGE) return { joint: name, cutAt: { x: 1, y }, move: "right" };
      }
    }
  }
  return null;
}

/**
 * Lời nhắc quan trọng nhất cho cả nhóm người trong khung.
 * Thứ tự: cắt mất đầu → cắt ngang khớp → sát mép → mắt/khoảng trống trên đầu → hướng nhìn → người quá nhỏ.
 */
export function adviseSubject(people: Person[]): SubjectAdvice | null {
  if (!people.length) return null;
  const main = people.reduce((a, b) => (b.headSize > a.headSize ? b : a));
  const portraitShot = main.shot !== "full";
  const target = portraitShot ? eyeTarget(main) : undefined;
  const base = { main, target };

  // 1. Mất đỉnh đầu — trừ ảnh cận mặt rất sát (cắt trán là chủ ý)
  const cut = people.find((p) => p.headTop < -0.02 && p.headSize < 0.5);
  if (cut) return { ...base, hint: "head_cut", move: cut.headSize > 0.3 ? "back" : "up" };

  // 2. Khung cắt ngang khớp
  for (const p of [main, ...people.filter((p) => p !== main)]) {
    const j = cutJoint(p);
    if (j) return { ...base, hint: "cut_joint", ...j };
  }

  // 3. Người chính sát mép trái/phải
  if (main.eyes.x < 0.1) return { ...base, hint: "near_edge", move: "left" };
  if (main.eyes.x > 0.9) return { ...base, hint: "near_edge", move: "right" };

  // 4. Mắt quá thấp (cận/nửa người) hoặc dư trời trên đầu (toàn thân)
  if (portraitShot && main.eyes.y > 0.45) return { ...base, hint: "eyes_low", move: "down" };
  if (!portraitShot && main.headTop > 0.2) {
    return { ...base, hint: "too_much_headroom", move: main.bottom < 0.92 ? "down" : "closer" };
  }

  // 5. Nhìn về phía mép gần → chừa khoảng trống phía trước mặt
  if (main.facing === 1 && main.eyes.x > 0.6) return { ...base, hint: "look_room", move: "right" };
  if (main.facing === -1 && main.eyes.x < 0.4) return { ...base, hint: "look_room", move: "left" };

  // 6. Toàn thân nhưng người quá nhỏ
  if (!portraitShot && main.bottom - main.headTop < 0.35) return { ...base, hint: "too_small", move: "closer" };

  return { ...base, hint: null };
}

/** Mắt đã ở gần điểm đích chưa (vẽ vòng đích màu xanh). */
export const onTarget = (a: SubjectAdvice) => !!a.target && Math.hypot(a.main.eyes.x - a.target.x, a.main.eyes.y - a.target.y) < 0.07;
