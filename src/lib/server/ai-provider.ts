import "server-only";
import { config } from "@/lib/config";
import { AppError } from "./errors";
import type { AiProvider } from "./analyze";

export async function getAiProvider(): Promise<AiProvider> {
  if (config.ai === "mock") {
    return {
      name: "mock",
      model: "mock",
      async run({ fallback }) {
        await new Promise((r) => setTimeout(r, 600)); // giả lập độ trễ để thấy trạng thái "đang phân tích"
        return { output: fallback(), model: "mock" };
      },
    };
  }

  const { analyzeWithGemini, AiError } = await import("@/lib/analysis/gemini");
  const model = config.geminiModel;
  return {
    name: "gemini",
    model,
    async run({ image, systemInstruction, userPrompt }) {
      try {
        return await analyzeWithGemini({ model, image, mimeType: "image/jpeg", systemInstruction, userPrompt });
      } catch (err) {
        if (err instanceof AiError) {
          throw new AppError(err.code === "rate_limited" ? "ai_rate_limited" : "ai_failed", err.message);
        }
        throw err;
      }
    },
  };
}
