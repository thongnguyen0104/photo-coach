"use client";

import { ACCEPTED_MIME, MAX_UPLOAD_BYTES } from "@/lib/api-schemas";
import { normalizeMetadata, sanitizeForJson, type NormalizedMetadata, type RawMetadata } from "./metadata";
import { computeImageStats, type ImageStats } from "./stats";

export const PREVIEW_MAX_EDGE = 1536;
const STATS_MAX_EDGE = 800;
const MAX_RAW_CLIENT = 1_000_000;

export type AcceptedMime = (typeof ACCEPTED_MIME)[number];

export interface PreparedImage {
  file: File;
  mime: AcceptedMime;
  /** object URL để hiển thị (HEIC đã được chuyển sang JPEG) */
  displayUrl: string;
  width: number;
  height: number;
  preview: Blob;
  previewWidth: number;
  previewHeight: number;
  stats: ImageStats;
  rawMetadata: RawMetadata | null;
  metadata: NormalizedMetadata;
  sha256: string;
}

export class PrepareError extends Error {
  constructor(readonly code: "unsupported" | "too_large" | "decode_failed") {
    super(code);
  }
}

const EXT_MIME: Record<string, AcceptedMime> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
};

/** Windows/một số trình duyệt để trống file.type với HEIC → đoán theo đuôi file. */
export function detectMime(file: File): AcceptedMime | null {
  if ((ACCEPTED_MIME as readonly string[]).includes(file.type)) return file.type as AcceptedMime;
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return EXT_MIME[ext] ?? null;
}

async function readRawMetadata(file: File): Promise<RawMetadata | null> {
  try {
    const exifr = (await import("exifr")).default;
    const segments = await exifr.parse(file, {
      tiff: true,
      ifd0: true,
      ifd1: false,
      exif: true,
      gps: true,
      interop: true,
      xmp: true,
      iptc: true,
      icc: true,
      jfif: true,
      ihdr: true,
      makerNote: false,
      userComment: true,
      mergeOutput: false,
      translateKeys: true,
      translateValues: true,
      reviveValues: true,
    } as never);
    if (!segments) return null;
    const out = segments as Record<string, unknown>;
    // Bổ sung toạ độ thập phân (exifr tính sẵn qua hàm gps)
    const gps = await exifr.gps(file).catch(() => undefined);
    if (gps && Number.isFinite(gps.latitude)) {
      out.gps = { ...((out.gps as object) ?? {}), latitude: gps.latitude, longitude: gps.longitude };
    }
    let raw = sanitizeForJson(out) as RawMetadata;
    if (JSON.stringify(raw).length > MAX_RAW_CLIENT) {
      raw = { ...raw };
      delete raw.xmp;
    }
    return raw;
  } catch {
    return null; // ảnh không có metadata hoặc định dạng exifr không đọc được (vd WebP)
  }
}

/** Mime đã lưu trong DB → AcceptedMime (mặc định JPEG). */
export function detectMimeFromType(type: string): AcceptedMime {
  return (ACCEPTED_MIME as readonly string[]).includes(type) ? (type as AcceptedMime) : "image/jpeg";
}

export async function toDisplayBlob(file: File, mime: AcceptedMime): Promise<Blob> {
  if (mime !== "image/heic" && mime !== "image/heif") return file;
  // Safari đọc được HEIC trực tiếp; trình duyệt khác cần chuyển sang JPEG
  try {
    const bmp = await createImageBitmap(file);
    bmp.close();
    return file;
  } catch {
    const heic2any = (await import("heic2any")).default;
    const out = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.92 });
    return Array.isArray(out) ? out[0] : out;
  }
}

function drawScaled(bmp: ImageBitmap, maxEdge: number) {
  const scale = Math.min(1, maxEdge / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bmp, 0, 0, w, h);
  return { canvas, ctx, w, h };
}

async function sha256Hex(file: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Đọc ảnh: metadata, kích thước thật, bản preview 1536px, số đo pixel, mã băm. */
export async function prepareImage(file: File): Promise<PreparedImage> {
  const mime = detectMime(file);
  if (!mime) throw new PrepareError("unsupported");
  if (file.size > MAX_UPLOAD_BYTES) throw new PrepareError("too_large");

  const [rawMetadata, displayBlob, sha256] = await Promise.all([
    readRawMetadata(file),
    toDisplayBlob(file, mime).catch(() => {
      throw new PrepareError("decode_failed");
    }),
    sha256Hex(file),
  ]);

  let bmp: ImageBitmap;
  try {
    // Mặc định trình duyệt xoay ảnh theo EXIF Orientation
    bmp = await createImageBitmap(displayBlob);
  } catch {
    throw new PrepareError("decode_failed");
  }

  const preview = drawScaled(bmp, PREVIEW_MAX_EDGE);
  const previewBlob = await new Promise<Blob>((resolve, reject) =>
    preview.canvas.toBlob((b) => (b ? resolve(b) : reject(new PrepareError("decode_failed"))), "image/jpeg", 0.86),
  );

  const small = drawScaled(bmp, STATS_MAX_EDGE);
  const pixels = small.ctx.getImageData(0, 0, small.w, small.h);
  const stats = computeImageStats(pixels.data, small.w, small.h);

  const result: PreparedImage = {
    file,
    mime,
    displayUrl: URL.createObjectURL(displayBlob),
    width: bmp.width,
    height: bmp.height,
    preview: previewBlob,
    previewWidth: preview.w,
    previewHeight: preview.h,
    stats,
    rawMetadata,
    metadata: normalizeMetadata(rawMetadata),
    sha256,
  };
  bmp.close();
  return result;
}

/** Upload bằng XHR để có % tiến trình (fetch chưa hỗ trợ upload progress). */
export function uploadWithProgress(
  url: string,
  body: Blob,
  headers: Record<string, string>,
  onProgress: (loaded: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => onProgress(e.loaded);
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed: HTTP ${xhr.status}`)));
    xhr.onerror = () => reject(new Error("Upload blocked (network/CORS)"));
    xhr.send(body);
  });
}
