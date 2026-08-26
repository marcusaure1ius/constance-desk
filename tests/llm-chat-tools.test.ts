import { describe, it, expect, vi } from "vitest";
import { chatTools } from "@/lib/llm/chat-tools";
import { MODELS, type LlmProvider } from "@/lib/llm/client";

const OPENROUTER: LlmProvider = {
  name: "openrouter",
  baseUrl: "https://openrouter.ai/api/v1",
  apiKey: "or-key",
  model: "deepseek/deepseek-v4-flash",
};
const GROQ: LlmProvider = {
  name: "groq",
  baseUrl: "https://api.groq.com/openai/v1",
  apiKey: "groq-key",
  model: "openai/gpt-oss-120b",
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
      models: MODELS.agent,
      tools: TOOLS,
      providers: [OPENROUTER],
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
      models: MODELS.agent,
      tools: TOOLS,
      providers: [OPENROUTER],
      fetchFn: fetchFn as unknown as typeof fetch,
    });

    expect(result.toolCalls[0].args).toEqual({});
  });

  it("на 429 уходит к следующему провайдеру", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(new Response("quota", { status: 429 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ choices: [{ message: { content: "готово" } }] }), {
          status: 200,
        })
      );

    const result = await chatTools({
      messages: [{ role: "user", content: "…" }],
      models: MODELS.agent,
      tools: TOOLS,
      providers: [OPENROUTER, GROQ],
      fetchFn: fetchFn as unknown as typeof fetch,
    });

    expect(result.provider).toBe("groq");
    expect(result.content).toBe("готово");
    expect(result.toolCalls).toEqual([]);
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
      models: MODELS.agent,
      tools: TOOLS,
      providers: [OPENROUTER],
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
});
