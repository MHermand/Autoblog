import { describe, expect, it } from "vitest";
import { LlmError } from "./http";
import { createOpenAiImageModel, createOpenAiTextModel } from "./openai";
import { FAST, PNG_BASE64, PNG_SIGNATURE, mockFetch, rejection } from "./test-utils";

const KEY = "sk-proj-TESTKEY0123456789abcdef";
const reply = (text: string) => ({
  status: "completed",
  output: [
    { type: "reasoning", summary: [] },
    { type: "message", role: "assistant", content: [{ type: "output_text", text, annotations: [] }] },
  ],
});

describe("OpenAI text (Responses API)", () => {
  it("sends the expected request and parses output_text", async () => {
    const { fetchImpl, calls } = mockFetch({ json: reply("Hello") });
    const model = createOpenAiTextModel(KEY, "gpt-6-luna", { fetchImpl, ...FAST });

    const out = await model.generate({
      system: "Be brief.",
      prompt: "Say hello",
      temperature: 0.7,
      maxOutputTokens: 800,
    });

    expect(out).toBe("Hello");
    expect(model).toMatchObject({ provider: "openai", model: "gpt-6-luna" });
    const [call] = calls;
    expect(call.url).toBe("https://api.openai.com/v1/responses");
    expect(call.url).not.toContain(KEY);
    expect(call.headers.get("authorization")).toBe(`Bearer ${KEY}`);
    expect(call.body).toEqual({
      model: "gpt-6-luna",
      input: "Say hello",
      instructions: "Be brief.",
      max_output_tokens: 800,
      temperature: 0.7,
      reasoning: { effort: "none" },
      store: false,
    });
  });

  it("uses JSON mode and adds a JSON hint only when the prompts never say 'JSON'", async () => {
    const hinted = mockFetch({ json: reply("{}") });
    await createOpenAiTextModel(KEY, "gpt-6-luna", { fetchImpl: hinted.fetchImpl, ...FAST }).generate({
      system: "You write articles.",
      prompt: "Write one.",
      json: true,
    });
    expect(hinted.calls[0].body.text).toEqual({ format: { type: "json_object" } });
    expect(hinted.calls[0].body.instructions).toMatch(/JSON/);

    const already = mockFetch({ json: reply("{}") });
    await createOpenAiTextModel(KEY, "gpt-6-luna", { fetchImpl: already.fetchImpl, ...FAST }).generate({
      system: "Return a JSON object.",
      prompt: "Go.",
      json: true,
    });
    expect(already.calls[0].body.instructions).toBe("Return a JSON object.");
  });

  it("adapts parameters to the model family", async () => {
    const send = async (id: string) => {
      const { fetchImpl, calls } = mockFetch({ json: reply("ok") });
      await createOpenAiTextModel(KEY, id, { fetchImpl, ...FAST }).generate({
        system: "s",
        prompt: "p",
        temperature: 0.5,
      });
      return calls[0].body;
    };

    // Other reasoning models: low effort, temperature dropped (it would be a 400).
    const sol = await send("gpt-6.1-sol");
    expect(sol.reasoning).toEqual({ effort: "low" });
    expect(sol.temperature).toBeUndefined();
    expect((await send("o4-mini")).temperature).toBeUndefined();

    // Classic chat models: no reasoning field, temperature kept.
    const classic = await send("gpt-4.1");
    expect(classic.reasoning).toBeUndefined();
    expect(classic.temperature).toBe(0.5);
  });

  it("retries once on 503 then succeeds", async () => {
    const { fetchImpl, calls } = mockFetch(
      { status: 503, json: { error: { message: "server_error" } } },
      { json: reply("fine") },
    );
    const model = createOpenAiTextModel(KEY, "gpt-6-luna", { fetchImpl, ...FAST });
    await expect(model.generate({ system: "s", prompt: "p" })).resolves.toBe("fine");
    expect(calls).toHaveLength(2);
  });

  it("does not retry on 400, and the error never contains the key", async () => {
    const { fetchImpl, calls } = mockFetch({
      status: 401,
      json: { error: { message: `Incorrect API key provided: ${KEY}.` } },
    });
    const error = await rejection(
      createOpenAiTextModel(KEY, "gpt-6-luna", { fetchImpl, ...FAST }).generate({
        system: "s",
        prompt: "p",
      }),
    );
    expect(error).toBeInstanceOf(LlmError);
    expect(error).toMatchObject({ provider: "openai", status: 401, retryable: false });
    expect(error.message).not.toContain(KEY);
    expect(calls).toHaveLength(1);
  });

  it("throws on truncated output, refusals, failures and empty output", async () => {
    const generate = (json: unknown) =>
      rejection(
        createOpenAiTextModel(KEY, "gpt-6-luna", {
          fetchImpl: mockFetch({ json }).fetchImpl,
          ...FAST,
        }).generate({ system: "s", prompt: "p" }),
      );

    expect(
      (await generate({ status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, output: [] }))
        .message,
    ).toContain("max_output_tokens");
    expect(
      (
        await generate({
          status: "completed",
          output: [{ type: "message", content: [{ type: "refusal", refusal: "no can do" }] }],
        })
      ).message,
    ).toContain("no can do");
    expect((await generate({ status: "failed", error: { message: "boom" } })).message).toContain("boom");
    const empty = await generate({ status: "completed", output: [] });
    expect(empty).toBeInstanceOf(LlmError);
    expect(empty.message).toContain("no text");
  });
});

describe("OpenAI image", () => {
  const png = { json: { data: [{ b64_json: PNG_BASE64 }] } };

  it("sends the expected request and decodes b64_json", async () => {
    const { fetchImpl, calls } = mockFetch(png);
    const model = createOpenAiImageModel(KEY, "gpt-image-2.5-flare", { fetchImpl, ...FAST });

    const image = await model.generate({ prompt: "a red bicycle", aspectRatio: "16:9" });

    expect(model).toMatchObject({ provider: "openai", model: "gpt-image-2.5-flare" });
    expect(image.mimeType).toBe("image/jpeg");
    expect(image.data).toBeInstanceOf(Uint8Array);
    expect(Array.from(image.data.slice(0, 4))).toEqual(PNG_SIGNATURE);
    expect(calls[0].url).toBe("https://api.openai.com/v1/images/generations");
    expect(calls[0].headers.get("authorization")).toBe(`Bearer ${KEY}`);
    expect(calls[0].body).toEqual({
      model: "gpt-image-2.5-flare",
      prompt: "a red bicycle",
      n: 1,
      size: "1536x1024",
      quality: "medium",
      output_format: "jpeg",
    });
  });

  it("maps aspect ratios to supported sizes", async () => {
    const sizeFor = async (aspectRatio?: "16:9" | "4:3" | "1:1") => {
      const { fetchImpl, calls } = mockFetch(png);
      await createOpenAiImageModel(KEY, "m", { fetchImpl, ...FAST }).generate({ prompt: "p", aspectRatio });
      return calls[0].body.size;
    };
    expect(await sizeFor("16:9")).toBe("1536x1024");
    expect(await sizeFor("4:3")).toBe("1536x1024");
    expect(await sizeFor("1:1")).toBe("1024x1024");
    expect(await sizeFor()).toBe("auto");
  });

  it("retries once on 503, does not retry on 400, and throws when the image is missing", async () => {
    const retried = mockFetch({ status: 503, text: "busy" }, png);
    await createOpenAiImageModel(KEY, "m", { fetchImpl: retried.fetchImpl, ...FAST }).generate({ prompt: "p" });
    expect(retried.calls).toHaveLength(2);

    const rejected = mockFetch({ status: 400, json: { error: { message: "moderation_blocked" } } });
    const error = await rejection(
      createOpenAiImageModel(KEY, "m", { fetchImpl: rejected.fetchImpl, ...FAST }).generate({ prompt: "p" }),
    );
    expect(error).toMatchObject({ status: 400, retryable: false });
    expect(rejected.calls).toHaveLength(1);

    const empty = mockFetch({ json: { data: [] } });
    await expect(
      createOpenAiImageModel(KEY, "m", { fetchImpl: empty.fetchImpl, ...FAST }).generate({ prompt: "p" }),
    ).rejects.toBeInstanceOf(LlmError);
  });
});
