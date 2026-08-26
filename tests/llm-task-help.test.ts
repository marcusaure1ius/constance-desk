import { describe, it, expect, vi } from "vitest";
import {
  buildDescriptionPrompt,
  buildTitlePrompt,
  draftDescription,
  improveTitle,
  parseDescriptionResponse,
  parseTitleResponse,
} from "@/lib/llm/task-help";
import type { LlmProvider } from "@/lib/llm/client";

const GROQ: LlmProvider = {
  name: "groq",
  baseUrl: "https://api.groq.com/openai/v1",
  apiKey: "groq-key",
  model: "openai/gpt-oss-20b",
};

function reply(content: string): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
}

describe("промпты", () => {
  it("название просят не менять по смыслу", () => {
    expect(buildTitlePrompt()).toContain("Смысл менять нельзя");
  });

  it("в промпт описания подставляется сегодняшняя дата", () => {
    expect(buildDescriptionPrompt("2026-08-26")).toContain("2026-08-26");
  });
});

describe("разбор ответа", () => {
  it("берёт title из JSON", () => {
    expect(parseTitleResponse('{"title":"Предоставить сроки"}')).toBe("Предоставить сроки");
  });

  it("пустой или битый ответ — null", () => {
    expect(parseTitleResponse("не json")).toBeNull();
    expect(parseTitleResponse('{"title":"   "}')).toBeNull();
  });

  it("берёт description из JSON", () => {
    expect(parseDescriptionResponse('{"description":"Что сделать: …"}')).toBe("Что сделать: …");
  });
});

describe("improveTitle", () => {
  it("возвращает переписанное название", async () => {
    const fetchFn = vi.fn(async () => reply('{"title":"Предоставить сроки по почте бухгалтеров"}'));

    const result = await improveTitle("Нужно предоставить сроки по почте бухгалтеров", {
      providers: [GROQ],
      fetchFn: fetchFn as unknown as typeof fetch,
    });

    expect(result).toBe("Предоставить сроки по почте бухгалтеров");
  });

  it("если модель ответила мусором, возвращает исходное название", async () => {
    const fetchFn = vi.fn(async () => reply("извините, не понял"));

    const result = await improveTitle("Нужно сделать демку", {
      providers: [GROQ],
      fetchFn: fetchFn as unknown as typeof fetch,
    });

    expect(result).toBe("Нужно сделать демку");
  });
});

describe("draftDescription", () => {
  it("возвращает черновик описания", async () => {
    const fetchFn = vi.fn(async () => reply('{"description":"Что сделать: собрать вводные."}'));

    const result = await draftDescription(
      { title: "Сделать демку", description: "" },
      { providers: [GROQ], fetchFn: fetchFn as unknown as typeof fetch }
    );

    expect(result).toBe("Что сделать: собрать вводные.");
  });
});
