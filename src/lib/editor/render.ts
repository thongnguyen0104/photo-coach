"use client";

import { toDisplayBlob, detectMimeFromType } from "@/lib/image/prepare";
import { applyAdjustments, type Adjustments } from "./adjust";
import { coverScale, fitPixels, type Rect } from "./geometry";

/** Safari iOS không vẽ được canvas lớn hơn ~16.7 triệu pixel (4096²). */
export const MAX_WORK_PIXELS = 4096 * 4096;

export function makeCanvas(width: number, height: number) {
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  return c;
}

export const ctx2d = (c: HTMLCanvasElement) => c.getContext("2d", { willReadFrequently: true })!;

/** Tải ảnh gốc (HEIC tự chuyển), xoay theo EXIF, thu nhỏ nếu vượt giới hạn canvas. */
export async function loadSourceImage(url: string, mime: string): Promise<HTMLCanvasElement> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = await toDisplayBlob(new File([await res.blob()], "original", { type: mime }), detectMimeFromType(mime));
  const bmp = await createImageBitmap(blob);
  const size = fitPixels(bmp.width, bmp.height, MAX_WORK_PIXELS);
  const canvas = makeCanvas(size.width, size.height);
  const g = ctx2d(canvas);
  g.imageSmoothingQuality = "high";
  g.drawImage(bmp, 0, 0, size.width, size.height);
  bmp.close();
  return canvas;
}

export function downscale(src: HTMLCanvasElement, maxEdge: number): HTMLCanvasElement {
  const scale = Math.min(1, maxEdge / Math.max(src.width, src.height));
  const out = makeCanvas(Math.max(1, Math.round(src.width * scale)), Math.max(1, Math.round(src.height * scale)));
  const g = ctx2d(out);
  g.imageSmoothingQuality = "high";
  g.drawImage(src, 0, 0, out.width, out.height);
  return out;
}

export interface RenderOptions {
  /** Độ, dương = theo chiều kim đồng hồ */
  rotate: number;
  /** Khung cắt 0–1 theo khung ảnh; null = cả ảnh */
  crop: Rect | null;
  adjustments: Adjustments;
}

/**
 * Vẽ ảnh đã xoay (phóng vừa đủ để không lộ góc trống) → cắt → chỉnh màu.
 * `maxEdge` giới hạn cạnh dài của kết quả (Infinity = độ phân giải thật).
 */
export function renderImage(src: HTMLCanvasElement, opts: RenderOptions, maxEdge = Infinity, into?: HTMLCanvasElement): HTMLCanvasElement {
  const W = src.width;
  const H = src.height;
  const crop = opts.crop ?? { x: 0, y: 0, w: 1, h: 1 };
  const cropW = crop.w * W;
  const cropH = crop.h * H;
  const scale = Math.min(1, maxEdge / Math.max(cropW, cropH));
  const outW = Math.max(1, Math.round(cropW * scale));
  const outH = Math.max(1, Math.round(cropH * scale));
  const out = into ?? makeCanvas(outW, outH);
  if (out.width !== outW || out.height !== outH) {
    out.width = outW;
    out.height = outH;
  }
  const g = ctx2d(out);
  g.save();
  g.imageSmoothingQuality = "high";
  g.scale(scale, scale);
  g.translate(-crop.x * W, -crop.y * H);
  if (opts.rotate) {
    g.translate(W / 2, H / 2);
    g.rotate((opts.rotate * Math.PI) / 180);
    const s = coverScale(W, H, opts.rotate);
    g.scale(s, s);
    g.translate(-W / 2, -H / 2);
  }
  g.drawImage(src, 0, 0);
  g.restore();

  const img = g.getImageData(0, 0, outW, outH);
  applyAdjustments(img.data, opts.adjustments);
  g.putImageData(img, 0, 0);
  return out;
}

export function canvasToBlob(c: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error("encode_failed"))), type, quality));
}

/** "IMG_1234.HEIC" → "IMG_1234-edited.jpg" */
export function editedFileName(fileName: string, ext: "jpg" | "png") {
  const base = fileName.replace(/\.[^.]+$/, "") || "photo";
  return `${base}-edited.${ext}`;
}
