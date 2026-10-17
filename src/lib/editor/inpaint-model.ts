/**
 * Model xoá vật thể MI-GAN (Picsart AI Research, giấy phép MIT), bản ONNX đã gói sẵn tiền/hậu xử lý.
 * Ghim theo commit + kiểm tra SHA-256 để chắc chắn đúng file đã test.
 */
export const MODEL_URL =
  "https://huggingface.co/andraniksargsyan/migan/resolve/406830d0fa60666da0071c342ad2fbc8f30c5c64/migan_pipeline_v2.onnx";
export const MODEL_SHA256 = "6f1f3530a1a2324b19752018ce756088b07973cda8d7d890034ace5c8a48c40b";
export const MODEL_BYTES = 28_079_181;
export const MODEL_CACHE = "photo-coach-models-v1";

export type WorkerRequest =
  | { type: "load" }
  | { type: "run"; id: number; width: number; height: number; rgba: ArrayBuffer; mask: ArrayBuffer };

export type WorkerResponse =
  | { type: "progress"; loaded: number; total: number }
  | { type: "ready" }
  | { type: "result"; id: number; rgba: ArrayBuffer }
  | { type: "error"; id?: number; message: string };

/** Model đã nằm sẵn trong bộ nhớ trình duyệt chưa (để không bắt tải lại 28MB). */
export async function isModelCached(): Promise<boolean> {
  try {
    const cache = await caches.open(MODEL_CACHE);
    return !!(await cache.match(MODEL_URL));
  } catch {
    return false;
  }
}
