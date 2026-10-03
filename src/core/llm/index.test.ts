import { describe, expect, it } from "vitest";
import {
  DEFAULT_IMAGE_MODELS,
  DEFAULT_TEXT_MODELS,
  LlmError,
  MissingApiKeyError,
  createImageModel,
  createTextModel,
  llmKeysFromEnv,
} from "./index";
import { PNG_BASE64, mockFetch } from "./test-utils";

describe("llmKeysFromEnv", () => {
  it("reads the three provider variables and treats empty or blank values as unset", () => {
    expect(
      llmKeysFromEnv({ GEMINI_API_KEY: " g-key ", OPENAI_API_KEY: "", ANTHROPIC_API_KEY: "   " }),
    ).toEqual({ gemini: "g-key", openai: undefined, anthropic: undefined });
    expect(llmKeysFromEnv({})).toEqual({ gemini: undefined, openai: undefined, anthropic: undefined });
  });

  it("defaults to process.env", () => {
    const previous = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = "from-process-env";
    try {
      expect(llmKeysFromEnv().gemini).toBe("from-process-env");
    } finally {
      if (previous === undefined) delete process.env.GEMINI_API_KEY;
      else process.env.GEMINI_API_KEY = previous;
    }
  });
});

describe("createTextModel", () => {
  const keys = { gemini: "g", openai: "o", anthropic: "a" };

  it("uses the provider default when model is null or blank", () => {
    for (const provider of ["gemini", "openai", "anthropic"] as const) {
      expect(createTextModel(provider, null, keys)).toMatchObject({
        provider,
        model: DEFAULT_TEXT_MODELS[provider],
      });
      expect(createTextModel(provider, "  ", keys).model).toBe(DEFAULT_TEXT_MODELS[provider]);
    }
    expect(DEFAULT_TEXT_MODELS.anthropic).toBe("claude-opus-5-5");
  });

  it("honours an explicit model", () => {
    expect(createTextModel("openai", "gpt-4.1", keys).model).toBe("gpt-4.1");
  });

  it("throws MissingApiKeyError naming the provider", () => {
    const error = (() => {
      try {
        createTextModel("anthropic", null, { gemini: "g" });
      } catch (e) {
        return e;
      }
    })();
    expect(error).toBeInstanceOf(MissingApiKeyError);
    expect((error as MissingApiKeyError).provider).toBe("anthropic");
    expect(() => createTextModel("gemini", null, {})).toThrow(MissingApiKeyError);
    expect(() => createTextModel("openai", null, { openai: "" })).toThrow(MissingApiKeyError);
  });

  it("passes the injected fetch through to the adapter", async () => {
    const { fetchImpl, calls } = mockFetch({
      json: { content: [{ type: "text", text: "hi" }], stop_reason: "end_turn" },
    });
    const model = createTextModel("anthropic", null, keys, fetchImpl);
    await expect(model.generate({ system: "s", prompt: "p" })).resolves.toBe("hi");
    expect(calls).toHaveLength(1);
  });
});

describe("createImageModel", () => {
  const keys = { gemini: "g", openai: "o" };

  it("returns null for 'none', even without keys", () => {
    expect(createImageModel("none", null, {})).toBeNull();
  });

  it("uses the provider default when model is null", () => {
    expect(createImageModel("gemini", null, keys)).toMatchObject({
      provider: "gemini",
      model: DEFAULT_IMAGE_MODELS.gemini,
    });
    expect(createImageModel("openai", null, keys)).toMatchObject({
      provider: "openai",
      model: DEFAULT_IMAGE_MODELS.openai,
    });
  });

  it("throws MissingApiKeyError when the key is absent", () => {
    expect(() => createImageModel("openai", null, { gemini: "g" })).toThrow(MissingApiKeyError);
    expect(() => createImageModel("gemini", null, {})).toThrow(MissingApiKeyError);
  });

  it("passes the injected fetch through to the adapter", async () => {
    const { fetchImpl, calls } = mockFetch({ json: { data: [{ b64_json: PNG_BASE64 }] } });
    const image = await createImageModel("openai", null, keys, fetchImpl)!.generate({ prompt: "p" });
    expect(image.data.length).toBeGreaterThan(0);
    expect(calls).toHaveLength(1);
  });
});

describe("exports", () => {
  it("exposes LlmError with the documented shape", () => {
    const error = new LlmError("gemini", "boom", { status: 503, retryable: true });
    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({ provider: "gemini", status: 503, retryable: true });
    expect(new LlmError("gemini", "x").retryable).toBe(false);
  });
});
