import { describe, expect, it } from "vitest";
import { createGeminiImageModel, createGeminiTextModel } from "./gemini";
import { LlmError } from "./http";
import { FAST, PNG_BASE64, PNG_SIGNATURE, mockFetch, rejection } from "./test-utils";

const KEY = "AIzaSyTESTKEY-0123456789abcdef";
const textResponse = (text: string, finishReason = "STOP") => ({
  candidates: [{ content: { parts: [{ text }] }, finishReason }],
});

describe("Gemini text", () => {
  it("sends the expected request, with the key in a header and not in the URL", async () => {
    const { fetchImpl, calls } = mockFetch({ json: textResponse("Hello there") });
    const model = createGeminiTextModel(KEY, "gemini-3.8-flash", { fetchImpl, ...FAST });

    const out = await model.generate({
      system: "Be brief.",
      prompt: "Say hello",
      temperature: 0.7,
      maxOutputTokens: 500,
    });

    expect(out).toBe("Hello there");
    expect(model).toMatchObject({ provider: "gemini", model: "gemini-3.8-flash" });
    const [call] = calls;
    expect(call.url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent",
    );
    expect(call.url).not.toContain(KEY);
    expect(call.headers.get("x-goog-api-key")).toBe(KEY);
    expect(call.headers.get("content-type")).toBe("application/json");
    expect(call.body).toEqual({
      systemInstruction: { parts: [{ text: "Be brief." }] },
      contents: [{ role: "user", parts: [{ text: "Say hello" }] }],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 500,
        thinkingConfig: { thinkingLevel: "low" },
      },
    });
  });

  it("asks for JSON in JSON mode and omits unset options", async () => {
    const { fetchImpl, calls } = mockFetch({ json: textResponse('{"a":1}') });
    const model = createGeminiTextModel(KEY, "gemini-3.8-flash", { fetchImpl, ...FAST });

    await expect(model.generate({ system: "", prompt: "p", json: true })).resolves.toBe('{"a":1}');

    expect(calls[0].body.generationConfig.responseMimeType).toBe("application/json");
    expect(calls[0].body.generationConfig.temperature).toBeUndefined();
    expect(calls[0].body.systemInstruction).toBeUndefined();
  });

  it("limits thinking according to the model family", async () => {
    const cases: [string, unknown][] = [
      ["gemini-3.5-flash-lite", { thinkingLevel: "low" }],
      ["gemini-2.5-flash", { thinkingBudget: 0 }],
      ["gemini-custom-model", undefined],
    ];
    for (const [id, expected] of cases) {
      const { fetchImpl, calls } = mockFetch({ json: textResponse("ok") });
      await createGeminiTextModel(KEY, id, { fetchImpl, ...FAST }).generate({ system: "s", prompt: "p" });
      expect(calls[0].body.generationConfig.thinkingConfig).toEqual(expected);
    }
  });

  it("strips a models/ prefix from the model name", async () => {
    const { fetchImpl, calls } = mockFetch({ json: textResponse("ok") });
    await createGeminiTextModel(KEY, "models/gemini-3.8-flash", { fetchImpl, ...FAST }).generate({
      system: "s",
      prompt: "p",
    });
    expect(calls[0].url).toContain("/models/gemini-3.8-flash:generateContent");
  });

  it("joins text parts and ignores thought parts", async () => {
    const { fetchImpl } = mockFetch({
      json: {
        candidates: [
          {
            content: { parts: [{ text: "secret reasoning", thought: true }, { text: "Hel" }, { text: "lo" }] },
            finishReason: "STOP",
          },
        ],
      },
    });
    const model = createGeminiTextModel(KEY, "gemini-3.8-flash", { fetchImpl, ...FAST });
    await expect(model.generate({ system: "s", prompt: "p" })).resolves.toBe("Hello");
  });

  it("retries once on 503 then succeeds", async () => {
    const { fetchImpl, calls } = mockFetch(
      { status: 503, json: { error: { message: "overloaded" } } },
      { json: textResponse("fine") },
    );
    const model = createGeminiTextModel(KEY, "gemini-3.8-flash", { fetchImpl, ...FAST });
    await expect(model.generate({ system: "s", prompt: "p" })).resolves.toBe("fine");
    expect(calls).toHaveLength(2);
  });

  it("does not retry on 400, and the error never contains the key", async () => {
    const { fetchImpl, calls } = mockFetch({
      status: 400,
      json: { error: { message: `API key not valid: ${KEY}` } },
    });
    const model = createGeminiTextModel(KEY, "gemini-3.8-flash", { fetchImpl, ...FAST });
    const error = await rejection(model.generate({ system: "s", prompt: "p" }));
    expect(error).toBeInstanceOf(LlmError);
    expect(error).toMatchObject({ provider: "gemini", status: 400, retryable: false });
    expect(error.message).not.toContain(KEY);
    expect(calls).toHaveLength(1);
  });

  it("throws on MAX_TOKENS, safety stops, blocked prompts and empty output", async () => {
    const generate = (reply: unknown) =>
      rejection(
        createGeminiTextModel(KEY, "gemini-3.8-flash", {
          fetchImpl: mockFetch({ json: reply }).fetchImpl,
          ...FAST,
        }).generate({ system: "s", prompt: "p" }),
      );

    expect((await generate(textResponse('{"partial":', "MAX_TOKENS"))).message).toContain("MAX_TOKENS");
    expect((await generate(textResponse("x", "SAFETY"))).message).toContain("SAFETY");
    expect((await generate({ promptFeedback: { blockReason: "PROHIBITED_CONTENT" } })).message).toContain(
      "PROHIBITED_CONTENT",
    );
    const empty = await generate({ candidates: [{ content: { parts: [] }, finishReason: "STOP" }] });
    expect(empty).toBeInstanceOf(LlmError);
    expect(empty.message).toContain("no text");
  });
});

describe("Gemini image", () => {
  const imageResponse = (parts: unknown[]) => ({
    candidates: [{ content: { parts }, finishReason: "STOP" }],
  });

  it("requests an image-only response with the aspect ratio and decodes the base64 data", async () => {
    const { fetchImpl, calls } = mockFetch({
      json: imageResponse([{ inlineData: { mimeType: "image/png", data: PNG_BASE64 } }]),
    });
    const model = createGeminiImageModel(KEY, "gemini-3.1-flash-image", { fetchImpl, ...FAST });

    const image = await model.generate({ prompt: "a red bicycle", aspectRatio: "16:9" });

    expect(model).toMatchObject({ provider: "gemini", model: "gemini-3.1-flash-image" });
    expect(image.mimeType).toBe("image/png");
    expect(image.data).toBeInstanceOf(Uint8Array);
    expect(Array.from(image.data.slice(0, 4))).toEqual(PNG_SIGNATURE);
    expect(calls[0].url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image:generateContent",
    );
    expect(calls[0].url).not.toContain(KEY);
    expect(calls[0].headers.get("x-goog-api-key")).toBe(KEY);
    expect(calls[0].body).toEqual({
      contents: [{ role: "user", parts: [{ text: "a red bicycle" }] }],
      generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "16:9" } },
    });
  });

  it("omits imageConfig without an aspect ratio", async () => {
    const { fetchImpl, calls } = mockFetch({
      json: imageResponse([{ inlineData: { mimeType: "image/jpeg", data: PNG_BASE64 } }]),
    });
    const image = await createGeminiImageModel(KEY, "m", { fetchImpl, ...FAST }).generate({ prompt: "p" });
    expect(image.mimeType).toBe("image/jpeg");
    expect(calls[0].body.generationConfig.imageConfig).toBeUndefined();
  });

  it("picks the final image and skips interim thought images and text", async () => {
    const { fetchImpl } = mockFetch({
      json: imageResponse([
        { text: "Here you go" },
        { thought: true, inlineData: { mimeType: "image/jpeg", data: "AAAA" } },
        { inlineData: { mimeType: "image/png", data: PNG_BASE64 } },
      ]),
    });
    const image = await createGeminiImageModel(KEY, "m", { fetchImpl, ...FAST }).generate({ prompt: "p" });
    expect(image.mimeType).toBe("image/png");
    expect(Array.from(image.data.slice(0, 4))).toEqual(PNG_SIGNATURE);
  });

  it("throws a descriptive LlmError when no image comes back", async () => {
    const { fetchImpl } = mockFetch({
      json: {
        candidates: [{ content: { parts: [{ text: "I cannot draw that." }] }, finishReason: "IMAGE_SAFETY" }],
      },
    });
    const error = await rejection(
      createGeminiImageModel(KEY, "m", { fetchImpl, ...FAST }).generate({ prompt: "p" }),
    );
    expect(error).toBeInstanceOf(LlmError);
    expect(error.message).toContain("IMAGE_SAFETY");
    expect(error.message).toContain("I cannot draw that.");
  });

  it("retries once on 503 then succeeds", async () => {
    const { fetchImpl, calls } = mockFetch(
      { status: 503, text: "busy" },
      { json: imageResponse([{ inlineData: { mimeType: "image/png", data: PNG_BASE64 } }]) },
    );
    const image = await createGeminiImageModel(KEY, "m", { fetchImpl, ...FAST }).generate({ prompt: "p" });
    expect(image.data.length).toBeGreaterThan(0);
    expect(calls).toHaveLength(2);
  });
});
