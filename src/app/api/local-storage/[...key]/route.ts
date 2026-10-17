import fs from "node:fs/promises";
import path from "node:path";
import { config } from "@/lib/config";
import { MAX_UPLOAD_BYTES } from "@/lib/api-schemas";
import { verifyStorageSignature } from "@/lib/storage/signing";
import { localPath } from "@/lib/storage/local";

/**
 * Chỉ dùng ở chế độ local (chưa cấu hình Oracle): mô phỏng pre-signed URL.
 * PUT = upload, GET = xem ảnh. Mọi request phải có chữ ký hợp lệ + chưa hết hạn.
 */

const CONTENT_TYPE: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".heic": "image/heic",
  ".heif": "image/heif",
};

async function resolve(req: Request, params: Promise<{ key: string[] }>, op: "get" | "put") {
  if (config.storage !== "local") return { error: new Response("Not found", { status: 404 }) };
  const { key: parts } = await params;
  const key = parts.map(decodeURIComponent).join("/");
  const url = new URL(req.url);
  if (url.searchParams.get("op") !== op || !verifyStorageSignature(op, key, url.searchParams.get("exp"), url.searchParams.get("sig"))) {
    return { error: new Response("Invalid or expired signature", { status: 403 }) };
  }
  return { file: localPath(key) };
}

export async function PUT(req: Request, { params }: { params: Promise<{ key: string[] }> }) {
  const { file, error } = await resolve(req, params, "put");
  if (error) return error;
  const body = new Uint8Array(await req.arrayBuffer());
  if (body.byteLength === 0 || body.byteLength > MAX_UPLOAD_BYTES) return new Response("Bad size", { status: 413 });
  await fs.mkdir(/*turbopackIgnore: true*/ path.dirname(file), { recursive: true });
  await fs.writeFile(/*turbopackIgnore: true*/ file, body);
  return new Response(null, { status: 200 });
}

export async function GET(req: Request, { params }: { params: Promise<{ key: string[] }> }) {
  const { file, error } = await resolve(req, params, "get");
  if (error) return error;
  try {
    const data = await fs.readFile(/*turbopackIgnore: true*/ file);
    return new Response(new Uint8Array(data), {
      headers: {
        "Content-Type": CONTENT_TYPE[path.extname(file).toLowerCase()] ?? "application/octet-stream",
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
