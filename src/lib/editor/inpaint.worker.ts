/// <reference lib="webworker" />
/**
 * Web Worker xoá vật thể: chạy model MI-GAN (ONNX) bằng onnxruntime-web,
 * tách khỏi luồng giao diện để trang không bị đơ khi model đang tính.
 */
import * as ort from "onnxruntime-web/wasm";
import { MODEL_CACHE, MODEL_SHA256, MODEL_URL, type WorkerRequest, type WorkerResponse } from "./inpaint-model";

declare const self: DedicatedWorkerGlobalScope;

// File .wasm lấy từ CDN đúng phiên bản đang cài → không phải cấu hình bundler
ort.env.wasm.wasmPaths = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ort.env.versions.web}/dist/`;
// Trang không bật cross-origin isolation → chỉ chạy được 1 luồng
ort.env.wasm.numThreads = 1;

let session: Promise<ort.InferenceSession> | undefined;

const post = (msg: WorkerResponse, transfer: Transferable[] = []) => self.postMessage(msg, transfer);

async function sha256Hex(buf: ArrayBuffer) {
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Tải model (có % tiến trình), kiểm tra mã băm, lưu vào Cache Storage cho lần sau. */
async function fetchModel(): Promise<ArrayBuffer> {
  const cache = await caches.open(MODEL_CACHE).catch(() => undefined);
  const cached = await cache?.match(MODEL_URL);
  if (cached) {
    const buf = await cached.arrayBuffer();
    if ((await sha256Hex(buf)) === MODEL_SHA256) return buf;
    await cache?.delete(MODEL_URL); // file hỏng → tải lại
  }

  const res = await fetch(MODEL_URL);
  if (!res.ok || !res.body) throw new Error(`model_download_failed: HTTP ${res.status}`);
  const total = Number(res.headers.get("Content-Length")) || 0;
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    post({ type: "progress", loaded, total });
  }
  const buf = new Uint8Array(loaded);
  let offset = 0;
  for (const c of chunks) {
    buf.set(c, offset);
    offset += c.byteLength;
  }
  if ((await sha256Hex(buf.buffer)) !== MODEL_SHA256) throw new Error("model_checksum_mismatch");
  await cache?.put(MODEL_URL, new Response(buf.slice().buffer, { headers: { "Content-Type": "application/octet-stream" } })).catch(() => {});
  return buf.buffer;
}

function getSession() {
  session ??= fetchModel().then((buf) => ort.InferenceSession.create(buf, { executionProviders: ["wasm"] }));
  session.catch(() => (session = undefined)); // lỗi mạng → lần sau thử lại
  return session;
}

/**
 * Model nhận ảnh uint8 [1,3,H,W] và mask uint8 [1,1,H,W] (0 = vùng cần xoá, 255 = giữ),
 * trả ảnh [1,3,H,W]; phần ngoài vùng xoá giữ nguyên từng pixel.
 */
async function inpaint(width: number, height: number, rgba: Uint8ClampedArray, mask: Uint8Array) {
  const s = await getSession();
  const n = width * height;
  const chw = new Uint8Array(3 * n);
  for (let i = 0; i < n; i++) {
    chw[i] = rgba[i * 4];
    chw[n + i] = rgba[i * 4 + 1];
    chw[2 * n + i] = rgba[i * 4 + 2];
  }
  const out = await s.run({
    image: new ort.Tensor("uint8", chw, [1, 3, height, width]),
    mask: new ort.Tensor("uint8", mask, [1, 1, height, width]),
  });
  const result = out[s.outputNames[0]].data as Uint8Array;
  for (let i = 0; i < n; i++) {
    rgba[i * 4] = result[i];
    rgba[i * 4 + 1] = result[n + i];
    rgba[i * 4 + 2] = result[2 * n + i];
  }
  return rgba;
}

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;
  try {
    if (msg.type === "load") {
      await getSession();
      post({ type: "ready" });
    } else {
      const rgba = await inpaint(msg.width, msg.height, new Uint8ClampedArray(msg.rgba), new Uint8Array(msg.mask));
      post({ type: "result", id: msg.id, rgba: rgba.buffer as ArrayBuffer }, [rgba.buffer]);
    }
  } catch (err) {
    post({ type: "error", id: msg.type === "run" ? msg.id : undefined, message: err instanceof Error ? err.message : String(err) });
  }
};
