import { describe, it, expect, vi } from "vitest";
import {
  chatJson,
  LlmError,
  MODELS,
  resolveProvider,
  type LlmProvider,
} from "@/lib/llm/client";

const OPENROUTER: LlmProvider = {
  name: "openrouter",
  baseUrl: "https://openrouter.ai/api/v1",
  apiKey: "or-key",
  model: "deepseek/deepseek-v4-flash",
};

function reply(content: string): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
    status: 200,
  });
}

type SentBody = {
  model: string;
  messages: { role: string; content: string }[];
  response_format?: { type: string };
  temperature?: number;
};

function callOf(fetchFn: ReturnType<typeof vi.fn>, index: number) {
  const [url, init] = fetchFn.mock.calls[index] as [string, RequestInit];
  return {
    url,
    headers: init.headers as Record<string, string>,
    body: JSON.parse(init.body as string) as SentBody,
  };
}

describe("resolveProvider", () => {
  it("берёт ключ OpenRouter из окружения и запрошенную модель", () => {
    const provider = resolveProvider(MODELS.capture, { OPENROUTER_API_KEY: " or " });
    expect(provider).toEqual({
      name: "openrouter",
      baseUrl: "https://openrouter.ai/api/v1",
      apiKey: "or",
      model: MODELS.capture,
    });
  });

  it("пустой и пробельный ключ — понятная ошибка настройки", () => {
    expect(() => resolveProvider(MODELS.capture, {})).toThrow(/OPENROUTER_API_KEY/);
    expect(() => resolveProvider(MODELS.capture, { OPENROUTER_API_KEY: "   " })).toThrow(
      /OPENROUTER_API_KEY/
    );
  });

  it("Groq больше не провайдер: его ключ ничего не даёт", () => {
    expect(() => resolveProvider(MODELS.capture, { GROQ_API_KEY: "groq" })).toThrow(
      /OPENROUTER_API_KEY/
    );
  });
});

describe("chatJson — запрос и ответ", () => {
  it("шлёт системный и пользовательский текст в OpenRouter и просит JSON", async () => {
    const fetchFn = vi.fn().mockResolvedValue(reply('{"items":[{"kind":"task"}]}'));

    const result = await chatJson({
      system: "разбери",
      user: "заполнить итмо",
      model: MODELS.capture,
      provider: OPENROUTER,
      fetchFn: fetchFn as unknown as typeof fetch,
    });

    const sent = callOf(fetchFn, 0);
    expect(sent.url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(sent.headers.Authorization).toBe("Bearer or-key");
    expect(sent.body.model).toBe("deepseek/deepseek-v4-flash");
    expect(sent.body.messages).toEqual([
      { role: "system", content: "разбери" },
      { role: "user", content: "заполнить итмо" },
    ]);
    expect(sent.body.response_format).toEqual({ type: "json_object" });
    // Разбор задач — не творчество: температура низкая.
    expect(sent.body.temperature ?? 1).toBeLessThanOrEqual(0.2);
    expect(result).toEqual({
      content: '{"items":[{"kind":"task"}]}',
      provider: "openrouter",
      model: "deepseek/deepseek-v4-flash",
    });
  });

  it("без готового провайдера собирает его из env", async () => {
    const fetchFn = vi.fn().mockResolvedValue(reply("{}"));

    await chatJson({
      system: "s",
      user: "u",
      model: MODELS.agent,
      env: { OPENROUTER_API_KEY: "env-key" },
      fetchFn: fetchFn as unknown as typeof fetch,
    });

    const sent = callOf(fetchFn, 0);
    expect(sent.headers.Authorization).toBe("Bearer env-key");
    expect(sent.body.model).toBe(MODELS.agent);
  });

  it("без ключа не ходит в сеть — понятная ошибка, а не 401 от провайдера", async () => {
    const fetchFn = vi.fn();

    await expect(
      chatJson({
        system: "s",
        user: "u",
        model: MODELS.capture,
        env: {},
        fetchFn: fetchFn as unknown as typeof fetch,
      })
    ).rejects.toThrow(/OPENROUTER_API_KEY/);

    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("не-2xx превращается в LlmError со статусом и не повторяется", async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response("limit", { status: 429 }));

    await expect(
      chatJson({
        system: "s",
        user: "u",
        model: MODELS.capture,
        provider: OPENROUTER,
        fetchFn: fetchFn as unknown as typeof fetch,
      })
    ).rejects.toMatchObject({ provider: "openrouter", status: 429 });

    expect(fetchFn).toHaveBeenCalledTimes(1);
    await expect(
      chatJson({
        system: "s",
        user: "u",
        model: MODELS.capture,
        provider: OPENROUTER,
        fetchFn: vi.fn().mockResolvedValue(new Response("bad", { status: 400 })) as unknown as typeof fetch,
      })
    ).rejects.toBeInstanceOf(LlmError);
  });

  it("ответ без choices отдаёт пустую строку, а не падает", async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));

    const result = await chatJson({
      system: "s",
      user: "u",
      model: MODELS.capture,
      provider: OPENROUTER,
      fetchFn: fetchFn as unknown as typeof fetch,
    });

    expect(result.content).toBe("");
  });
});
