// Gemini adapter (text + image) over the generateContent REST endpoint.
// Docs checked 2026-10-03:
//  - https://ai.google.dev/gemini-api/docs/models                          (model IDs, GA status)
//  - https://ai.google.dev/api/generate-content                            (request/response, finishReason)
//  - https://ai.google.dev/gemini-api/docs/generate-content/thinking       (thinkingConfig)
//  - https://ai.google.dev/gemini-api/docs/image-generation                (image models, aspect ratios)
//  - https://ai.google.dev/gemini-api/docs/migrate-to-interactions         (generateContent stays supported)
// The API key goes in the x-goog-api-key header, never in the URL.

import type {
  GeneratedImage,
  ImageGenerationRequest,
  ImageModel,
  TextGenerationRequest,
  TextModel,
} from "../types";
import {
  DEFAULT_IMAGE_TIMEOUT_MS,
  DEFAULT_TEXT_TIMEOUT_MS,
  LlmError,
  base64ToBytes,
  postJson,
  truncate,
  type HttpOptions,
} from "./http";

export const DEFAULT_GEMINI_TEXT_MODEL = "gemini-3.8-flash";
export const DEFAULT_GEMINI_IMAGE_MODEL = "gemini-3.1-flash-image";

const PROVIDER = "gemini";
const API_ROOT = "https://generativelanguage.googleapis.com/v1beta/models";

interface GeminiPart {
  text?: string;
  /** True for reasoning content and interim images, which are not part of the answer. */
  thought?: boolean;
  inlineData?: { mimeType?: string; data?: string };
}

interface GeminiResponse {
  candidates?: { content?: { parts?: GeminiPart[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
}

function endpoint(model: string): string {
  return `${API_ROOT}/${encodeURIComponent(model.replace(/^models\//, ""))}:generateContent`;
}

/**
 * Keep reasoning short: thinking tokens count against maxOutputTokens and add
 * latency, and article writing gains little from them. Unknown models get no
 * thinkingConfig, because an unsupported field is a 400.
 */
function thinkingConfig(model: string): Record<string, unknown> | undefined {
  if (/^gemini-3/.test(model)) return { thinkingLevel: "low" };
  if (/^gemini-2\.5-flash/.test(model)) return { thinkingBudget: 0 };
  return undefined;
}

async function generateContent(
  apiKey: string,
  model: string,
  body: Record<string, unknown>,
  http: HttpOptions,
): Promise<{ parts: GeminiPart[]; finishReason?: string }> {
  const json = (await postJson({
    provider: PROVIDER,
    url: endpoint(model),
    headers: { "x-goog-api-key": apiKey },
    body,
    apiKey,
    ...http,
  })) as GeminiResponse;

  const candidate = json.candidates?.[0];
  if (!candidate) {
    const reason = json.promptFeedback?.blockReason;
    throw new LlmError(
      PROVIDER,
      reason ? `prompt was blocked (${reason})` : "response contained no candidates",
    );
  }
  return { parts: candidate.content?.parts ?? [], finishReason: candidate.finishReason };
}

export function createGeminiTextModel(
  apiKey: string,
  model: string,
  options: HttpOptions = {},
): TextModel {
  const http = { timeoutMs: DEFAULT_TEXT_TIMEOUT_MS, ...options };

  return {
    provider: "gemini",
    model,
    async generate(req: TextGenerationRequest): Promise<string> {
      const generationConfig: Record<string, unknown> = {};
      if (req.temperature !== undefined) generationConfig.temperature = req.temperature;
      if (req.maxOutputTokens !== undefined) generationConfig.maxOutputTokens = req.maxOutputTokens;
      if (req.json) generationConfig.responseMimeType = "application/json";
      const thinking = thinkingConfig(model);
      if (thinking) generationConfig.thinkingConfig = thinking;

      const body: Record<string, unknown> = {
        contents: [{ role: "user", parts: [{ text: req.prompt }] }],
        generationConfig,
      };
      if (req.system) body.systemInstruction = { parts: [{ text: req.system }] };

      const { parts, finishReason } = await generateContent(apiKey, model, body, http);

      if (finishReason === "MAX_TOKENS") {
        throw new LlmError(
          PROVIDER,
          "output was cut off (finishReason=MAX_TOKENS); raise maxOutputTokens",
        );
      }
      if (finishReason && finishReason !== "STOP") {
        throw new LlmError(PROVIDER, `generation stopped (finishReason=${finishReason})`);
      }

      const text = parts
        .filter((part) => !part.thought && typeof part.text === "string")
        .map((part) => part.text)
        .join("");
      if (!text.trim()) {
        throw new LlmError(PROVIDER, "model returned no text", { retryable: true });
      }
      return text;
    },
  };
}

export function createGeminiImageModel(
  apiKey: string,
  model: string,
  options: HttpOptions = {},
): ImageModel {
  const http = { timeoutMs: DEFAULT_IMAGE_TIMEOUT_MS, ...options };

  return {
    provider: "gemini",
    model,
    async generate(req: ImageGenerationRequest): Promise<GeneratedImage> {
      // Image-only output: every current image model supports it, and it avoids
      // the model spending tokens (and sometimes resolution) on commentary.
      const generationConfig: Record<string, unknown> = { responseModalities: ["IMAGE"] };
      if (req.aspectRatio) generationConfig.imageConfig = { aspectRatio: req.aspectRatio };

      const { parts, finishReason } = await generateContent(
        apiKey,
        model,
        {
          contents: [{ role: "user", parts: [{ text: req.prompt }] }],
          generationConfig,
        },
        http,
      );

      // Gemini 3 image models may emit interim "thought" images first; the
      // final render is the last non-thought image part.
      const image = [...parts].reverse().find((part) => !part.thought && part.inlineData?.data);
      if (!image?.inlineData?.data) {
        const said = parts.map((part) => part.text ?? "").join(" ").trim();
        throw new LlmError(
          PROVIDER,
          `no image returned${finishReason ? ` (finishReason=${finishReason})` : ""}${
            said ? `: ${truncate(said)}` : ""
          }`,
        );
      }
      return {
        data: base64ToBytes(image.inlineData.data),
        mimeType: image.inlineData.mimeType ?? "image/png",
      };
    },
  };
}
