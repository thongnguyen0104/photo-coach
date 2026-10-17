"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { isModelCached, type WorkerRequest, type WorkerResponse } from "./inpaint-model";

export type InpainterStatus =
  | { state: "idle"; cached: boolean | null }
  | { state: "loading"; loaded: number; total: number }
  | { state: "ready" }
  | { state: "error"; message: string };

type Pending = { resolve: (rgba: Uint8ClampedArray) => void; reject: (err: Error) => void };

/** Quản lý Web Worker xoá vật thể: tải model khi cần, gửi vùng ảnh + mask, nhận kết quả. */
export function useInpainter() {
  const [status, setStatusState] = useState<InpainterStatus>({ state: "idle", cached: null });
  // Bản sao trong ref để các hàm callback luôn đọc trạng thái mới nhất
  const statusRef = useRef<InpainterStatus>(status);
  const setStatus = useCallback((next: InpainterStatus | ((s: InpainterStatus) => InpainterStatus)) => {
    statusRef.current = typeof next === "function" ? next(statusRef.current) : next;
    setStatusState(statusRef.current);
  }, []);
  const workerRef = useRef<Worker | null>(null);
  const pending = useRef(new Map<number, Pending>());
  const loadWaiters = useRef<{ resolve: () => void; reject: (err: Error) => void }[]>([]);
  const nextId = useRef(1);

  useEffect(() => {
    let alive = true;
    isModelCached().then((cached) => alive && setStatus((s) => (s.state === "idle" ? { state: "idle", cached } : s)));
    return () => {
      alive = false;
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, [setStatus]);

  const getWorker = useCallback(() => {
    if (workerRef.current) return workerRef.current;
    const worker = new Worker(new URL("./inpaint.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const msg = e.data;
      if (msg.type === "progress") setStatus({ state: "loading", loaded: msg.loaded, total: msg.total });
      else if (msg.type === "ready") {
        setStatus({ state: "ready" });
        loadWaiters.current.splice(0).forEach((w) => w.resolve());
      } else if (msg.type === "result") {
        pending.current.get(msg.id)?.resolve(new Uint8ClampedArray(msg.rgba));
        pending.current.delete(msg.id);
      } else if (msg.id !== undefined) {
        pending.current.get(msg.id)?.reject(new Error(msg.message));
        pending.current.delete(msg.id);
      } else {
        setStatus({ state: "error", message: msg.message });
        loadWaiters.current.splice(0).forEach((w) => w.reject(new Error(msg.message)));
      }
    };
    worker.onerror = (e) => {
      const err = new Error(e.message || "worker_failed");
      setStatus({ state: "error", message: err.message });
      loadWaiters.current.splice(0).forEach((w) => w.reject(err));
      pending.current.forEach((p) => p.reject(err));
      pending.current.clear();
      worker.terminate();
      workerRef.current = null;
    };
    workerRef.current = worker;
    return worker;
  }, [setStatus]);

  /** Tải model (lần đầu ~28MB, các lần sau lấy từ bộ nhớ trình duyệt). */
  const load = useCallback(() => {
    return new Promise<void>((resolve, reject) => {
      const state = statusRef.current.state;
      if (state === "ready") return resolve();
      loadWaiters.current.push({ resolve, reject });
      if (state !== "loading") {
        setStatus({ state: "loading", loaded: 0, total: 0 });
        getWorker().postMessage({ type: "load" } satisfies WorkerRequest);
      }
    });
  }, [getWorker, setStatus]);

  /** Xoá vật thể trong 1 vùng ảnh. mask: 1 byte/pixel, 0 = xoá, 255 = giữ. Trả RGBA cùng kích thước. */
  const run = useCallback(
    async (image: ImageData, mask: Uint8Array): Promise<Uint8ClampedArray> => {
      await load();
      const id = nextId.current++;
      const rgba = image.data.slice().buffer;
      const maskBuf = mask.slice().buffer;
      return new Promise((resolve, reject) => {
        pending.current.set(id, { resolve, reject });
        getWorker().postMessage(
          { type: "run", id, width: image.width, height: image.height, rgba, mask: maskBuf } satisfies WorkerRequest,
          [rgba, maskBuf],
        );
      });
    },
    [getWorker, load],
  );

  return { status, load, run };
}
