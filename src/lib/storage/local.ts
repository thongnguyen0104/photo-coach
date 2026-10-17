import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import { signStorageUrl } from "./signing";
import type { Storage } from "./index";

/**
 * Chế độ local: lưu ảnh vào thư mục .data/storage trên máy.
 * URL upload/xem trỏ về route /api/local-storage (có chữ ký HMAC + hạn dùng),
 * mô phỏng đúng cách pre-signed URL của Oracle hoạt động.
 */
export const LOCAL_STORAGE_DIR = path.resolve(/*turbopackIgnore: true*/ process.env.LOCAL_STORAGE_DIR || ".data/storage");

export function localPath(key: string): string {
  const full = path.resolve(/*turbopackIgnore: true*/ LOCAL_STORAGE_DIR, key);
  if (!full.startsWith(LOCAL_STORAGE_DIR + path.sep)) throw new Error("Invalid key");
  return full;
}

export function createLocalStorage(): Storage {
  return {
    async presignPut(key, contentType, expiresInSec = 600) {
      return {
        url: signStorageUrl("put", key, expiresInSec),
        method: "PUT",
        headers: { "Content-Type": contentType },
      };
    },
    async presignGet(key, expiresInSec = 3600) {
      return signStorageUrl("get", key, expiresInSec);
    },
    async getBytes(key) {
      return new Uint8Array(await fs.readFile(/*turbopackIgnore: true*/ localPath(key)));
    },
    async delete(key) {
      await fs.rm(/*turbopackIgnore: true*/ localPath(key), { force: true });
    },
  };
}
