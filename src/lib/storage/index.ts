import "server-only";
import { config } from "@/lib/config";

export interface PresignedUpload {
  url: string;
  method: "PUT";
  headers: Record<string, string>;
}

export interface Storage {
  /** URL để trình duyệt upload thẳng (không đi qua server Vercel). */
  presignPut(key: string, contentType: string, expiresInSec?: number): Promise<PresignedUpload>;
  /** URL xem/tải file có hạn dùng. */
  presignGet(key: string, expiresInSec?: number): Promise<string>;
  getBytes(key: string): Promise<Uint8Array>;
  /** Dung lượng thật của file đã upload (byte); null nếu chưa có file. */
  size(key: string): Promise<number | null>;
  delete(key: string): Promise<void>;
}

let instance: Storage | undefined;

export async function getStorage(): Promise<Storage> {
  if (instance) return instance;
  if (config.storage === "oci") {
    const { createOciStorage } = await import("./oci");
    instance = createOciStorage();
  } else {
    const { createLocalStorage } = await import("./local");
    instance = createLocalStorage();
  }
  return instance;
}

const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
};

export const photoKeys = (userId: string, photoId: string, mime: string) => ({
  original: `u/${userId}/${photoId}/original.${EXT[mime] ?? "bin"}`,
  preview: `u/${userId}/${photoId}/preview.jpg`,
});
