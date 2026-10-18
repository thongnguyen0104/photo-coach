/**
 * Test tích hợp luồng server với Postgres thật (PGlite trong RAM):
 * tạo ảnh → phân tích (AI giả) → cache → quota → lỗi & hoàn lượt → xoá.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import type { Db } from "@/lib/db";
import type { Storage } from "@/lib/storage";
import type { UploadRequest } from "@/lib/api-schemas";
import { cleanupOrphans, createPhotoUpload, deletePhoto, listHistory } from "@/lib/server/photos";
import { expireStaleAnalysis, PENDING_TIMEOUT_MS, runAnalysis, type AiProvider } from "@/lib/server/analyze";
import { getUsage } from "@/lib/server/quota";
import { AppError, errorResponse, storedErrorCode } from "@/lib/server/errors";
import { MAX_UPLOAD_BYTES } from "@/lib/api-schemas";
import { signStorageUrl, verifyStorageSignature } from "@/lib/storage/signing";

class MemoryStorage implements Storage {
  files = new Map<string, Uint8Array>();
  deleted: string[] = [];
  async presignPut(key: string, contentType: string) {
    return { url: `mem://${key}`, method: "PUT" as const, headers: { "Content-Type": contentType } };
  }
  async presignGet(key: string) {
    return `mem://${key}`;
  }
  async getBytes(key: string) {
    const f = this.files.get(key);
    if (!f) throw new Error("missing");
    return f;
  }
  async size(key: string) {
    return this.files.get(key)?.length ?? null;
  }
  async delete(key: string) {
    this.deleted.push(key);
    this.files.delete(key);
  }
}

const mockAi: AiProvider = { name: "mock", model: "mock", run: async ({ fallback }) => ({ output: fallback(), model: "mock" }) };
const failingAi: AiProvider = {
  name: "gemini",
  model: "x",
  run: async () => {
    throw new AppError("ai_failed", "boom");
  },
};

const stats = {
  sampleWidth: 800,
  sampleHeight: 600,
  histogram: { luma: [1], r: [1], g: [1], b: [1] },
  meanLuma: 120,
  medianLuma: 120,
  p2Luma: 10,
  p98Luma: 240,
  stdLuma: 50,
  clippedHighlights: 0.05,
  clippedShadows: 0,
  highlightGrid: Array(36).fill(0),
  shadowGrid: Array(36).fill(0),
  meanRgb: [120, 120, 120] as [number, number, number],
  warmth: 0,
  tint: 0,
  saturation: 0.3,
  sharpness: 100,
  sharpnessMax: 200,
  sharpestCell: 4,
};

const upload = (sha: string, extra: Partial<UploadRequest> = {}): UploadRequest => ({
  fileName: "a.jpg",
  mime: "image/jpeg",
  size: 1000,
  width: 6000,
  height: 4000,
  previewWidth: 1536,
  previewHeight: 1024,
  previewSize: 500,
  sha256: sha.repeat(64).slice(0, 64),
  rawMetadata: { ifd0: { Make: "Canon", Model: "EOS R6" }, exif: { ISO: 6400 }, gps: { latitude: 10.7, longitude: 106.6 } },
  stats,
  saveGps: false,
  ...extra,
});

let db: Db;
let storage: MemoryStorage;
let userId: string;

beforeEach(async () => {
  const client = new PGlite();
  const d = drizzle({ client, schema });
  await migrate(d, { migrationsFolder: "drizzle" });
  db = d as unknown as Db;
  storage = new MemoryStorage();
  const [u] = await db.insert(schema.users).values({ name: "T", email: "t@test" }).returning();
  userId = u.id;
});

async function uploadAndStore(sha: string, extra?: Partial<UploadRequest>) {
  const res = await createPhotoUpload({ db, storage, dailyQuota: 10 }, userId, upload(sha, extra));
  const [photo] = await db.select().from(schema.photos).where(eq(schema.photos.id, res.photoId));
  storage.files.set(photo.previewKey, new Uint8Array([1, 2, 3]));
  storage.files.set(photo.originalKey, new Uint8Array([1, 2, 3, 4]));
  return res;
}

describe("luồng upload → phân tích", () => {
  it("tạo ảnh, chuẩn hoá metadata ở server, bỏ GPS khi không đồng ý", async () => {
    const res = await uploadAndStore("a");
    expect(res.duplicate).toBe(false);
    expect(res.uploads!.original.url).toContain("/original.jpg");
    const [meta] = await db.select().from(schema.photoMetadata).where(eq(schema.photoMetadata.photoId, res.photoId));
    expect(meta.make).toBe("Canon");
    expect(meta.iso).toBe(6400);
    expect(meta.gpsLat).toBeNull();
    expect(meta.normalized.gps).toBeUndefined();
    expect(meta.raw).not.toHaveProperty("gps");
  });

  it("giữ GPS khi người dùng đồng ý", async () => {
    const res = await uploadAndStore("b", { saveGps: true });
    const [meta] = await db.select().from(schema.photoMetadata).where(eq(schema.photoMetadata.photoId, res.photoId));
    expect(meta.gpsLat).toBeCloseTo(10.7);
  });

  it("phân tích thành công, lần 2 dùng cache không tốn lượt", async () => {
    const { photoId } = await uploadAndStore("c");
    const deps = { db, storage, ai: mockAi, dailyQuota: 10 };
    const first = await runAnalysis(deps, userId, { photoId, locale: "vi", mode: "advanced" });
    expect(first.cached).toBe(false);

    const [row] = await db.select().from(schema.analyses).where(eq(schema.analyses.id, first.analysisId));
    expect(row.status).toBe("done");
    expect(row.result!.improvements[0].n).toBe(1);
    expect(row.facts!.map((f) => f.id)).toEqual(expect.arrayContaining(["high_iso", "highlights_clipped"]));

    const second = await runAnalysis(deps, userId, { photoId, locale: "vi", mode: "advanced" });
    expect(second).toEqual({ analysisId: first.analysisId, cached: true });
    expect(await getUsage(db, userId)).toBe(1);

    // Đổi chế độ → phân tích mới
    const third = await runAnalysis(deps, userId, { photoId, locale: "vi", mode: "basic" });
    expect(third.cached).toBe(false);
    expect(await getUsage(db, userId)).toBe(2);
  });

  it("upload lại cùng ảnh đã phân tích → duplicate, không cần upload", async () => {
    const { photoId } = await uploadAndStore("d");
    await runAnalysis({ db, storage, ai: mockAi, dailyQuota: 10 }, userId, { photoId, locale: "vi", mode: "basic" });
    const again = await createPhotoUpload({ db, storage, dailyQuota: 10 }, userId, upload("d"));
    expect(again).toEqual({ photoId, duplicate: true });
  });

  it("chặn khi hết lượt trong ngày", async () => {
    const deps = { db, storage, ai: mockAi, dailyQuota: 2 };
    for (const sha of ["e", "f"]) {
      const { photoId } = await uploadAndStore(sha);
      await runAnalysis(deps, userId, { photoId, locale: "en", mode: "basic" });
    }
    const { photoId } = await uploadAndStore("1");
    await expect(runAnalysis(deps, userId, { photoId, locale: "en", mode: "basic" })).rejects.toMatchObject({ code: "quota_exceeded" });
    await expect(createPhotoUpload({ db, storage, dailyQuota: 2 }, userId, upload("2"))).rejects.toMatchObject({ code: "quota_exceeded" });
  });

  it("AI lỗi → lưu trạng thái failed và hoàn lại lượt", async () => {
    const { photoId } = await uploadAndStore("3");
    await expect(runAnalysis({ db, storage, ai: failingAi, dailyQuota: 10 }, userId, { photoId, locale: "vi", mode: "basic" })).rejects.toMatchObject({
      code: "ai_failed",
    });
    const rows = await db.select().from(schema.analyses).where(eq(schema.analyses.photoId, photoId));
    expect(rows[0].status).toBe("failed");
    expect(rows[0].error).toBe("ai_failed: boom");
    expect(storedErrorCode(rows[0].error)).toBe("ai_failed");
    expect(await getUsage(db, userId)).toBe(0);
  });

  it("chưa upload preview → upload_missing", async () => {
    const res = await createPhotoUpload({ db, storage, dailyQuota: 10 }, userId, upload("4"));
    await expect(
      runAnalysis({ db, storage, ai: mockAi, dailyQuota: 10 }, userId, { photoId: res.photoId, locale: "vi", mode: "basic" }),
    ).rejects.toMatchObject({ code: "upload_missing" });
  });

  it("người khác không xem/phân tích được ảnh của mình", async () => {
    const { photoId } = await uploadAndStore("5");
    const [other] = await db.insert(schema.users).values({ email: "o@test" }).returning();
    await expect(runAnalysis({ db, storage, ai: mockAi, dailyQuota: 10 }, other.id, { photoId, locale: "vi", mode: "basic" })).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("lịch sử + xoá ảnh xoá cả file và dữ liệu", async () => {
    const { photoId } = await uploadAndStore("6");
    await runAnalysis({ db, storage, ai: mockAi, dailyQuota: 10 }, userId, { photoId, locale: "vi", mode: "basic" });
    expect((await listHistory(db, userId)).map((h) => h.photoId)).toEqual([photoId]);

    await deletePhoto({ db, storage }, userId, photoId);
    expect(storage.deleted).toHaveLength(2);
    expect(await listHistory(db, userId)).toEqual([]);
    expect(await db.select().from(schema.analyses)).toHaveLength(0);
  });

  it("file thật trên storage quá lớn → xoá ảnh, báo upload_too_large, không tốn lượt", async () => {
    const { photoId } = await uploadAndStore("7");
    const [photo] = await db.select().from(schema.photos).where(eq(schema.photos.id, photoId));
    storage.files.set(photo.originalKey, new Uint8Array(MAX_UPLOAD_BYTES + 1));
    await expect(runAnalysis({ db, storage, ai: mockAi, dailyQuota: 10 }, userId, { photoId, locale: "vi", mode: "basic" })).rejects.toMatchObject({
      code: "upload_too_large",
    });
    expect(await db.select().from(schema.photos)).toHaveLength(0);
    expect(storage.files.size).toBe(0);
    expect(await getUsage(db, userId)).toBe(0);
  });

  it("giới hạn số ảnh mới mỗi ngày", async () => {
    const deps = { db, storage, dailyQuota: 10, dailyUploads: 2 };
    await createPhotoUpload(deps, userId, upload("8"));
    await createPhotoUpload(deps, userId, upload("9"));
    await expect(createPhotoUpload(deps, userId, upload("a1"))).rejects.toMatchObject({ code: "too_many_uploads" });
  });

  it("dọn ảnh mồ côi (quá 1 giờ chưa phân tích xong), giữ ảnh đã phân tích", async () => {
    const kept = await uploadAndStore("b1");
    await runAnalysis({ db, storage, ai: mockAi, dailyQuota: 10 }, userId, { photoId: kept.photoId, locale: "vi", mode: "basic" });
    const orphan = await uploadAndStore("b2");
    const failed = await uploadAndStore("b3");
    await runAnalysis({ db, storage, ai: failingAi, dailyQuota: 10 }, userId, { photoId: failed.photoId, locale: "vi", mode: "basic" }).catch(() => {});

    expect(await cleanupOrphans({ db, storage }, userId)).toBe(0); // còn mới → chưa dọn
    expect(await cleanupOrphans({ db, storage }, userId, -60_000)).toBe(2); // giả lập "đã quá hạn"
    const left = await db.select({ id: schema.photos.id }).from(schema.photos);
    expect(left.map((r) => r.id)).toEqual([kept.photoId]);
    expect(storage.deleted).toHaveLength(4);
    expect(orphan.photoId).toBeDefined();
  });

  it("bản ghi pending bị treo → chuyển failed và hoàn lượt (chỉ 1 lần)", async () => {
    const { photoId } = await uploadAndStore("c1");
    const never: AiProvider = { name: "gemini", model: "x", run: () => new Promise(() => {}) };
    void runAnalysis({ db, storage, ai: never, dailyQuota: 10 }, userId, { photoId, locale: "vi", mode: "basic" });
    await new Promise((r) => setTimeout(r, 50));
    const [row] = await db.select().from(schema.analyses).where(eq(schema.analyses.photoId, photoId));
    expect(row.status).toBe("pending");
    expect(await getUsage(db, userId)).toBe(1);

    expect(await expireStaleAnalysis(db, row.id)).toBe(false); // chưa quá hạn
    expect(PENDING_TIMEOUT_MS).toBeGreaterThan(60_000);
    expect(await expireStaleAnalysis(db, row.id, -60_000)).toBe(true);
    expect(await expireStaleAnalysis(db, row.id, -60_000)).toBe(false);
    const [after] = await db.select().from(schema.analyses).where(eq(schema.analyses.id, row.id));
    expect(after.status).toBe("failed");
    expect(await getUsage(db, userId)).toBe(0);
  });

  it("không gửi chi tiết lỗi của AI cho người dùng", async () => {
    const res = errorResponse(new AppError("ai_failed", "Gemini 500: internal key=abc"));
    expect(await res.json()).toEqual({ error: "ai_failed", message: "ai_failed" });
  });
});

describe("chữ ký URL storage local", () => {
  it("hợp lệ / sai op / bị sửa / hết hạn", () => {
    const url = new URL(signStorageUrl("put", "u/1/p/original.jpg", 60), "http://x");
    const exp = url.searchParams.get("exp");
    const sig = url.searchParams.get("sig");
    expect(verifyStorageSignature("put", "u/1/p/original.jpg", exp, sig)).toBe(true);
    expect(verifyStorageSignature("get", "u/1/p/original.jpg", exp, sig)).toBe(false);
    expect(verifyStorageSignature("put", "u/2/p/original.jpg", exp, sig)).toBe(false);
    expect(verifyStorageSignature("put", "u/1/p/original.jpg", "1", sig)).toBe(false);
  });
});
