// Provider adapters for text and image generation. Plain fetch, no SDKs.
// Server-side only: it reads API keys, so never import it from client components.

import type { ImageModel, ImageProvider, TextModel, TextProvider } from "../types";
import { createAnthropicTextModel, DEFAULT_ANTHROPIC_TEXT_MODEL } from "./anthropic";
import {
  createGeminiImageModel,
  createGeminiTextModel,
  DEFAULT_GEMINI_IMAGE_MODEL,
  DEFAULT_GEMINI_TEXT_MODEL,
} from "./gemini";
import { MissingApiKeyError } from "./http";
import {
  createOpenAiImageModel,
  createOpenAiTextModel,
  DEFAULT_OPENAI_IMAGE_MODEL,
  DEFAULT_OPENAI_TEXT_MODEL,
} from "./openai";

export { LlmError, MissingApiKeyError } from "./http";

export const DEFAULT_TEXT_MODELS: Record<TextProvider, string> = {
  gemini: DEFAULT_GEMINI_TEXT_MODEL,
  openai: DEFAULT_OPENAI_TEXT_MODEL,
  anthropic: DEFAULT_ANTHROPIC_TEXT_MODEL,
};

export const DEFAULT_IMAGE_MODELS: Record<"gemini" | "openai", string> = {
  gemini: DEFAULT_GEMINI_IMAGE_MODEL,
  openai: DEFAULT_OPENAI_IMAGE_MODEL,
};

export interface LlmKeys {
  gemini?: string;
  openai?: string;
  anthropic?: string;
}

/** Reads GEMINI_API_KEY, OPENAI_API_KEY and ANTHROPIC_API_KEY. Empty values count as unset. */
export function llmKeysFromEnv(
  env: Record<string, string | undefined> = process.env,
): LlmKeys {
  const read = (name: string) => env[name]?.trim() || undefined;
  return {
    gemini: read("GEMINI_API_KEY"),
    openai: read("OPENAI_API_KEY"),
    anthropic: read("ANTHROPIC_API_KEY"),
  };
}

/** `model` null (or blank) selects the provider default. Throws MissingApiKeyError. */
export function createTextModel(
  provider: TextProvider,
  model: string | null,
  keys: LlmKeys,
  fetchImpl?: typeof fetch,
): TextModel {
  const apiKey = keys[provider];
  if (!apiKey) throw new MissingApiKeyError(provider);
  const modelId = model?.trim() || DEFAULT_TEXT_MODELS[provider];
  const options = { fetchImpl };

  switch (provider) {
    case "gemini":
      return createGeminiTextModel(apiKey, modelId, options);
    case "openai":
      return createOpenAiTextModel(apiKey, modelId, options);
    case "anthropic":
      return createAnthropicTextModel(apiKey, modelId, options);
  }
}

/** Returns null for "none". `model` null (or blank) selects the provider default. Throws MissingApiKeyError. */
export function createImageModel(
  provider: ImageProvider,
  model: string | null,
  keys: LlmKeys,
  fetchImpl?: typeof fetch,
): ImageModel | null {
  if (provider === "none") return null;
  const apiKey = keys[provider];
  if (!apiKey) throw new MissingApiKeyError(provider);
  const modelId = model?.trim() || DEFAULT_IMAGE_MODELS[provider];
  const options = { fetchImpl };

  switch (provider) {
    case "gemini":
      return createGeminiImageModel(apiKey, modelId, options);
    case "openai":
      return createOpenAiImageModel(apiKey, modelId, options);
  }
}
