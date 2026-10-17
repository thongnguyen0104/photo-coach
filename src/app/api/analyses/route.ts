import { getDb } from "@/lib/db";
import { getStorage } from "@/lib/storage";
import { config } from "@/lib/config";
import { analysisRequestSchema } from "@/lib/api-schemas";
import { AppError, errorResponse } from "@/lib/server/errors";
import { getAiProvider } from "@/lib/server/ai-provider";
import { runAnalysis } from "@/lib/server/analyze";
import { requireUserId } from "@/lib/server/session";

// Gemini thường trả lời trong 5–20 giây; cho phép tới 60 giây (giới hạn gói Hobby)
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const userId = await requireUserId();
    const parsed = analysisRequestSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new AppError("invalid_input", parsed.error.issues[0]?.message);

    const result = await runAnalysis(
      { db: await getDb(), storage: await getStorage(), ai: await getAiProvider(), dailyQuota: config.dailyQuota },
      userId,
      parsed.data,
    );
    return Response.json(result);
  } catch (err) {
    return errorResponse(err);
  }
}
