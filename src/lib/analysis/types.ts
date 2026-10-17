import { z } from "zod";

export const CATEGORIES = [
  "composition",
  "crop",
  "subject",
  "exposure",
  "white_balance",
  "settings",
  "hdr",
  "focus",
] as const;
export type Category = (typeof CATEGORIES)[number];

export const SEVERITIES = ["low", "medium", "high"] as const;
export type Severity = (typeof SEVERITIES)[number];

export const GENRES = [
  "portrait",
  "landscape",
  "street",
  "food",
  "product",
  "architecture",
  "night",
  "macro",
  "event",
  "other",
] as const;

// Toạ độ: số nguyên 0–1000 chuẩn hoá theo chiều rộng (x) / chiều cao (y) của ảnh.
// Box theo quy ước của Gemini: [ymin, xmin, ymax, xmax].
// LƯU Ý: Gemini từ chối schema có minimum/maximum/minItems/maxItems (lỗi 400)
// → giới hạn chỉ ghi trong description; postprocess.ts kẹp giá trị và cắt độ dài mảng.
const coord = z.number().describe("0-1000");
const box = z.array(coord).describe("exactly 4 numbers [ymin, xmin, ymax, xmax], each 0-1000");
const point = z.object({ x: coord, y: coord }).describe("x, y in 0-1000");

/** Schema output AI — vừa dùng để ép Gemini trả đúng JSON, vừa để validate. */
export const aiOutputSchema = z.object({
  overallScore: z.number().describe("Overall photo score 0-100"),
  headline: z.string().describe("One short, warm, specific sentence summarising the photo"),
  summary: z.string().describe("2-4 sentences: genuine praise first, then the single most valuable improvement"),
  genre: z.enum(GENRES),
  scores: z
    .array(z.object({ category: z.enum(CATEGORIES), score: z.number().describe("0-100") }))
    .describe("One entry per category that applies to this photo"),
  strengths: z
    .array(
      z.object({
        title: z.string(),
        detail: z.string(),
        evidence: z.string().describe("Concrete visual evidence or measured number backing this praise"),
      }),
    )
    .describe("1-5 genuine strengths"),
  improvements: z
    .array(
      z.object({
        id: z.string().describe("short kebab-case id"),
        category: z.enum(CATEGORIES),
        severity: z.enum(SEVERITIES),
        title: z.string(),
        praiseFirst: z.string().describe("Genuine compliment about something related that already works"),
        suggestion: z.string().describe("'If you ... it would be even better because ...'"),
        howTo: z.string().describe("Concrete actionable steps (settings, angle, distance, editing values)"),
        marker: point.optional().describe("Where on the image this issue is"),
        box: box.optional(),
      }),
    )
    .describe("3-6 improvements ordered by impact (max 8)"),
  horizon: z
    .object({ x1: coord, y1: coord, x2: coord, y2: coord })
    .optional()
    .describe("Endpoints of the main horizon / dominant horizontal line, if any"),
  subjects: z
    .array(z.object({ label: z.string(), box, faceBox: box.optional() }))
    .describe("People / main subjects (max 10)"),
  suggestedCrop: z
    .object({ box, aspectRatio: z.string().describe("e.g. 4:5, 3:2, 16:9, 1:1"), reason: z.string() })
    .optional(),
  suggestedSettings: z
    .object({
      aperture: z.string().optional(),
      shutter: z.string().optional(),
      iso: z.string().optional(),
      exposureCompensation: z.string().optional(),
      hdr: z.boolean().optional(),
      editing: z.array(z.string()).optional().describe("Up to 6 editing adjustments with numbers, e.g. 'Highlights -40'"),
      notes: z.string(),
    })
    .optional(),
  nextShotTips: z.array(z.string()).describe("Exactly 3 short tips for the next shot"),
});

export type AiOutput = z.infer<typeof aiOutputSchema>;
export type Box = [number, number, number, number];

export interface Improvement extends Omit<AiOutput["improvements"][number], "box"> {
  /** Số thứ tự hiển thị trên ảnh (1, 2, 3…) */
  n: number;
  box?: Box;
}

/** Kết quả đã hậu xử lý — lưu vào DB và render lên UI. */
export interface AnalysisResult extends Omit<AiOutput, "improvements" | "horizon" | "subjects" | "suggestedCrop"> {
  improvements: Improvement[];
  horizon?: { x1: number; y1: number; x2: number; y2: number; tiltDeg: number };
  subjects: { label: string; box: Box; faceBox?: Box }[];
  suggestedCrop?: { box: Box; aspectRatio: string; reason: string };
}

export type FactSeverity = "positive" | "info" | "low" | "medium" | "high";

/** Số liệu đo được bằng code (không phải AI) — đưa vào prompt và hiển thị trên UI. */
export interface Fact {
  id: string;
  category: Category;
  severity: FactSeverity;
  values: Record<string, string | number>;
}
