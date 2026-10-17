import "server-only";
import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { aiOutputSchema, type AiOutput } from "./types";

let client: GoogleGenAI | undefined;
const getClient = () => (client ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY!.trim() }));

// Gemini chỉ hỗ trợ một tập con JSON Schema; các ràng buộc khoảng giá trị làm request lỗi 400
const UNSUPPORTED_KEYS = new Set(["$schema", "additionalProperties", "~standard", "minimum", "maximum", "minItems", "maxItems"]);

export function toGeminiSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(toGeminiSchema);
  if (!node || typeof node !== "object") return node;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node)) {
    if (UNSUPPORTED_KEYS.has(k)) continue;
    out[k] = toGeminiSchema(v);
  }
  return out;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const responseJsonSchema = toGeminiSchema(z.toJSONSchema(aiOutputSchema));

export interface AiCallResult {
  output: AiOutput;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
}

export class AiError extends Error {
  constructor(
    message: string,
    readonly code: "rate_limited" | "invalid_output" | "provider_error",
  ) {
    super(message);
  }
}

export async function analyzeWithGemini(params: {
  model: string;
  image: Uint8Array;
  mimeType: string;
  systemInstruction: string;
  userPrompt: string;
}): Promise<AiCallResult> {
  const ai = getClient();
  const imagePart = { inlineData: { mimeType: params.mimeType, data: Buffer.from(params.image).toString("base64") } };
  let extra = "";
  let inputTokens = 0;
  let outputTokens = 0;

  const call = () =>
    ai.models.generateContent({
      model: params.model,
      contents: [{ role: "user", parts: [imagePart, { text: params.userPrompt + extra }] }],
      config: {
        systemInstruction: params.systemInstruction,
        responseMimeType: "application/json",
        responseJsonSchema,
        temperature: 0.4,
      },
    });

  // Thử tối đa 2 lần: lần 2 kèm lỗi validate để AI tự sửa
  for (let attempt = 1; attempt <= 2; attempt++) {
    let text: string | undefined;
    let modelVersion = params.model;
    try {
      let res;
      try {
        res = await call();
      } catch (err) {
        // 503 "high demand" thường chỉ thoáng qua → đợi chút rồi thử lại 1 lần
        if (!/\b503\b|UNAVAILABLE|overloaded|high demand/i.test(String(err))) throw err;
        await sleep(2000);
        res = await call();
      }
      text = res.text;
      modelVersion = res.modelVersion ?? params.model;
      inputTokens += res.usageMetadata?.promptTokenCount ?? 0;
      outputTokens += res.usageMetadata?.candidatesTokenCount ?? 0;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/\b(429|503)\b|RESOURCE_EXHAUSTED|UNAVAILABLE|quota|high demand/i.test(msg)) throw new AiError(msg, "rate_limited");
      throw new AiError(msg, "provider_error");
    }

    let json: unknown;
    try {
      json = JSON.parse(text ?? "");
    } catch {
      extra = "\n\nYour previous answer was not valid JSON. Return ONLY valid JSON matching the schema.";
      continue;
    }
    const parsed = aiOutputSchema.safeParse(json);
    if (parsed.success) return { output: parsed.data, model: modelVersion, inputTokens, outputTokens };
    extra = `\n\nYour previous answer failed validation:\n${z.prettifyError(parsed.error).slice(0, 1500)}\nFix these problems and return valid JSON.`;
  }
  throw new AiError("AI trả kết quả sai định dạng 2 lần liên tiếp", "invalid_output");
}
