import { z } from "zod";

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
export const MAX_PREVIEW_BYTES = 5 * 1024 * 1024;
export const ACCEPTED_MIME = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"] as const;

const statsSchema = z
  .object({
    sampleWidth: z.number(),
    sampleHeight: z.number(),
    histogram: z.object({ luma: z.array(z.number()), r: z.array(z.number()), g: z.array(z.number()), b: z.array(z.number()) }),
    meanLuma: z.number(),
    medianLuma: z.number(),
    p2Luma: z.number(),
    p98Luma: z.number(),
    stdLuma: z.number(),
    clippedHighlights: z.number(),
    clippedShadows: z.number(),
    highlightGrid: z.array(z.number()),
    shadowGrid: z.array(z.number()),
    meanRgb: z.tuple([z.number(), z.number(), z.number()]),
    warmth: z.number(),
    tint: z.number(),
    saturation: z.number(),
    sharpness: z.number(),
    sharpnessMax: z.number(),
    sharpestCell: z.number(),
  })
  .strict();

const dim = z.number().int().positive().max(40000);

export const uploadRequestSchema = z.object({
  fileName: z.string().min(1).max(200),
  mime: z.enum(ACCEPTED_MIME),
  size: z.number().int().positive().max(MAX_UPLOAD_BYTES),
  width: dim,
  height: dim,
  previewWidth: z.number().int().positive().max(2048),
  previewHeight: z.number().int().positive().max(2048),
  previewSize: z.number().int().positive().max(MAX_PREVIEW_BYTES),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  /** Metadata gốc (đã sanitize ở client). Server tự chuẩn hoá lại. */
  rawMetadata: z.record(z.string(), z.unknown()).nullable(),
  stats: statsSchema,
  saveGps: z.boolean(),
});
export type UploadRequest = z.infer<typeof uploadRequestSchema>;

export const analysisRequestSchema = z.object({
  photoId: z.uuid(),
  locale: z.enum(["vi", "en"]),
  mode: z.enum(["basic", "advanced"]),
});
export type AnalysisRequest = z.infer<typeof analysisRequestSchema>;

export type ApiErrorCode =
  | "unauthorized"
  | "invalid_input"
  | "not_found"
  | "quota_exceeded"
  | "upload_missing"
  | "ai_rate_limited"
  | "ai_failed"
  | "server_error";

export interface UploadResponse {
  photoId: string;
  /** true = ảnh này đã được phân tích trước đó → không cần upload lại */
  duplicate: boolean;
  uploads?: { original: { url: string; headers: Record<string, string> }; preview: { url: string; headers: Record<string, string> } };
}

export interface AnalysisResponse {
  analysisId: string;
  cached: boolean;
}
