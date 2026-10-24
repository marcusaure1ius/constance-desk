import { describe, it, expect, vi } from "vitest";
import { chatTools } from "@/lib/llm/chat-tools";
import { MODELS, type LlmProvider } from "@/lib/llm/client";

const OPENROUTER: LlmProvider = {
  name: "openrouter",
  baseUrl: "https://openrouter.ai/api/v1",
  apiKey: "or-key",
  model: "deepseek/deepseek-v4-flash",
};

const TOOLS = [
  {
    type: "function" as const,
    function: { name: "get_board", description: "Снимок доски.", parameters: {} },
  },
];

function withToolCall(args: string): Response {
  return new Response(
    JSON.stringify({
      choices: [
        {
          message: {
            content: null,
            tool_calls: [
              { id: "call_1", type: "function", function: { name: "get_board", arguments: args } },
            ],
          },
        },
      ],
    }),
    { status: 200 }
  );
}

describe("chatTools", () => {
  it("разбирает вызов инструмента и его аргументы", async () => {
    const fetchFn = vi.fn(async () => withToolCall('{"environmentId":"env_1"}'));

    const result = await chatTools({
      messages: [{ role: "user", content: "что на доске" }],
      model: MODELS.agent,
      tools: TOOLS,
      provider: OPENROUTER,
      fetchFn: fetchFn as unknown as typeof fetch,
    });

    expect(result.toolCalls).toEqual([
      { id: "call_1", tool: "get_board", args: { environmentId: "env_1" } },
    ]);
    expect(result.provider).toBe("openrouter");
  });

  it("битые аргументы не роняют вызов: приходит пустой объект", async () => {
    const fetchFn = vi.fn(async () => withToolCall("{не json"));

    const result = await chatTools({
      messages: [{ role: "user", content: "…" }],
      model: MODELS.agent,
      tools: TOOLS,
      provider: OPENROUTER,
      fetchFn: fetchFn as unknown as typeof fetch,
    });

    expect(result.toolCalls[0].args).toEqual({});
  });

  it("отправляет инструменты и историю в теле запроса", async () => {
    const fetchFn = vi.fn(async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: "ок" } }] }), { status: 200 })
    );

    await chatTools({
      messages: [
        { role: "system", content: "правила" },
        { role: "user", content: "привет" },
      ],
      model: MODELS.agent,
      tools: TOOLS,
      provider: OPENROUTER,
      fetchFn: fetchFn as unknown as typeof fetch,
    });

    const call = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(call).toBeDefined();
    const options = call[1];
    const body = JSON.parse(options.body as string);
    expect(body.tools).toEqual(TOOLS);
    expect(body.messages).toHaveLength(2);
    expect(body.response_format).toBeUndefined();
  });

  it("запрос к модели ограничен по времени", async () => {
    const fetchFn = vi.fn(async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: "ок" } }] }), { status: 200 })
    );
    await chatTools({
      messages: [{ role: "user", content: "привет" }],
      model: MODELS.agent,
      tools: TOOLS,
      provider: OPENROUTER,
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    const options = (fetchFn.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it("зависшая модель — понятная ошибка, а не вечное ожидание", async () => {
    const fetchFn = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        })
    );
    await expect(
      chatTools({
        messages: [{ role: "user", content: "привет" }],
        model: MODELS.agent,
        tools: TOOLS,
        provider: OPENROUTER,
        fetchFn: fetchFn as unknown as typeof fetch,
        timeoutMs: 20,
      })
    ).rejects.toThrow("Модель не ответила");
  });
});

describe("chatTools: скорость", () => {
  it("тело запроса выключает рассуждения и просит самый быстрый апстрим", async () => {
    const fetchFn = vi.fn(async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: "ок" } }] }), { status: 200 })
    );
    await chatTools({
      messages: [{ role: "user", content: "привет" }],
      model: MODELS.agent,
      tools: TOOLS,
      provider: OPENROUTER,
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    const [, options] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(options.body as string);
    expect(body.reasoning).toEqual({ enabled: false });
    expect(body.provider).toEqual({ sort: "throughput" });
  });
});
