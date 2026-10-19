"use client";

/**
 * Nhận diện người ngay trên trình duyệt bằng MediaPipe Tasks Vision (Google, Apache-2.0).
 * Chỉ tải khi bật chế độ Chân dung: ~3MB WASM + ~6MB model, trình duyệt lưu cache cho lần sau.
 * Ảnh không rời khỏi máy.
 */
import type { Landmark, PersonObservation } from "./subject";

/** Phải trùng phiên bản trong package.json (có test kiểm tra) — file WASM tải từ CDN theo đúng bản này. */
export const MEDIAPIPE_VERSION = "1.0.1";
const WASM_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm`;
export const POSE_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";
export const FACE_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite";

export interface PeopleDetector {
  /** `src` là frame đã thu nhỏ; `timestamp` (ms) phải tăng dần giữa các lần gọi. */
  detect(src: HTMLCanvasElement, timestamp: number): PersonObservation[];
}

/** Chỉ khi chạy dev/test: E2E gán mảng người giả vào đây để không phụ thuộc model thật. */
declare global {
  interface Window {
    __PHOTO_COACH_FAKE_PEOPLE__?: PersonObservation[];
  }
}

let loading: Promise<PeopleDetector> | null = null;

/** Tải 1 lần cho cả phiên; lỗi thì lần sau thử lại. */
export function loadPeopleDetector(): Promise<PeopleDetector> {
  if (process.env.NODE_ENV !== "production" && window.__PHOTO_COACH_FAKE_PEOPLE__) {
    return Promise.resolve({ detect: () => window.__PHOTO_COACH_FAKE_PEOPLE__ ?? [] });
  }
  loading ??= create().catch((err) => {
    loading = null;
    throw err;
  });
  return loading;
}

async function create(): Promise<PeopleDetector> {
  const { FilesetResolver, FaceDetector, PoseLandmarker } = await import("@mediapipe/tasks-vision");
  const fileset = await FilesetResolver.forVisionTasks(WASM_BASE);

  const make = (delegate: "GPU" | "CPU") =>
    Promise.all([
      PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: POSE_MODEL_URL, delegate },
        runningMode: "VIDEO",
        numPoses: 3,
      }),
      FaceDetector.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: FACE_MODEL_URL, delegate },
        runningMode: "VIDEO",
        minDetectionConfidence: 0.6,
      }),
    ]);

  // GPU nhanh hơn nhiều trên điện thoại; máy không có WebGL2 → CPU
  let pose, face;
  try {
    [pose, face] = await make("GPU");
  } catch {
    [pose, face] = await make("CPU");
  }

  return {
    detect(src, timestamp) {
      const found = pose.detectForVideo(src, timestamp).landmarks;
      if (found.length) return found.map((l) => ({ pose: l as Landmark[] }));
      // Cận mặt quá sát thì không thấy vai/thân → thử bộ nhận diện khuôn mặt
      return face
        .detectForVideo(src, timestamp)
        .detections.filter((d) => d.keypoints.length >= 6)
        .map((d) => ({ face: d.keypoints.map((k) => ({ x: k.x, y: k.y })) }));
    },
  };
}
