import { describe, expect, it } from "vitest";
import { acceptsEffort, acceptsSampling, createAnthropicTextModel, extractJsonObject } from "./anthropic";
import { LlmError } from "./http";
import { FAST, mockFetch, rejection } from "./test-utils";

const KEY = "sk-ant-api03-TESTKEY0123456789abcdef";
const reply = (text: string, stop_reason = "end_turn") => ({
  id: "msg_1",
  type: "message",
  role: "assistant",
  content: [{ type: "text", text }],
  stop_reason,
});

describe("Anthropic text", () => {
  it("sends the expected request and parses text blocks", async () => {
    const { fetchImpl, calls } = mockFetch({ json: reply("Hello") });
    const model = createAnthropicTextModel(KEY, "claude-haiku-4-5", { fetchImpl, ...FAST });

    const out = await model.generate({
      system: "Be brief.",
      prompt: "Say hello",
      temperature: 0.4,
      maxOutputTokens: 900,
    });

    expect(out).toBe("Hello");
    expect(model).toMatchObject({ provider: "anthropic", model: "claude-haiku-4-5" });
    const [call] = calls;
    expect(call.url).toBe("https://api.anthropic.com/v1/messages");
    expect(call.url).not.toContain(KEY);
    expect(call.headers.get("x-api-key")).toBe(KEY);
    expect(call.headers.get("anthropic-version")).toBe("2023-06-01");
    expect(call.body).toEqual({
      model: "claude-haiku-4-5",
      max_tokens: 900,
      system: "Be brief.",
      temperature: 0.4,
      messages: [{ role: "user", content: "Say hello" }],
    });
  });

  it("falls back to a max_tokens value, since the API requires one", async () => {
    const { fetchImpl, calls } = mockFetch({ json: reply("ok") });
    await createAnthropicTextModel(KEY, "claude-sonnet-5-5", { fetchImpl, ...FAST }).generate({
      system: "",
      prompt: "p",
    });
    expect(calls[0].body.max_tokens).toBeGreaterThan(0);
    expect(calls[0].body.system).toBeUndefined();
  });

  it("omits temperature for models that reject non-default sampling", async () => {
    const { fetchImpl, calls } = mockFetch({ json: reply("ok") });
    await createAnthropicTextModel(KEY, "claude-sonnet-5-5", { fetchImpl, ...FAST }).generate({
      system: "s",
      prompt: "p",
      temperature: 0.7,
    });
    expect(calls[0].body.temperature).toBeUndefined();
  });

  it("asks for low effort on models that support it, and only those", async () => {
    const { fetchImpl, calls } = mockFetch({ json: reply("ok") });
    await createAnthropicTextModel(KEY, "claude-opus-5-5", { fetchImpl, ...FAST }).generate({ system: "s", prompt: "p" });
    await createAnthropicTextModel(KEY, "claude-haiku-4-5", { fetchImpl, ...FAST }).generate({ system: "s", prompt: "p" });
    expect(calls[0].body.output_config).toEqual({ effort: "low" });
    expect(calls[1].body.output_config).toBeUndefined();
  });

  it("knows which models accept output_config.effort", () => {
    for (const id of ["claude-opus-5-5", "claude-sonnet-5-5", "claude-sonnet-5", "claude-opus-4-8", "claude-opus-4-5-20251101", "claude-sonnet-4-6", "claude-fable-5-1"]) {
      expect(acceptsEffort(id), id).toBe(true);
    }
    for (const id of ["claude-haiku-4-5", "claude-haiku-4-5-20251001", "claude-sonnet-4-5-20250929", "claude-opus-4-1-20250805", "claude-3-7-sonnet-latest"]) {
      expect(acceptsEffort(id), id).toBe(false);
    }
  });

  it("knows which models accept sampling parameters", () => {
    for (const id of [
      "claude-haiku-4-5",
      "claude-haiku-4-5-20251001",
      "claude-sonnet-4-5-20250929",
      "claude-sonnet-4-6",
      "claude-opus-4-6",
      "claude-opus-4-1-20250805",
      "claude-opus-4-20250514",
      "claude-3-7-sonnet-latest",
    ]) {
      expect(acceptsSampling(id), id).toBe(true);
    }
    for (const id of [
      "claude-sonnet-5-5",
      "claude-sonnet-5",
      "claude-opus-5-5",
      "claude-opus-4-7",
      "claude-opus-4-8",
      "claude-fable-5-1",
    ]) {
      expect(acceptsSampling(id), id).toBe(false);
    }
  });

  it("instructs for JSON in the system prompt, never prefills, and returns a bare object", async () => {
    const { fetchImpl, calls } = mockFetch({
      json: reply('Here is the article:\n```json\n{"title":"T","tags":["a"]}\n```\nHope it helps!'),
    });
    const model = createAnthropicTextModel(KEY, "claude-sonnet-5-5", { fetchImpl, ...FAST });

    const out = await model.generate({ system: "You write articles.", prompt: "Write.", json: true });

    expect(JSON.parse(out)).toEqual({ title: "T", tags: ["a"] });
    expect(calls[0].body.system).toMatch(/^You write articles\./);
    expect(calls[0].body.system).toMatch(/exactly one valid JSON object/);
    const { messages } = calls[0].body;
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe("user");
  });

  it("ignores thinking blocks and joins text blocks", async () => {
    const { fetchImpl } = mockFetch({
      json: {
        content: [
          { type: "thinking", thinking: "", signature: "x" },
          { type: "text", text: "Hel" },
          { type: "text", text: "lo" },
        ],
        stop_reason: "end_turn",
      },
    });
    const model = createAnthropicTextModel(KEY, "claude-sonnet-5-5", { fetchImpl, ...FAST });
    await expect(model.generate({ system: "s", prompt: "p" })).resolves.toBe("Hello");
  });

  it("retries once on 529 then succeeds", async () => {
    const { fetchImpl, calls } = mockFetch(
      { status: 529, json: { type: "error", error: { type: "overloaded_error", message: "Overloaded" } } },
      { json: reply("fine") },
    );
    const model = createAnthropicTextModel(KEY, "claude-sonnet-5-5", { fetchImpl, ...FAST });
    await expect(model.generate({ system: "s", prompt: "p" })).resolves.toBe("fine");
    expect(calls).toHaveLength(2);
  });

  it("does not retry on 400, and the error never contains the key", async () => {
    const { fetchImpl, calls } = mockFetch({
      status: 400,
      json: { type: "error", error: { type: "invalid_request_error", message: `bad request for ${KEY}` } },
    });
    const error = await rejection(
      createAnthropicTextModel(KEY, "claude-sonnet-5-5", { fetchImpl, ...FAST }).generate({
        system: "s",
        prompt: "p",
      }),
    );
    expect(error).toBeInstanceOf(LlmError);
    expect(error).toMatchObject({ provider: "anthropic", status: 400, retryable: false });
    expect(error.message).not.toContain(KEY);
    expect(calls).toHaveLength(1);
  });

  it("throws on max_tokens, refusals and empty output", async () => {
    const generate = (json: unknown) =>
      rejection(
        createAnthropicTextModel(KEY, "claude-sonnet-5-5", {
          fetchImpl: mockFetch({ json }).fetchImpl,
          ...FAST,
        }).generate({ system: "s", prompt: "p" }),
      );

    expect((await generate(reply('{"cut":', "max_tokens"))).message).toContain("max_tokens");
    expect((await generate(reply("no", "refusal"))).message).toContain("refus");
    const empty = await generate({ content: [], stop_reason: "end_turn" });
    expect(empty).toBeInstanceOf(LlmError);
    expect(empty.message).toContain("no text");
  });
});

describe("extractJsonObject", () => {
  it("returns the object from fenced or chatty replies and passes plain objects through", () => {
    expect(extractJsonObject('{"a":1}')).toBe('{"a":1}');
    expect(extractJsonObject('```json\n{"a":{"b":2}}\n```')).toBe('{"a":{"b":2}}');
    expect(extractJsonObject('Sure! {"a":1} Done.')).toBe('{"a":1}');
    expect(extractJsonObject("  no object here  ")).toBe("no object here");
  });
});
