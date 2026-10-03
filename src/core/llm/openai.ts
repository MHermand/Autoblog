// OpenAI adapter: text via the Responses API (OpenAI's recommended API for text
// generation), images via the Images API.
// Docs checked 2026-10-03:
//  - https://developers.openai.com/api/docs/models                    (GPT-6 family, gpt-image-2.5)
//  - https://developers.openai.com/api/docs/guides/text               (Responses API recommended)
//  - https://developers.openai.com/api/docs/guides/latest-model       (temperature only when reasoning effort is "none")
//  - https://developers.openai.com/api/docs/guides/image-generation   (sizes, b64_json response)
// Auth is a Bearer header; the key never appears in URLs, logs or error messages.

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
  type HttpOptions,
} from "./http";

export const DEFAULT_OPENAI_TEXT_MODEL = "gpt-6-luna";
export const DEFAULT_OPENAI_IMAGE_MODEL = "gpt-image-2.5-flare";

const PROVIDER = "openai";
const API_ROOT = "https://api.openai.com/v1";

/** gpt-image sizes supported by every model; the closest landscape size serves 16:9 and 4:3. */
const IMAGE_SIZES: Record<NonNullable<ImageGenerationRequest["aspectRatio"]>, string> = {
  "16:9": "1536x1024",
  "4:3": "1536x1024",
  "1:1": "1024x1024",
};

interface TextProfile {
  reasoning?: { effort: "none" | "low" };
  /** Reasoning models reject temperature unless effort is "none". */
  sampling: boolean;
}

/**
 * How to talk to a given text model. Luna (the default) can run with reasoning
 * off, which is fastest and keeps `temperature` usable. Other reasoning models
 * (GPT-5+, o-series) get low effort and no temperature. Older chat models
 * (gpt-4.x) take neither a reasoning field nor any restriction.
 */
function textProfile(model: string): TextProfile {
  if (/^gpt-\d+(?:\.\d+)?-luna/.test(model)) return { reasoning: { effort: "none" }, sampling: true };
  if (/^(?:gpt-(?:[5-9]|\d{2})|o\d)/.test(model)) return { reasoning: { effort: "low" }, sampling: false };
  return { sampling: true };
}

interface ResponsesResult {
  status?: string;
  incomplete_details?: { reason?: string } | null;
  error?: { message?: string } | null;
  output?: { type?: string; content?: { type?: string; text?: string; refusal?: string }[] }[];
}

export function createOpenAiTextModel(
  apiKey: string,
  model: string,
  options: HttpOptions = {},
): TextModel {
  const http = { timeoutMs: DEFAULT_TEXT_TIMEOUT_MS, ...options };
  const profile = textProfile(model);

  return {
    provider: "openai",
    model,
    async generate(req: TextGenerationRequest): Promise<string> {
      // JSON mode is rejected unless the word "JSON" appears in the input.
      const needsJsonHint = req.json && !/json/i.test(`${req.system}\n${req.prompt}`);
      const instructions = needsJsonHint
        ? `${req.system}\n\nRespond with a single valid JSON object.`.trim()
        : req.system;

      const body: Record<string, unknown> = { model, input: req.prompt, store: false };
      if (instructions) body.instructions = instructions;
      if (req.maxOutputTokens !== undefined) body.max_output_tokens = req.maxOutputTokens;
      if (profile.sampling && req.temperature !== undefined) body.temperature = req.temperature;
      if (profile.reasoning) body.reasoning = profile.reasoning;
      if (req.json) body.text = { format: { type: "json_object" } };

      const json = (await postJson({
        provider: PROVIDER,
        url: `${API_ROOT}/responses`,
        headers: { authorization: `Bearer ${apiKey}` },
        body,
        apiKey,
        ...http,
      })) as ResponsesResult;

      if (json.status === "incomplete") {
        const reason = json.incomplete_details?.reason ?? "unknown";
        throw new LlmError(
          PROVIDER,
          reason === "max_output_tokens"
            ? "output was cut off (max_output_tokens reached, reasoning tokens count too); raise maxOutputTokens"
            : `response incomplete (${reason})`,
        );
      }
      if (json.status === "failed") {
        throw new LlmError(PROVIDER, `generation failed: ${json.error?.message ?? "unknown error"}`);
      }

      const parts = (json.output ?? [])
        .filter((item) => item.type === "message")
        .flatMap((item) => item.content ?? []);
      const refusal = parts.find((part) => part.type === "refusal");
      if (refusal) {
        throw new LlmError(PROVIDER, `model refused the request: ${refusal.refusal ?? "no reason given"}`);
      }
      const text = parts
        .filter((part) => part.type === "output_text" && typeof part.text === "string")
        .map((part) => part.text)
        .join("");
      if (!text.trim()) {
        throw new LlmError(PROVIDER, "model returned no text", { retryable: true });
      }
      return text;
    },
  };
}

export function createOpenAiImageModel(
  apiKey: string,
  model: string,
  options: HttpOptions = {},
): ImageModel {
  const http = { timeoutMs: DEFAULT_IMAGE_TIMEOUT_MS, ...options };

  return {
    provider: "openai",
    model,
    async generate(req: ImageGenerationRequest): Promise<GeneratedImage> {
      // JPEG is smaller and faster than PNG and fine for photos/illustrations;
      // "medium" quality keeps cost and latency reasonable for blog images.
      const json = (await postJson({
        provider: PROVIDER,
        url: `${API_ROOT}/images/generations`,
        headers: { authorization: `Bearer ${apiKey}` },
        body: {
          model,
          prompt: req.prompt,
          n: 1,
          size: req.aspectRatio ? IMAGE_SIZES[req.aspectRatio] : "auto",
          quality: "medium",
          output_format: "jpeg",
        },
        apiKey,
        ...http,
      })) as { data?: { b64_json?: string }[] };

      const b64 = json.data?.[0]?.b64_json;
      if (!b64) throw new LlmError(PROVIDER, "response contained no image data");
      return { data: base64ToBytes(b64), mimeType: "image/jpeg" };
    },
  };
}
