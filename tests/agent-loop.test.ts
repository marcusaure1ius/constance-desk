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
const moveHandler = vi.fn(async () => ({ success: true }));

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
  defineTool({
    name: "move_task",
    title: "Переместить",
    description: "Переместить задачу.",
    inputSchema: {
      taskId: z.string(),
      targetColumnId: z.string(),
      targetPosition: z.number().int(),
    },
    surfaces: ["chat"],
    mutation: true,
    impact: "reversible",
    handler: moveHandler,
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

  it("неизвестный инструмент не роняет цикл и эмитит tool_start перед tool_end", async () => {
    const chat = vi
      .fn()
      .mockResolvedValueOnce(callsTool("send_email", {}))
      .mockResolvedValueOnce(answer("Такого не умею."));

    const events = await collect(
      runAgent({ message: "напиши письмо", environmentId: "env_1", tools, chat })
    );

    // tool_start обязателен и для неизвестного инструмента: без него в ленте
    // (сопоставление по id) шаг для tool_end просто некуда положить.
    expect(events.map((e) => e.type)).toEqual(["thinking", "tool_start", "tool_end", "text"]);
    expect(events[1]).toMatchObject({ type: "tool_start", tool: "send_email", id: "call_1" });
    expect(events[2]).toMatchObject({
      type: "tool_end",
      tool: "send_email",
      id: "call_1",
      error: "Неизвестный инструмент",
    });
  });

  it("мутация (move_task) исполняется и отдаёт board_changed", async () => {
    const chat = vi
      .fn()
      .mockResolvedValueOnce(
        callsTool("move_task", { taskId: "t1", targetColumnId: "col_2", targetPosition: 0 })
      )
      .mockResolvedValueOnce(answer("Перенёс в работу."));

    const events = await collect(
      runAgent({ message: "перенеси демку в работу", environmentId: "env_1", tools, chat })
    );

    expect(events.map((e) => e.type)).toEqual([
      "thinking",
      "tool_start",
      "tool_end",
      "board_changed",
      "text",
    ]);
    expect(moveHandler).toHaveBeenCalled();
  });

  it("read-инструмент не отдаёт board_changed", async () => {
    const chat = vi
      .fn()
      .mockResolvedValueOnce(callsTool("list_tasks", { environmentId: "env_1" }))
      .mockResolvedValueOnce(answer("Готово."));

    const events = await collect(
      runAgent({ message: "что горит", environmentId: "env_1", tools, chat })
    );

    expect(events.some((e) => e.type === "board_changed")).toBe(false);
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

  it("исчерпание шагов с отложенными вызовами отдаёт proposal перед error", async () => {
    const chat = vi
      .fn()
      .mockResolvedValue(callsTool("create_task", { title: "Задача", columnId: "col_1" }));

    const events = await collect(
      runAgent({ message: "заведи задачу", environmentId: "env_1", tools, chat, maxSteps: 1 })
    );

    expect(events.at(-2)).toMatchObject({
      type: "proposal",
      calls: [{ tool: "create_task", args: { title: "Задача", columnId: "col_1" } }],
    });
    expect(events.at(-1)).toEqual({
      type: "error",
      message: "Агент не уложился в отведённые шаги",
    });
  });
});

describe("метки отложенных вызовов (finding 3)", () => {
  it("резолвит id в название задачи, если она уже прочитана в этом же ходе", async () => {
    const listHandler = vi.fn(async () => [
      { id: "t1", title: "Демка" },
      { id: "t2", title: "Другая задача" },
    ]);
    const deleteHandler = vi.fn(async () => ({ success: true }));

    const localTools: Tool[] = [
      defineTool({
        name: "list_tasks",
        title: "Задачи",
        description: "Список задач.",
        inputSchema: { environmentId: z.string() },
        surfaces: ["chat"],
        mutation: false,
        impact: "read",
        handler: listHandler,
      }),
      defineTool({
        name: "delete_task",
        title: "Удалить",
        description: "Удалить задачу.",
        inputSchema: { id: z.string() },
        surfaces: ["chat"],
        mutation: true,
        impact: "irreversible",
        handler: deleteHandler,
      }),
    ];

    const chat = vi
      .fn()
      .mockResolvedValueOnce(callsTool("list_tasks", { environmentId: "env_1" }))
      .mockResolvedValueOnce(callsTool("delete_task", { id: "t1" }))
      .mockResolvedValueOnce(answer("Предлагаю удалить."));

    const events = await collect(
      runAgent({ message: "удали демку", environmentId: "env_1", tools: localTools, chat })
    );

    const proposal = events.find((e) => e.type === "proposal");
    expect(proposal).toMatchObject({
      calls: [{ tool: "delete_task", args: { id: "t1" }, label: "Удалить «Демка»" }],
    });
  });

  it("без резолвинга по id показывает изменяемые поля и id", async () => {
    const updateHandler = vi.fn(async () => ({ id: "t9" }));

    const localTools: Tool[] = [
      defineTool({
        name: "update_task",
        title: "Обновить",
        description: "Изменить задачу.",
        inputSchema: {
          id: z.string(),
          priority: z.string().optional(),
          plannedDate: z.string().nullable().optional(),
        },
        surfaces: ["chat"],
        mutation: true,
        impact: "irreversible",
        handler: updateHandler,
      }),
    ];

    const chat = vi
      .fn()
      .mockResolvedValueOnce(
        callsTool("update_task", { id: "t9", priority: "urgent", plannedDate: "2026-09-01" })
      )
      .mockResolvedValueOnce(answer("Предлагаю изменить."));

    const events = await collect(
      runAgent({ message: "подними приоритет t9", environmentId: "env_1", tools: localTools, chat })
    );

    const proposal = events.find((e) => e.type === "proposal");
    expect(proposal).toMatchObject({
      calls: [{ tool: "update_task", label: "Изменить задачу t9: приоритет, срок" }],
    });
  });
});

describe("summarizeResult", () => {
  it("массив меряет длиной", () => {
    expect(summarizeResult([1, 2, 3])).toBe("3 элемента");
  });

  it("объект с задачами меряет задачами", () => {
    expect(summarizeResult({ tasks: [1, 2] })).toBe("2 задачи");
  });

  it("снимок доски (get_board) меряет задачами и колонками", () => {
    const tasks = new Array(17).fill(0);
    const columns = new Array(3).fill(0);
    expect(summarizeResult({ tasks, columns })).toBe("17 задач в 3 колонках");
  });

  it("остальное отдаёт коротким JSON", () => {
    expect(summarizeResult({ success: true })).toBe('{"success":true}');
  });
});
