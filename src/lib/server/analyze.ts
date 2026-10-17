import { and, desc, eq } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { analyses } from "@/lib/db/schema";
import type { AnalysisRequest, AnalysisResponse } from "@/lib/api-schemas";
import type { Storage } from "@/lib/storage";
import { deriveFacts } from "@/lib/analysis/facts";
import { mockAnalysis } from "@/lib/analysis/mock";
import { postprocess } from "@/lib/analysis/postprocess";
import { buildSystemInstruction, buildUserPrompt, PROMPT_VERSION } from "@/lib/analysis/prompt";
import type { AiOutput } from "@/lib/analysis/types";
import { AppError } from "./errors";
import { getOwnedPhoto } from "./photos";
import { consumeQuota, refundQuota } from "./quota";

export interface AiProvider {
  name: "gemini" | "mock";
  model: string;
  run(input: {
    image: Uint8Array;
    systemInstruction: string;
    userPrompt: string;
    fallback: () => AiOutput;
  }): Promise<{ output: AiOutput; model: string; inputTokens?: number; outputTokens?: number }>;
}

export interface AnalyzeDeps {
  db: Db;
  storage: Storage;
  ai: AiProvider;
  dailyQuota: number;
}

export async function runAnalysis(deps: AnalyzeDeps, userId: string, req: AnalysisRequest): Promise<AnalysisResponse> {
  const { db, storage, ai } = deps;
  const { photo, meta } = await getOwnedPhoto(db, userId, req.photoId);

  // Đã có kết quả cùng cấu hình → trả lại, không tốn lượt
  const [cached] = await db
    .select({ id: analyses.id })
    .from(analyses)
    .where(
      and(
        eq(analyses.photoId, photo.id),
        eq(analyses.status, "done"),
        eq(analyses.mode, req.mode),
        eq(analyses.locale, req.locale),
        eq(analyses.promptVersion, PROMPT_VERSION),
        eq(analyses.provider, ai.name),
      ),
    )
    .orderBy(desc(analyses.createdAt))
    .limit(1);
  if (cached) return { analysisId: cached.id, cached: true };

  if (!(await consumeQuota(db, userId, deps.dailyQuota))) throw new AppError("quota_exceeded");

  const facts = deriveFacts(meta.normalized, meta.stats);
  const [row] = await db
    .insert(analyses)
    .values({
      photoId: photo.id,
      userId,
      status: "pending",
      provider: ai.name,
      model: ai.model,
      promptVersion: PROMPT_VERSION,
      locale: req.locale,
      mode: req.mode,
      facts,
    })
    .returning({ id: analyses.id });

  const started = Date.now();
  try {
    let image: Uint8Array;
    try {
      image = await storage.getBytes(photo.previewKey);
    } catch {
      throw new AppError("upload_missing", "Preview image not found in storage");
    }

    const res = await ai.run({
      image,
      systemInstruction: buildSystemInstruction(req.locale, req.mode),
      userPrompt: buildUserPrompt({ meta: meta.normalized, stats: meta.stats, facts, width: photo.width, height: photo.height }),
      fallback: () => mockAnalysis(facts, meta.stats, req.locale, req.mode),
    });
    const result = postprocess(res.output, photo.width, photo.height);

    await db
      .update(analyses)
      .set({
        status: "done",
        model: res.model,
        result,
        overallScore: result.overallScore,
        latencyMs: Date.now() - started,
        inputTokens: res.inputTokens,
        outputTokens: res.outputTokens,
      })
      .where(eq(analyses.id, row.id));
    return { analysisId: row.id, cached: false };
  } catch (err) {
    await db
      .update(analyses)
      .set({ status: "failed", error: err instanceof Error ? err.message.slice(0, 1000) : String(err), latencyMs: Date.now() - started })
      .where(eq(analyses.id, row.id));
    await refundQuota(db, userId);
    throw err;
  }
}
