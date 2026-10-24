import { describe, it, expect, vi } from "vitest";
import { extractSearchQuery } from "@/lib/llm/search-query";
import type { LlmProvider } from "@/lib/llm/client";

const OPENROUTER: LlmProvider = {
  name: "openrouter",
  baseUrl: "https://openrouter.ai/api/v1",
  apiKey: "or-key",
  model: "deepseek/deepseek-v4-flash",
};

function reply(content: string): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
}

describe("extractSearchQuery", () => {
  it("достаёт ключевые слова", async () => {
    const fetchFn = vi.fn(async () => reply('{"query":"слайды","done":false}'));
    const res = await extractSearchQuery("закрой задачу про слайды", {
      provider: OPENROUTER,
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    expect(res).toEqual({ query: "слайды", done: false });
  });

  it("done: true из ответа", async () => {
    const fetchFn = vi.fn(async () => reply('{"query":"отчёт вэд","done":true}'));
    const res = await extractSearchQuery("я сделал отчёт по вэду", {
      provider: OPENROUTER,
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    expect(res).toEqual({ query: "отчёт вэд", done: true });
  });

  it("битый JSON — фолбэк на исходный текст", async () => {
    const fetchFn = vi.fn(async () => reply("не json"));
    const res = await extractSearchQuery("закрой слайды", {
      provider: OPENROUTER,
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    expect(res).toEqual({ query: "закрой слайды", done: false });
  });

  it("сбой сети — фолбэк", async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error("сеть");
    });
    const res = await extractSearchQuery("x y", {
      provider: OPENROUTER,
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    expect(res).toEqual({ query: "x y", done: false });
  });
});
