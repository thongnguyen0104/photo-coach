import { and, desc, eq } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { analyses, photoMetadata, photos } from "@/lib/db/schema";
import type { UploadRequest, UploadResponse } from "@/lib/api-schemas";
import { normalizeMetadata, stripGps, type RawMetadata } from "@/lib/image/metadata";
import { photoKeys, type Storage } from "@/lib/storage";
import { AppError } from "./errors";
import { getUsage } from "./quota";

const MAX_RAW_JSON = 300_000;

/** Giữ raw metadata trong giới hạn dung lượng: bỏ dần các nhóm nặng. */
function capRaw(raw: RawMetadata): RawMetadata | null {
  let out = raw;
  for (const heavy of ["xmp", "icc", "makerNote", "ifd1"]) {
    if (JSON.stringify(out).length <= MAX_RAW_JSON) return out;
    out = { ...out };
    delete out[heavy];
  }
  return JSON.stringify(out).length <= MAX_RAW_JSON ? out : null;
}

export async function createPhotoUpload(
  deps: { db: Db; storage: Storage; dailyQuota: number },
  userId: string,
  input: UploadRequest,
): Promise<UploadResponse> {
  const { db, storage } = deps;

  // Ảnh trùng (cùng sha256) đã phân tích thành công → dùng lại, khỏi upload
  const [dup] = await db
    .select({ id: photos.id })
    .from(photos)
    .innerJoin(analyses, and(eq(analyses.photoId, photos.id), eq(analyses.status, "done")))
    .where(and(eq(photos.userId, userId), eq(photos.sha256, input.sha256)))
    .orderBy(desc(photos.createdAt))
    .limit(1);
  if (dup) return { photoId: dup.id, duplicate: true };

  if ((await getUsage(db, userId)) >= deps.dailyQuota) throw new AppError("quota_exceeded");

  const raw = (input.rawMetadata ?? {}) as RawMetadata;
  const normalized = normalizeMetadata(raw);
  if (!input.saveGps) delete normalized.gps;
  const storedRaw = capRaw(input.saveGps ? raw : stripGps(raw));

  const photoId = crypto.randomUUID();
  const keys = photoKeys(userId, photoId, input.mime);

  await db.insert(photos).values({
    id: photoId,
    userId,
    fileName: input.fileName,
    mime: input.mime,
    sizeBytes: input.size,
    width: input.width,
    height: input.height,
    previewWidth: input.previewWidth,
    previewHeight: input.previewHeight,
    sha256: input.sha256,
    originalKey: keys.original,
    previewKey: keys.preview,
  });
  await db.insert(photoMetadata).values({
    photoId,
    make: normalized.make,
    model: normalized.model,
    lensModel: normalized.lensModel,
    fNumber: normalized.fNumber,
    exposureTime: normalized.exposureTime,
    iso: normalized.iso,
    focalLength: normalized.focalLength,
    focalLength35: normalized.focalLength35,
    exposureBias: normalized.exposureBias,
    whiteBalance: normalized.whiteBalance,
    meteringMode: normalized.meteringMode,
    flash: normalized.flash,
    takenAt: normalized.takenAt ? new Date(normalized.takenAt) : null,
    software: normalized.software,
    gpsLat: normalized.gps?.lat,
    gpsLng: normalized.gps?.lng,
    normalized,
    raw: storedRaw,
    stats: input.stats,
  });

  const [original, preview] = await Promise.all([
    storage.presignPut(keys.original, input.mime),
    storage.presignPut(keys.preview, "image/jpeg"),
  ]);
  return { photoId, duplicate: false, uploads: { original, preview } };
}

export async function getOwnedPhoto(db: Db, userId: string, photoId: string) {
  const [row] = await db
    .select()
    .from(photos)
    .innerJoin(photoMetadata, eq(photoMetadata.photoId, photos.id))
    .where(and(eq(photos.id, photoId), eq(photos.userId, userId)));
  if (!row) throw new AppError("not_found");
  return { photo: row.photos, meta: row.photo_metadata };
}

export async function getOwnedAnalysis(db: Db, userId: string, analysisId: string) {
  const [row] = await db
    .select()
    .from(analyses)
    .innerJoin(photos, eq(photos.id, analyses.photoId))
    .innerJoin(photoMetadata, eq(photoMetadata.photoId, photos.id))
    .where(and(eq(analyses.id, analysisId), eq(analyses.userId, userId)));
  if (!row) return null;
  return { analysis: row.analyses, photo: row.photos, meta: row.photo_metadata };
}

export async function deletePhoto(deps: { db: Db; storage: Storage }, userId: string, photoId: string) {
  const { photo } = await getOwnedPhoto(deps.db, userId, photoId);
  // Xoá file trước; lỗi (vd file chưa từng upload) thì bỏ qua
  await Promise.allSettled([deps.storage.delete(photo.originalKey), deps.storage.delete(photo.previewKey)]);
  await deps.db.delete(photos).where(and(eq(photos.id, photoId), eq(photos.userId, userId)));
}

export interface HistoryItem {
  photoId: string;
  analysisId: string;
  fileName: string;
  overallScore: number | null;
  headline: string | null;
  mode: string;
  createdAt: Date;
  previewKey: string;
  width: number;
  height: number;
}

/** Danh sách ảnh đã phân tích (mỗi ảnh lấy lần phân tích mới nhất). */
export async function listHistory(db: Db, userId: string, limit = 60): Promise<HistoryItem[]> {
  const rows = await db
    .select({
      photoId: photos.id,
      analysisId: analyses.id,
      fileName: photos.fileName,
      overallScore: analyses.overallScore,
      result: analyses.result,
      mode: analyses.mode,
      createdAt: analyses.createdAt,
      previewKey: photos.previewKey,
      width: photos.width,
      height: photos.height,
    })
    .from(analyses)
    .innerJoin(photos, eq(photos.id, analyses.photoId))
    .where(and(eq(analyses.userId, userId), eq(analyses.status, "done")))
    .orderBy(desc(analyses.createdAt))
    .limit(limit * 3);

  const seen = new Set<string>();
  const out: HistoryItem[] = [];
  for (const r of rows) {
    if (seen.has(r.photoId)) continue;
    seen.add(r.photoId);
    out.push({ ...r, headline: r.result?.headline ?? null });
    if (out.length >= limit) break;
  }
  return out;
}
