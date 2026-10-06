// Anthropic adapter (text only) over the Messages API.
// Docs checked 2026-10-03:
//  - https://docs.anthropic.com/en/api/messages            (request/response, stop_reason)
//  - https://docs.anthropic.com/en/docs/about-claude/models (model IDs: claude-sonnet-5-5, claude-opus-5-5, claude-haiku-4-5)
// Notes on current models:
//  - Assistant prefill is rejected (400) on the 4.6+ / 5.x families, so JSON mode
//    is a system-prompt instruction plus extraction of the object from the reply.
//  - Sonnet 5.5, Opus 5.x and Opus 4.7+ reject non-default temperature/top_p/top_k,
//    so temperature is only sent to models known to accept it.
//  - Current models think by default and thinking tokens count toward max_tokens.
//    `output_config.effort: "low"` keeps that short where supported (writing an
//    article from a precise prompt does not need deep reasoning).

import type { TextGenerationRequest, TextModel } from "../types";
import { DEFAULT_TEXT_TIMEOUT_MS, LlmError, postJson, type HttpOptions } from "./http";

export const DEFAULT_ANTHROPIC_TEXT_MODEL = "claude-opus-5-5";

const PROVIDER = "anthropic";
const MESSAGES_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
/** `max_tokens` is mandatory on this API; used when the caller sets no limit. */
const FALLBACK_MAX_TOKENS = 8192;

const JSON_INSTRUCTION =
  "Output requirement: reply with exactly one valid JSON object and nothing else " +
  "(no markdown code fences, no text before or after it).";

/** Claude 3.x, Haiku 4.5, and Sonnet/Opus 4 up to 4.6 accept sampling parameters. */
export function acceptsSampling(model: string): boolean {
  return /^claude-(?:3-|haiku-4-5|sonnet-4(?:-[0-6]\b|-\d{8}\b|$)|opus-4(?:-[0-6]\b|-\d{8}\b|$))/.test(
    model,
  );
}

/** Opus 4.5+, Sonnet 4.6+, the 5.x families and Fable/Mythos accept `output_config.effort` (Sonnet 4.5 and Haiku 4.5 reject it). */
export function acceptsEffort(model: string): boolean {
  return /^claude-(?:opus-4-[5-9]|sonnet-4-[6-9]|(?:opus|sonnet)-[5-9]|fable|mythos)/.test(model);
}

/** Tolerates stray prose or ```json fences around the object. */
export function extractJsonObject(text: string): string {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  return start !== -1 && end > start ? text.slice(start, end + 1) : text.trim();
}

interface MessagesResult {
  content?: { type?: string; text?: string }[];
  stop_reason?: string;
}

export function createAnthropicTextModel(
  apiKey: string,
  model: string,
  options: HttpOptions = {},
): TextModel {
  const http = { timeoutMs: DEFAULT_TEXT_TIMEOUT_MS, ...options };

  return {
    provider: "anthropic",
    model,
    async generate(req: TextGenerationRequest): Promise<string> {
      const system = req.json ? `${req.system}\n\n${JSON_INSTRUCTION}`.trim() : req.system;

      const body: Record<string, unknown> = {
        model,
        max_tokens: req.maxOutputTokens ?? FALLBACK_MAX_TOKENS,
        messages: [{ role: "user", content: req.prompt }],
      };
      if (system) body.system = system;
      if (req.temperature !== undefined && acceptsSampling(model)) {
        body.temperature = req.temperature;
      }
      if (acceptsEffort(model)) body.output_config = { effort: "low" };

      const json = (await postJson({
        provider: PROVIDER,
        url: MESSAGES_URL,
        headers: { "x-api-key": apiKey, "anthropic-version": ANTHROPIC_VERSION },
        body,
        apiKey,
        ...http,
      })) as MessagesResult;

      if (json.stop_reason === "max_tokens") {
        throw new LlmError(
          PROVIDER,
          "output was cut off (stop_reason=max_tokens); raise maxOutputTokens",
        );
      }
      if (json.stop_reason === "refusal") {
        throw new LlmError(PROVIDER, "model refused the request (stop_reason=refusal)");
      }

      // Thinking blocks may precede the answer; only text blocks are the output.
      const text = (json.content ?? [])
        .filter((block) => block.type === "text" && typeof block.text === "string")
        .map((block) => block.text)
        .join("");
      if (!text.trim()) {
        throw new LlmError(PROVIDER, "model returned no text", { retryable: true });
      }
      return req.json ? extractJsonObject(text) : text;
    },
  };
}
