import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import {
  defineTool,
  isDeferred,
  runTool,
  selectTools,
  toFunctionSpec,
  toJsonSchema,
  toMcpResult,
  toToolMessage,
  ToolError,
  type Tool,
} from "@/lib/agent/tool-registry";

// Инструменты-пустышки: реестр проверяется отдельно, здесь — сама механика.
const tool = (
  overrides: Partial<Parameters<typeof defineTool>[0]> = {}
): Tool =>
  defineTool({
    name: "echo",
    title: "Эхо",
    description: "Вернуть аргументы.",
    inputSchema: { text: z.string(), times: z.number().int().optional() },
    surfaces: ["mcp", "chat"],
    mutation: false,
    impact: "read",
    handler: async (args) => args,
    ...overrides,
  });

describe("defineTool", () => {
  it("отдаёт handler аргументы, разобранные схемой, а не сырые", async () => {
    const handler = vi.fn(async (args: Record<string, unknown>) => args);
    const echo = tool({ handler });

    await echo.run({ text: "привет", лишнее: "вырезать" });

    expect(handler).toHaveBeenCalledWith({ text: "привет" });
  });

  it("не подставляет незаданные optional-поля", async () => {
    const handler = vi.fn(async (args: Record<string, unknown>) => args);
    await tool({ handler }).run({ text: "привет" });

    expect(Object.keys(handler.mock.calls[0][0])).toEqual(["text"]);
  });

  it("бросает ZodError на невалидном входе, не вызывая handler", async () => {
    const handler = vi.fn(async () => null);
    await expect(tool({ handler }).run({ text: 42 })).rejects.toBeInstanceOf(z.ZodError);
    expect(handler).not.toHaveBeenCalled();
  });

  it("принимает вызов без аргументов у инструмента с пустой схемой", async () => {
    const empty = tool({ inputSchema: {}, handler: async () => "готово" });
    await expect(empty.run(undefined)).resolves.toBe("готово");
  });

  it("сохраняет метаданные инструмента", () => {
    const t = tool({ name: "delete_task", surfaces: ["mcp"], mutation: true });
    expect(t.name).toBe("delete_task");
    expect(t.surfaces).toEqual(["mcp"]);
    expect(t.mutation).toBe(true);
  });
});

describe("runTool", () => {
  it("возвращает ok: true и данные handler", async () => {
    const t = tool({ handler: async () => ({ id: "t-1" }) });
    expect(await runTool(t, { text: "x" })).toEqual({ ok: true, data: { id: "t-1" } });
  });

  it("возвращает ok: false с именем поля при невалидном входе", async () => {
    const handler = vi.fn(async () => null);
    const outcome = await runTool(tool({ handler }), { text: 42 });

    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.error).toContain("text");
    expect(handler).not.toHaveBeenCalled();
  });

  it("переводит доменную ToolError в ok: false с её текстом", async () => {
    const t = tool({
      handler: async () => {
        throw new ToolError("Среда не найдена");
      },
    });
    expect(await runTool(t, { text: "x" })).toEqual({ ok: false, error: "Среда не найдена" });
  });

  it("ловит исключение сервиса", async () => {
    const t = tool({
      handler: async () => {
        throw new Error("БД недоступна");
      },
    });
    expect(await runTool(t, { text: "x" })).toEqual({ ok: false, error: "БД недоступна" });
  });

  it("переводит брошенное не-Error в общий текст", async () => {
    const t = tool({
      handler: async () => {
        throw "строка";
      },
    });
    expect(await runTool(t, { text: "x" })).toEqual({ ok: false, error: "Внутренняя ошибка" });
  });
});

describe("toMcpResult", () => {
  it("успех отдаёт текстом без isError", () => {
    const result = toMcpResult({ ok: true, data: { id: "t-1" } });
    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0].text)).toEqual({ id: "t-1" });
  });

  it("провал помечает isError: true и кладёт { error }", () => {
    const result = toMcpResult({ ok: false, error: "БД недоступна" });
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text)).toEqual({ error: "БД недоступна" });
  });

  it("undefined от handler превращается в null, а не в пустой текст", () => {
    const result = toMcpResult({ ok: true, data: undefined });
    expect(result.content[0].text).toBe("null");
  });
});

describe("toToolMessage", () => {
  it("помечает успех флагом ok и кладёт данные", () => {
    const message = toToolMessage("call_1", { ok: true, data: [{ id: "t-1" }] });
    expect(message).toMatchObject({ role: "tool", tool_call_id: "call_1" });
    expect(JSON.parse(message.content)).toEqual({ ok: true, data: [{ id: "t-1" }] });
  });

  it("помечает провал, чтобы модель отличила его от успеха", () => {
    const message = toToolMessage("call_2", { ok: false, error: "Среда не найдена" });
    expect(JSON.parse(message.content)).toEqual({ ok: false, error: "Среда не найдена" });
  });
});

describe("selectTools", () => {
  const tools = [
    tool({ name: "read_mcp_chat", surfaces: ["mcp", "chat"], mutation: false }),
    tool({ name: "write_mcp_chat", surfaces: ["mcp", "chat"], mutation: true }),
    tool({ name: "write_mcp_only", surfaces: ["mcp"], mutation: true }),
  ];
  const names = (filter: Parameters<typeof selectTools>[1]) =>
    selectTools(tools, filter).map((t) => t.name);

  it("отдаёт только инструменты своей поверхности", () => {
    expect(names({ surface: "chat" })).toEqual(["read_mcp_chat", "write_mcp_chat"]);
  });

  it("по умолчанию отдаёт и мутирующие", () => {
    expect(names({ surface: "mcp" })).toEqual([
      "read_mcp_chat",
      "write_mcp_chat",
      "write_mcp_only",
    ]);
  });

  it("includeMutations: false оставляет только читающие", () => {
    expect(names({ surface: "mcp", includeMutations: false })).toEqual(["read_mcp_chat"]);
  });
});

describe("toJsonSchema", () => {
  it("строит объектную схему с обязательными и необязательными полями", () => {
    const schema = toJsonSchema(tool());
    expect(schema).toMatchObject({
      type: "object",
      properties: { text: { type: "string" }, times: { type: "integer" } },
      required: ["text"],
    });
  });

  it("сырой shape ломает z.toJSONSchema — поэтому shape оборачивается в z.object", () => {
    const shape = { text: z.string() };
    expect(() => z.toJSONSchema(shape as never)).toThrow();
    expect(() => z.toJSONSchema(z.object(shape), { io: "input" })).not.toThrow();
  });

  it("бросает на непредставимом в JSON Schema типе (z.date)", () => {
    const withDate = tool({ inputSchema: { when: z.date() }, handler: async () => null });
    expect(() => toJsonSchema(withDate)).toThrow(/Date/i);
  });
});

describe("toFunctionSpec", () => {
  it("собирает описание для function calling", () => {
    expect(toFunctionSpec(tool({ name: "list_tasks", description: "Вернуть задачи." })))
      .toMatchObject({
        type: "function",
        function: {
          name: "list_tasks",
          description: "Вернуть задачи.",
          parameters: { type: "object" },
        },
      });
  });
});

describe("impact", () => {
  it("сохраняет impact инструмента", () => {
    expect(tool({ impact: "irreversible" }).impact).toBe("irreversible");
  });

  it("isDeferred верен только для irreversible", () => {
    expect(isDeferred(tool({ impact: "irreversible" }))).toBe(true);
    expect(isDeferred(tool({ impact: "reversible" }))).toBe(false);
    expect(isDeferred(tool({ impact: "read" }))).toBe(false);
  });
});
