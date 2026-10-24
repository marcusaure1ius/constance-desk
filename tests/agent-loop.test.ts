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

  it("systemPrompt заменяет промпт доски", async () => {
    const chat = vi.fn().mockResolvedValueOnce(answer("ок"));
    await collect(
      runAgent({ message: "привет", environmentId: "env_1", tools, chat, systemPrompt: "СВОЙ" })
    );
    expect(chat.mock.calls[0][0].messages[0]).toMatchObject({ role: "system", content: "СВОЙ" });
  });

  it("deferAll откладывает и обратимые вызовы", async () => {
    const args = { taskId: "t1", targetColumnId: "c", targetPosition: 0 };
    const deferChat = vi
      .fn()
      .mockResolvedValueOnce(callsTool("move_task", args))
      .mockResolvedValueOnce(answer("ок"));
    const deferred = await collect(
      runAgent({ message: "перенеси", environmentId: "env_1", tools, chat: deferChat, deferAll: true })
    );
    expect(deferred.some((e) => e.type === "tool_start")).toBe(false);
    expect(deferred.find((e) => e.type === "proposal")).toMatchObject({
      calls: [{ tool: "move_task" }],
    });

    const plainChat = vi
      .fn()
      .mockResolvedValueOnce(callsTool("move_task", args))
      .mockResolvedValueOnce(answer("ок"));
    const plain = await collect(
      runAgent({ message: "перенеси", environmentId: "env_1", tools, chat: plainChat })
    );
    expect(plain.some((e) => e.type === "tool_start")).toBe(true);
  });

  it("подпись у create_task", async () => {
    const chat = vi
      .fn()
      .mockResolvedValueOnce(
        callsTool("create_task", {
          title: "Позвонить Маше",
          columnId: "c",
          plannedDate: "2026-10-31",
          subtasks: [{ title: "a" }, { title: "b" }],
        })
      )
      .mockResolvedValueOnce(answer("ок"));
    const events = await collect(
      runAgent({ message: "x", environmentId: "env_1", today: "2026-10-24", tools, chat })
    );
    const proposal = events.find((e) => e.type === "proposal") as { calls: { label?: string }[] };
    expect(proposal.calls[0].label).toBe("Задача «Позвонить Маше» · срок 31.10 · 2 подзадачи");
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

describe("runAgent: дедлайн", () => {
  it("без deadlineAt модель зовётся без таймаута — поведение сайта прежнее", async () => {
    const chat = vi.fn().mockResolvedValueOnce(answer("ок"));
    await collect(runAgent({ message: "q", environmentId: "env_1", tools, chat }));
    expect(chat.mock.calls[0][0]).not.toHaveProperty("timeoutMs");
  });

  it("ответа модели ждёт не дольше остатка до дедлайна", async () => {
    const chat = vi.fn().mockResolvedValueOnce(answer("ок"));
    const deadlineAt = Date.now() + 20_000;
    await collect(runAgent({ message: "q", environmentId: "env_1", tools, chat, deadlineAt }));
    const { timeoutMs } = chat.mock.calls[0][0];
    expect(timeoutMs).toBeGreaterThan(15_000);
    expect(timeoutMs).toBeLessThanOrEqual(20_000);
  });

  it("далёкий дедлайн не поднимает таймаут выше обычного", async () => {
    const chat = vi.fn().mockResolvedValueOnce(answer("ок"));
    const deadlineAt = Date.now() + 250_000;
    await collect(runAgent({ message: "q", environmentId: "env_1", tools, chat, deadlineAt }));
    expect(chat.mock.calls[0][0].timeoutMs).toBe(45_000);
  });

  it("времени на шаг не осталось — модель не зовётся, ошибка про время", async () => {
    const chat = vi.fn();
    const events = await collect(
      runAgent({ message: "q", environmentId: "env_1", tools, chat, deadlineAt: Date.now() + 5_000 })
    );
    expect(chat).not.toHaveBeenCalled();
    expect(events.at(-1)).toEqual({ type: "error", message: "Агент не уложился в отведённое время" });
  });

  it("дедлайн посреди работы — отдаёт отложенное и следом ошибку", async () => {
    let now = 1_000_000;
    const clock = vi.spyOn(Date, "now").mockImplementation(() => now);
    try {
      const chat = vi.fn(async () => {
        now += 30_000; // шаг модели съел 30 секунд
        return callsTool("create_task", { title: "A", columnId: "c" });
      });
      const events = await collect(
        runAgent({
          message: "q",
          environmentId: "env_1",
          tools,
          chat,
          deferAll: true,
          deadlineAt: 1_000_000 + 40_000,
        })
      );
      expect(chat).toHaveBeenCalledTimes(1);
      const proposal = events.find((e) => e.type === "proposal");
      expect(proposal && proposal.type === "proposal" && proposal.calls.map((c) => c.tool)).toEqual([
        "create_task",
      ]);
      expect(events.at(-1)).toEqual({ type: "error", message: "Агент не уложился в отведённое время" });
      expect(writeHandler).not.toHaveBeenCalledWith({ title: "A", columnId: "c" });
    } finally {
      clock.mockRestore();
    }
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
      runAgent({ message: "подними приоритет t9", environmentId: "env_1", today: "2026-10-24", tools: localTools, chat })
    );

    const proposal = events.find((e) => e.type === "proposal");
    expect(proposal).toMatchObject({
      calls: [{ tool: "update_task", label: "Изменить задачу t9: приоритет, срок → 01.09" }],
    });
  });
});

describe("подписи предложений по подзадачам", () => {
  it("называют подзадачу и её задачу по уже прочитанной доске", async () => {
    const listHandler = vi.fn(async () => [
      {
        id: "t1",
        title: "Отчёт",
        subtasks: [{ id: "s1", title: "Свёрстать слайды", dueDate: null, done: false }],
      },
    ]);
    const deferredTool = (name: string, inputSchema: Record<string, z.ZodType>) =>
      defineTool({
        name,
        title: name,
        description: name,
        inputSchema,
        surfaces: ["chat"],
        mutation: true,
        impact: "irreversible",
        handler: vi.fn(async () => ({})),
      });

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
      deferredTool("create_subtask", { taskId: z.string(), title: z.string(), dueDate: z.string().optional() }),
      deferredTool("update_subtask", { id: z.string(), dueDate: z.string().nullable().optional() }),
      deferredTool("delete_subtask", { id: z.string() }),
    ];

    const chat = vi
      .fn()
      .mockResolvedValueOnce(callsTool("list_tasks", { environmentId: "env_1" }))
      .mockResolvedValueOnce(
        callsTool("create_subtask", { taskId: "t1", title: "Согласовать", dueDate: "2026-10-30" })
      )
      .mockResolvedValueOnce(callsTool("update_subtask", { id: "s1", dueDate: "2026-11-02" }))
      .mockResolvedValueOnce(callsTool("delete_subtask", { id: "s1" }))
      .mockResolvedValueOnce(answer("Предлагаю."));

    const events = await collect(
      runAgent({ message: "поправь подзадачи", environmentId: "env_1", today: "2026-10-24", tools: localTools, chat })
    );

    const proposal = events.find((e) => e.type === "proposal");
    expect(proposal).toMatchObject({
      calls: [
        { tool: "create_subtask", label: "Добавить подзадачу «Согласовать» в «Отчёт» · срок 30.10" },
        { tool: "update_subtask", label: "Изменить подзадачу «Свёрстать слайды»: срок → 02.11" },
        { tool: "delete_subtask", label: "Удалить подзадачу «Свёрстать слайды»" },
      ],
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

describe("подпись правки задачи показывает, что запишется (L3)", () => {
  const readTool = defineTool({
    name: "list_tasks",
    title: "Задачи",
    description: "Список задач.",
    inputSchema: { environmentId: z.string() },
    surfaces: ["chat"],
    mutation: false,
    impact: "read",
    handler: vi.fn(async () => [
      { id: "t1", title: "Отчёт для ИТМО", description: "Собрать цифры" },
    ]),
  });
  const updateTool = defineTool({
    name: "update_task",
    title: "Обновить",
    description: "Изменить задачу.",
    inputSchema: {
      id: z.string(),
      title: z.string().optional(),
      description: z.string().nullable().optional(),
    },
    surfaces: ["chat"],
    mutation: true,
    impact: "irreversible",
    handler: vi.fn(async () => ({})),
  });

  async function labelFor(args: Record<string, unknown>): Promise<string | undefined> {
    const chat = vi
      .fn()
      .mockResolvedValueOnce(callsTool("list_tasks", { environmentId: "env_1" }))
      .mockResolvedValueOnce(callsTool("update_task", args))
      .mockResolvedValueOnce(answer("ок"));
    const events = await collect(
      runAgent({ message: "x", environmentId: "env_1", today: "2026-10-24", tools: [readTool, updateTool], chat })
    );
    const proposal = events.find((e) => e.type === "proposal") as { calls: { label?: string }[] };
    return proposal.calls[0].label;
  }

  it("дописанное описание — добавленным хвостом", async () => {
    expect(
      await labelFor({ id: "t1", description: "Собрать цифры\nhttps://docs.google.com/document/d/abc" })
    ).toBe("Изменить «Отчёт для ИТМО»: описание + «https://docs.google.com/document/d/abc»");
  });

  it("новое описание целиком — первыми знаками", async () => {
    const label = await labelFor({ id: "t1", description: "Другое ".repeat(20) });
    expect(label).toMatch(/^Изменить «Отчёт для ИТМО»: описание → «Другое Другое .*…»$/);
    expect(Array.from(label!.split("«").at(-1)!).length).toBeLessThanOrEqual(61);
  });

  it("новое название — показано", async () => {
    expect(await labelFor({ id: "t1", title: "Отчёт для ИТМО к пятнице" })).toBe(
      "Изменить «Отчёт для ИТМО»: название → «Отчёт для ИТМО к пятнице»"
    );
  });
});

describe("runAgent: stopAfterDeferred", () => {
  function callsMany(content: string, calls: { tool: string; args: unknown }[]): ChatToolsResult {
    return {
      content,
      toolCalls: calls.map((c, i) => ({ id: `call_${i}`, tool: c.tool, args: c.args })),
      raw: calls.map((c, i) => ({
        id: `call_${i}`,
        type: "function" as const,
        function: { name: c.tool, arguments: JSON.stringify(c.args) },
      })),
      provider: "openrouter",
      model: "m",
    };
  }
  const create = (title: string) => ({ tool: "create_task", args: { title, columnId: "col_1" } });

  it("шаг из одних отложенных вызовов — последний: proposal сразу, текст шага — текстом", async () => {
    const chat = vi
      .fn()
      .mockResolvedValueOnce(callsMany("Не нашёл эпик — завёл задачу", [create("А"), create("Б")]));

    const events = await collect(
      runAgent({ message: "м", environmentId: "env_1", tools, chat, deferAll: true, stopAfterDeferred: true })
    );

    expect(chat).toHaveBeenCalledTimes(1);
    expect(events.map((e) => e.type)).toEqual(["thinking", "text", "proposal"]);
    expect(events.find((e) => e.type === "proposal")).toMatchObject({
      calls: [{ tool: "create_task", args: { title: "А" } }, { tool: "create_task", args: { title: "Б" } }],
    });
  });

  it("пустой текст шага — без события text", async () => {
    const chat = vi.fn().mockResolvedValueOnce(callsMany("", [create("А")]));
    const events = await collect(
      runAgent({ message: "м", environmentId: "env_1", tools, chat, deferAll: true, stopAfterDeferred: true })
    );
    expect(events.map((e) => e.type)).toEqual(["thinking", "proposal"]);
  });

  it("в шаге есть читающий вызов — цикл продолжается", async () => {
    const chat = vi
      .fn()
      .mockResolvedValueOnce(callsMany("", [create("А"), { tool: "list_tasks", args: { environmentId: "env_1" } }]))
      .mockResolvedValueOnce(answer(""));
    await collect(
      runAgent({ message: "м", environmentId: "env_1", tools, chat, deferAll: true, stopAfterDeferred: true })
    );
    expect(chat).toHaveBeenCalledTimes(2);
  });

  it("без опции (сайт) — модель спрашивается ещё раз ради ответа", async () => {
    const chat = vi
      .fn()
      .mockResolvedValueOnce(callsMany("", [create("А")]))
      .mockResolvedValueOnce(answer("Предлагаю создать."));
    const events = await collect(runAgent({ message: "м", environmentId: "env_1", tools, chat }));
    expect(chat).toHaveBeenCalledTimes(2);
    expect(events.find((e) => e.type === "text")).toEqual({ type: "text", text: "Предлагаю создать." });
  });

  it("knownTasks подписывают отложенную подзадачу без get_board", async () => {
    const subtaskTool = defineTool({
      name: "create_subtask",
      title: "Подзадача",
      description: "Подзадача.",
      inputSchema: { taskId: z.string(), title: z.string() },
      surfaces: ["chat"],
      mutation: true,
      impact: "irreversible",
      handler: vi.fn(),
    });
    const chat = vi
      .fn()
      .mockResolvedValueOnce(callsMany("", [{ tool: "create_subtask", args: { taskId: "t1", title: "согласовать бюджет" } }]));
    const events = await collect(
      runAgent({
        message: "м",
        environmentId: "env_1",
        tools: [subtaskTool],
        chat,
        deferAll: true,
        stopAfterDeferred: true,
        knownTasks: [{ id: "t1", title: "Отчёт", subtasks: [] }],
      })
    );
    expect(events.find((e) => e.type === "proposal")).toMatchObject({
      calls: [{ label: "Добавить подзадачу «согласовать бюджет» в «Отчёт»" }],
    });
  });
});
