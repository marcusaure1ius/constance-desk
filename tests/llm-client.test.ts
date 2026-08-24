import { describe, it, expect, vi } from "vitest";
import {
  chatJson,
  LlmError,
  MODELS,
  resolveProviders,
  type LlmProvider,
} from "@/lib/llm/client";

/**
 * Падение с Groq на OpenRouter — главное, ради чего клиент общий. Проверяется
 * не «функция что-то вернула», а куда именно ушёл второй запрос: адрес, ключ и
 * модель. Иначе тест прошёл бы и на клиенте, который повторяет в тот же Groq.
 */

const GROQ: LlmProvider = {
  name: "groq",
  baseUrl: "https://api.groq.com/openai/v1",
  apiKey: "groq-key",
  model: "openai/gpt-oss-120b",
};

const OPENROUTER: LlmProvider = {
  name: "openrouter",
  baseUrl: "https://openrouter.ai/api/v1",
  apiKey: "or-key",
  model: "deepseek/deepseek-chat",
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

describe("resolveProviders", () => {
  it("Groq первым, OpenRouter вторым — порядок задан ценой, а не алфавитом", () => {
    const providers = resolveProviders(MODELS.capture, {
      OPENROUTER_API_KEY: "or",
      GROQ_API_KEY: "groq",
    });

    expect(providers.map((p) => p.name)).toEqual(["groq", "openrouter"]);
    expect(providers[0].model).toBe(MODELS.capture.groq);
    expect(providers[1].model).toBe(MODELS.capture.openrouter);
  });

  it("провайдер без ключа не попадает в список", () => {
    const providers = resolveProviders(MODELS.capture, { GROQ_API_KEY: "groq" });
    expect(providers.map((p) => p.name)).toEqual(["groq"]);
  });

  it("пустой и пробельный ключ считаются отсутствующими", () => {
    expect(resolveProviders(MODELS.capture, { GROQ_API_KEY: "", OPENROUTER_API_KEY: "   " })).toEqual([]);
  });

  it("захват и веб-форма считают разными моделями", () => {
    // 20b на захвате замерена как портящая формулировки — модели не совпадают.
    expect(MODELS.capture.groq).not.toBe(MODELS.smartInput.groq);
  });
});

describe("chatJson — падение к следующему провайдеру", () => {
  it("429 у Groq уводит тот же запрос в OpenRouter", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(new Response("Rate limit reached", { status: 429 }))
      .mockResolvedValueOnce(reply('{"items":[]}'));

    const result = await chatJson({
      system: "системный",
      user: "пользовательский",
      models: MODELS.capture,
      providers: [GROQ, OPENROUTER],
      fetchFn: fetchFn as unknown as typeof fetch,
    });

    expect(result.provider).toBe("openrouter");
    expect(result.content).toBe('{"items":[]}');
    expect(fetchFn).toHaveBeenCalledTimes(2);

    const first = callOf(fetchFn, 0);
    const second = callOf(fetchFn, 1);
    expect(first.url).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect(second.url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(second.headers.Authorization).toBe("Bearer or-key");
    expect(second.body.model).toBe("deepseek/deepseek-chat");
    // Запрос уходит тот же самый, а не «какой-нибудь».
    expect(second.body.messages).toEqual(first.body.messages);
  });

  it("5xx у Groq тоже уводит к OpenRouter: виноват провайдер, а не запрос", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(new Response("bad gateway", { status: 502 }))
      .mockResolvedValueOnce(reply("{}"));

    const result = await chatJson({
      system: "s",
      user: "u",
      models: MODELS.capture,
      providers: [GROQ, OPENROUTER],
      fetchFn: fetchFn as unknown as typeof fetch,
    });

    expect(result.provider).toBe("openrouter");
  });

  it("обрыв связи уводит к OpenRouter", async () => {
    const fetchFn = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(reply("{}"));

    const result = await chatJson({
      system: "s",
      user: "u",
      models: MODELS.capture,
      providers: [GROQ, OPENROUTER],
      fetchFn: fetchFn as unknown as typeof fetch,
    });

    expect(result.provider).toBe("openrouter");
  });

  it("400 не уводит никуда: платную квоту жечь тем же плохим запросом нельзя", async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response("bad request", { status: 400 }));

    await expect(
      chatJson({
        system: "s",
        user: "u",
        models: MODELS.capture,
        providers: [GROQ, OPENROUTER],
        fetchFn: fetchFn as unknown as typeof fetch,
      })
    ).rejects.toBeInstanceOf(LlmError);

    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("без ключа OpenRouter 429 остаётся 429 — падать некуда", async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response("limit", { status: 429 }));

    await expect(
      chatJson({
        system: "s",
        user: "u",
        models: MODELS.capture,
        providers: [GROQ],
        fetchFn: fetchFn as unknown as typeof fetch,
      })
    ).rejects.toMatchObject({ provider: "groq", status: 429 });

    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("оба провайдера лежат — наверх идёт ошибка последнего", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(new Response("limit", { status: 429 }))
      .mockResolvedValueOnce(new Response("down", { status: 503 }));

    await expect(
      chatJson({
        system: "s",
        user: "u",
        models: MODELS.capture,
        providers: [GROQ, OPENROUTER],
        fetchFn: fetchFn as unknown as typeof fetch,
      })
    ).rejects.toMatchObject({ provider: "openrouter", status: 503 });
  });

  it("без ключей вообще — понятная ошибка настройки, а не 401 от провайдера", async () => {
    const fetchFn = vi.fn();

    await expect(
      chatJson({
        system: "s",
        user: "u",
        models: MODELS.capture,
        env: {},
        fetchFn: fetchFn as unknown as typeof fetch,
      })
    ).rejects.toThrow(/GROQ_API_KEY/);

    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe("chatJson — запрос и ответ", () => {
  it("шлёт системный и пользовательский текст и просит JSON", async () => {
    const fetchFn = vi.fn().mockResolvedValue(reply('{"items":[{"kind":"task"}]}'));

    const result = await chatJson({
      system: "разбери",
      user: "заполнить итмо",
      models: MODELS.capture,
      providers: [GROQ],
      fetchFn: fetchFn as unknown as typeof fetch,
    });

    const sent = callOf(fetchFn, 0);
    expect(sent.headers.Authorization).toBe("Bearer groq-key");
    expect(sent.body.messages).toEqual([
      { role: "system", content: "разбери" },
      { role: "user", content: "заполнить итмо" },
    ]);
    expect(sent.body.response_format).toEqual({ type: "json_object" });
    // Разбор задач — не творчество: температура низкая.
    expect(sent.body.temperature ?? 1).toBeLessThanOrEqual(0.2);
    expect(result.content).toBe('{"items":[{"kind":"task"}]}');
  });

  it("ответ без choices отдаёт пустую строку, а не падает", async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));

    const result = await chatJson({
      system: "s",
      user: "u",
      models: MODELS.capture,
      providers: [GROQ],
      fetchFn: fetchFn as unknown as typeof fetch,
    });

    expect(result.content).toBe("");
  });
});
