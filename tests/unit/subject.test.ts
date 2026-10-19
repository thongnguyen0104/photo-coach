import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MEDIAPIPE_VERSION } from "@/lib/camera/detector";
import { aspectRect } from "@/lib/camera/frame";
import { estimateHorizon, horizonHint } from "@/lib/camera/horizon";
import { adviseSubject, eyeTarget, fromFrame, onTarget, toFrame, toPerson, type FrameGeometry, type PersonObservation } from "@/lib/camera/subject";
import { fakeFace, fakePose, type FakePersonOptions } from "../fixtures/fake-pose";

// Video ngang 640×480 như camera giả của Chromium, chụp toàn khung
const g: FrameGeometry = { vw: 640, vh: 480, r: { x: 0, y: 0, w: 640, h: 480 } };
const person = (o: Omit<FakePersonOptions, "vw" | "vh">) => fakePose({ vw: g.vw, vh: g.vh, ...o });
const advise = (...obs: PersonObservation[]) => adviseSubject(obs.map((o) => toPerson(o, g)!));

describe("toạ độ khung", () => {
  it("quy đổi video ↔ khung 4:5 (video ngang → khung 5:4 ở giữa)", () => {
    const geo: FrameGeometry = { vw: 640, vh: 480, r: aspectRect(640, 480, "4:5") };
    expect(geo.r).toEqual({ x: 20, y: 0, w: 600, h: 480 });
    expect(toFrame({ x: 0.5, y: 0.5 }, geo)).toEqual({ x: 0.5, y: 0.5 });
    expect(toFrame({ x: 20 / 640, y: 0 }, geo)).toEqual({ x: 0, y: 0 });
    expect(fromFrame({ x: 1, y: 1 }, geo)).toEqual({ x: 620, y: 480 });
  });
});

describe("nhận diện → người", () => {
  it("nửa người: đo mắt, đỉnh đầu, kiểu khung", () => {
    const p = toPerson(person({ eyes: { x: 0.5, y: 0.33 }, head: 0.15 }), g)!;
    expect(p.eyes.x).toBeCloseTo(0.5, 5);
    expect(p.eyes.y).toBeCloseTo(0.33, 5);
    expect(p.headSize).toBeCloseTo(0.15, 3);
    expect(p.headTop).toBeCloseTo(0.33 - 0.09, 3);
    expect(p.shot).toBe("medium");
    expect(p.facing).toBe(0);
  });

  it("toàn thân khi thấy cổ chân; hướng nhìn theo mũi so với tai", () => {
    const p = toPerson(person({ eyes: { x: 0.5, y: 0.1 }, head: 0.105, facing: -1 }), g)!;
    expect(p.shot).toBe("full");
    expect(p.facing).toBe(-1);
  });

  it("không thấy mặt (quay lưng) → bỏ qua", () => {
    const obs = person({ eyes: { x: 0.5, y: 0.33 }, head: 0.15 });
    obs.pose![0].visibility = 0.1;
    expect(toPerson(obs, g)).toBeNull();
  });

  it("chỉ có khuôn mặt (cận mặt) → ảnh cận", () => {
    const p = toPerson(fakeFace({ vw: 640, vh: 480, eyes: { x: 0.5, y: 0.4 }, head: 0.4, facing: 1 }), g)!;
    expect(p.shot).toBe("close");
    expect(p.headSize).toBeCloseTo(0.4, 3);
    expect(p.facing).toBe(1);
  });
});

describe("quy tắc bố cục", () => {
  it("nửa người, mắt ở 1/3 trên, nhìn thẳng → bố cục ổn, mắt trúng điểm đích", () => {
    const a = advise(person({ eyes: { x: 0.5, y: 0.33 }, head: 0.15 }))!;
    expect(a.hint).toBeNull();
    expect(a.target).toEqual({ x: 0.5, y: 1 / 3 });
    expect(onTarget(a)).toBe(true);
  });

  it("mắt quá thấp → hướng máy xuống", () => {
    const a = advise(person({ eyes: { x: 0.5, y: 0.5 }, head: 0.12 }))!;
    expect(a).toMatchObject({ hint: "eyes_low", move: "down" });
    expect(onTarget(a)).toBe(false);
  });

  it("mất đỉnh đầu → hướng máy lên", () => {
    expect(advise(person({ eyes: { x: 0.5, y: 0.05 }, head: 0.15 }))).toMatchObject({ hint: "head_cut", move: "up" });
  });

  it("mặt to sát khung mà vẫn mất đỉnh đầu → lùi ra", () => {
    expect(advise(person({ eyes: { x: 0.5, y: 0.2 }, head: 0.4 }))).toMatchObject({ hint: "head_cut", move: "back" });
  });

  it("cận mặt rất sát (đầu > nửa khung) → coi là chủ ý, không nhắc cắt đầu", () => {
    expect(advise(person({ eyes: { x: 0.5, y: 0.25 }, head: 0.6 }))?.hint).not.toBe("head_cut");
  });

  it("mép dưới cắt ngang đầu gối → lùi lại, đánh dấu chỗ cắt", () => {
    const a = advise(person({ eyes: { x: 0.5, y: 0.2 }, head: 0.15 }))!;
    expect(a).toMatchObject({ hint: "cut_joint", joint: "knee", move: "back" });
    expect(a.cutAt?.y).toBe(1);
  });

  it("mép trái cắt ngang cổ tay → xoay máy sang trái", () => {
    const a = advise(person({ eyes: { x: 0.118, y: 0.33 }, head: 0.15 }))!;
    expect(a).toMatchObject({ hint: "cut_joint", joint: "wrist", move: "left" });
    expect(a.cutAt?.x).toBe(0);
  });

  it("nhìn sang phải mà đứng sát bên phải → chừa khoảng trống phía trước mặt", () => {
    const a = advise(person({ eyes: { x: 0.7, y: 0.33 }, head: 0.15, facing: 1 }))!;
    expect(a).toMatchObject({ hint: "look_room", move: "right" });
    expect(a.target).toEqual({ x: 1 / 3, y: 1 / 3 });
  });

  it("nhìn sang trái và đứng bên phải → ổn", () => {
    expect(advise(person({ eyes: { x: 2 / 3, y: 0.33 }, head: 0.15, facing: -1 }))?.hint).toBeNull();
  });

  it("toàn thân đẹp → ổn, không có điểm đích cho mắt", () => {
    const a = advise(person({ eyes: { x: 0.5, y: 0.1 }, head: 0.105 }))!;
    expect(a.main.shot).toBe("full");
    expect(a.hint).toBeNull();
    expect(a.target).toBeUndefined();
  });

  it("toàn thân dư nhiều trời trên đầu → hướng máy xuống", () => {
    expect(advise(person({ eyes: { x: 0.5, y: 0.4 }, head: 0.04 }))).toMatchObject({ hint: "too_much_headroom", move: "down" });
  });

  it("toàn thân nhưng người quá nhỏ → tiến lại gần", () => {
    expect(advise(person({ eyes: { x: 0.5, y: 0.2 }, head: 0.04 }))).toMatchObject({ hint: "too_small", move: "closer" });
  });

  it("nhiều người: người chính là người to nhất, nhưng ai bị cắt đầu cũng nhắc", () => {
    const main = person({ eyes: { x: 0.5, y: 0.33 }, head: 0.15 });
    const small = person({ eyes: { x: 0.85, y: 0.005 }, head: 0.05 });
    const a = advise(small, main)!;
    expect(a.main.headSize).toBeCloseTo(0.15, 3);
    expect(a).toMatchObject({ hint: "head_cut", move: "up" });
  });

  it("không có ai → null", () => {
    expect(adviseSubject([])).toBeNull();
  });

  it("điểm đích: nhìn thẳng → gần nhất trong 1/3, giữa, 2/3", () => {
    const p = toPerson(person({ eyes: { x: 0.3, y: 0.33 }, head: 0.15 }), g)!;
    expect(eyeTarget(p).x).toBeCloseTo(1 / 3, 5);
  });
});

describe("đường chân trời", () => {
  /** Frame w×h: trên sáng, dưới tối, ranh giới ở hàng `split`, kèm nhiễu nhẹ cố định */
  function frame(w: number, h: number, pixel: (x: number, y: number) => number) {
    const data = new Uint8ClampedArray(w * h * 4);
    let seed = 7;
    const noise = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31 - 0.5) * 16;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const v = pixel(x, y) + noise();
        data.set([v, v, v, 255], (y * w + x) * 4);
      }
    return data;
  }
  const W = 160;
  const H = 90;

  it("trời sáng / đất tối cắt đôi khung → tìm đúng độ cao, nhắc dời lên 1/3", () => {
    const y = estimateHorizon(frame(W, H, (_, y) => (y < 45 ? 200 : 70)), W, H)!;
    expect(y).toBeCloseTo(0.5, 1);
    expect(horizonHint(y)).toBe("horizon_center");
  });

  it("chân trời ở 1/3 dưới → khen", () => {
    const y = estimateHorizon(frame(W, H, (_, y) => (y < 60 ? 190 : 60)), W, H)!;
    expect(y).toBeCloseTo(2 / 3, 1);
    expect(horizonHint(y)).toBe("horizon_third");
  });

  it("không có ranh giới (đều màu, sáng trái tối phải, đất sáng hơn trời) → null", () => {
    expect(estimateHorizon(frame(W, H, () => 120), W, H)).toBeNull();
    expect(estimateHorizon(frame(W, H, (x) => (x < 80 ? 200 : 60)), W, H)).toBeNull();
    expect(estimateHorizon(frame(W, H, (_, y) => (y < 45 ? 60 : 200)), W, H)).toBeNull();
  });

  it("ranh giới xiên mạnh (không phải chân trời) → null", () => {
    expect(estimateHorizon(frame(W, H, (x, y) => (y < 10 + x * 0.45 ? 200 : 60)), W, H)).toBeNull();
  });
});

describe("MediaPipe", () => {
  it("phiên bản WASM tải từ CDN trùng với package.json", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    expect(pkg.dependencies["@mediapipe/tasks-vision"]).toBe(MEDIAPIPE_VERSION);
  });
});
