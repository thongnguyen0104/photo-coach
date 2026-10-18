"use client";

import { aspectRect, type Aspect } from "./frame";

export class CameraError extends Error {
  constructor(readonly code: "camera_unsupported" | "camera_denied" | "camera_not_found" | "camera_busy" | "camera_failed") {
    super(code);
  }
}

export const cameraSupported = () => typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia;

/** Mở camera sau, độ phân giải cao nhất có thể (máy không có camera sau thì dùng camera bất kỳ). */
export async function openCamera(): Promise<MediaStream> {
  if (!cameraSupported()) throw new CameraError("camera_unsupported");
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: "environment" }, width: { ideal: 3840 }, height: { ideal: 2160 } },
    });
  } catch (err) {
    const name = (err as DOMException)?.name;
    if (name === "NotAllowedError" || name === "SecurityError") throw new CameraError("camera_denied");
    if (name === "NotFoundError" || name === "OverconstrainedError") throw new CameraError("camera_not_found");
    if (name === "NotReadableError" || name === "AbortError") throw new CameraError("camera_busy");
    throw new CameraError("camera_failed");
  }
}

export function stopStream(stream: MediaStream | null | undefined) {
  stream?.getTracks().forEach((t) => t.stop());
}

interface ImageCaptureLike {
  takePhoto(): Promise<Blob>;
}

/**
 * Ảnh chất lượng cao bằng ImageCapture.takePhoto() (Chrome Android).
 * Chỉ dùng khi ảnh cùng hướng (dọc/ngang) với video — một số máy trả ảnh chưa xoay.
 */
async function takeStill(track: MediaStreamTrack, video: HTMLVideoElement): Promise<ImageBitmap | null> {
  const Ctor = (globalThis as { ImageCapture?: new (t: MediaStreamTrack) => ImageCaptureLike }).ImageCapture;
  if (!Ctor) return null;
  try {
    const blob = await new Ctor(track).takePhoto();
    const bmp = await createImageBitmap(blob);
    const sameOrientation = bmp.width >= bmp.height === video.videoWidth >= video.videoHeight;
    // Ảnh tĩnh phải lớn hơn frame video mới đáng dùng
    if (sameOrientation && bmp.width * bmp.height > video.videoWidth * video.videoHeight) return bmp;
    bmp.close();
  } catch {
    // máy không hỗ trợ → dùng frame video
  }
  return null;
}

/** Ngày giờ dạng 20261018-142530 cho tên file. */
const stamp = (d = new Date()) =>
  `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}-` +
  `${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}${String(d.getSeconds()).padStart(2, "0")}`;

/**
 * Chụp 1 tấm: cắt đúng phần đang thấy trên màn hình (tỉ lệ video), rồi theo tỉ lệ khung đã chọn.
 */
export async function capturePhoto(video: HTMLVideoElement, track: MediaStreamTrack | undefined, aspect: Aspect): Promise<File> {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) throw new CameraError("camera_failed");

  const still = track ? await takeStill(track, video) : null;
  const src: CanvasImageSource = still ?? video;
  const sw = still?.width ?? vw;
  const sh = still?.height ?? vh;

  // Ảnh tĩnh có thể rộng hơn video (4:3 so với 16:9) → cắt giữa theo tỉ lệ video
  const videoRatio = vw / vh;
  let bw = sw;
  let bh = Math.round(sw / videoRatio);
  if (bh > sh) {
    bh = sh;
    bw = Math.round(sh * videoRatio);
  }
  const base = { x: (sw - bw) / 2, y: (sh - bh) / 2 };
  const r = aspectRect(bw, bh, aspect);

  const canvas = document.createElement("canvas");
  canvas.width = r.w;
  canvas.height = r.h;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(src, base.x + r.x, base.y + r.y, r.w, r.h, 0, 0, r.w, r.h);
  still?.close();

  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new CameraError("camera_failed"))), "image/jpeg", 0.92),
  );
  return new File([blob], `photo-coach-${stamp()}.jpg`, { type: "image/jpeg", lastModified: Date.now() });
}

/** Thiết bị di động? (để AI dùng ngưỡng của điện thoại) */
export function isMobileDevice(): boolean {
  const uaData = (navigator as { userAgentData?: { mobile?: boolean } }).userAgentData;
  if (typeof uaData?.mobile === "boolean") return uaData.mobile;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
}

/** iOS 13+ bắt xin quyền cảm biến hướng — phải gọi trong lúc người dùng bấm nút. Chrome có thể trả "prompt" mà vẫn gửi dữ liệu. */
export async function requestOrientationPermission(): Promise<boolean> {
  const Ctor = (globalThis as { DeviceOrientationEvent?: { requestPermission?: () => Promise<"granted" | "denied"> } }).DeviceOrientationEvent;
  if (!Ctor) return false;
  if (typeof Ctor.requestPermission !== "function") return true;
  try {
    return (await Ctor.requestPermission()) === "granted";
  } catch {
    return false;
  }
}
