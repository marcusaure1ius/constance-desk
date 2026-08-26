import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { runAgent, summarizeResult } from "@/lib/agent/loop";
import { defineTool, type Tool } from "@/lib/agent/tool-registry";
import type { AgentEvent } from "@/lib/agent/events";
import type { ChatToolsResult } from "@/lib/llm/chat-tools";

function answer(content: string): ChatToolsResult {
  return { content, toolCalls: [], raw: [], provider: "openrouter", model: "m" };
}

function callsTool(tool: string, args: unknown): ChatToolsResult {
  return {
    content: "",
    toolCalls: [{ id: "call_1", tool, args }],
    raw: [
      { id: "call_1", type: "function", function: { name: tool, arguments: JSON.stringify(args) } },
    ],
    provider: "openrouter",
    model: "m",
  };
}

async function collect(gen: AsyncGenerator<AgentEvent>): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const event of gen) events.push(event);
  return events;
}

const readHandler = vi.fn(async () => [{ id: "1" }, { id: "2" }]);
const writeHandler = vi.fn(async () => ({ id: "3" }));

const tools: Tool[] = [
  defineTool({
    name: "list_tasks",
    title: "Задачи",
    description: "Список задач.",
    inputSchema: { environmentId: z.string() },
    surfaces: ["chat"],
    mutation: false,
    impact: "read",
    handler: readHandler,
  }),
  defineTool({
    name: "create_task",
    title: "Создать",
    description: "Создать задачу.",
    inputSchema: { title: z.string(), columnId: z.string() },
    surfaces: ["chat"],
    mutation: true,
    impact: "irreversible",
    handler: writeHandler,
  }),
];

describe("runAgent", () => {
  it("исполняет читающий инструмент и отдаёт текст", async () => {
    const chat = vi
      .fn()
      .mockResolvedValueOnce(callsTool("list_tasks", { environmentId: "env_1" }))
      .mockResolvedValueOnce(answer("Просрочено две."));

    const events = await collect(
      runAgent({ message: "что горит", environmentId: "env_1", tools, chat })
    );

    expect(events.map((e) => e.type)).toEqual(["thinking", "tool_start", "tool_end", "text"]);
    expect(readHandler).toHaveBeenCalledWith({ environmentId: "env_1" });
    expect(events.at(-1)).toEqual({ type: "text", text: "Просрочено две." });
  });

  it("вызов irreversible не исполняется, а уходит предложением", async () => {
    const chat = vi
      .fn()
      .mockResolvedValueOnce(callsTool("create_task", { title: "Задача", columnId: "col_1" }))
      .mockResolvedValueOnce(answer("Предлагаю создать."));

    const events = await collect(
      runAgent({ message: "заведи задачу", environmentId: "env_1", tools, chat })
    );

    expect(writeHandler).not.toHaveBeenCalled();
    const proposal = events.find((e) => e.type === "proposal");
    expect(proposal).toMatchObject({
      calls: [{ tool: "create_task", args: { title: "Задача", columnId: "col_1" } }],
    });
    expect(events.some((e) => e.type === "tool_start")).toBe(false);
  });

  it("ошибка инструмента попадает в tool_end, цикл продолжается", async () => {
    const chat = vi
      .fn()
      .mockResolvedValueOnce(callsTool("list_tasks", { environmentId: 42 }))
      .mockResolvedValueOnce(answer("Не получилось прочитать."));

    const events = await collect(
      runAgent({ message: "что горит", environmentId: "env_1", tools, chat })
    );

    const end = events.find((e) => e.type === "tool_end");
    expect(end).toMatchObject({ tool: "list_tasks" });
    expect((end as { error?: string }).error).toContain("Неверные аргументы");
    expect(events.at(-1)?.type).toBe("text");
  });

  it("неизвестный инструмент не роняет цикл", async () => {
    const chat = vi
      .fn()
      .mockResolvedValueOnce(callsTool("send_email", {}))
      .mockResolvedValueOnce(answer("Такого не умею."));

    const events = await collect(
      runAgent({ message: "напиши письмо", environmentId: "env_1", tools, chat })
    );

    expect(events.find((e) => e.type === "tool_end")).toMatchObject({
      tool: "send_email",
      error: "Неизвестный инструмент",
    });
  });

  it("упирается в предел шагов и отдаёт ошибку вместо бесконечного цикла", async () => {
    const chat = vi.fn().mockResolvedValue(callsTool("list_tasks", { environmentId: "env_1" }));

    const events = await collect(
      runAgent({ message: "…", environmentId: "env_1", tools, chat, maxSteps: 2 })
    );

    expect(chat).toHaveBeenCalledTimes(2);
    expect(events.at(-1)).toEqual({
      type: "error",
      message: "Агент не уложился в отведённые шаги",
    });
  });

  it("падение модели превращается в событие error", async () => {
    const chat = vi.fn().mockRejectedValue(new Error("429 quota"));

    const events = await collect(
      runAgent({ message: "…", environmentId: "env_1", tools, chat })
    );

    expect(events.at(-1)).toEqual({ type: "error", message: "429 quota" });
  });
});

describe("summarizeResult", () => {
  it("массив меряет длиной", () => {
    expect(summarizeResult([1, 2, 3])).toBe("3 элемента");
  });

  it("объект с задачами меряет задачами", () => {
    expect(summarizeResult({ tasks: [1, 2] })).toBe("2 задачи");
  });

  it("остальное отдаёт коротким JSON", () => {
    expect(summarizeResult({ success: true })).toBe('{"success":true}');
  });
});
