import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";
import { applyAgentCalls } from "@/lib/agent/apply";
import { defineTool, type Tool } from "@/lib/agent/tool-registry";

describe("applyAgentCalls", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("исполняет вызовы последовательно, без параллелизма", async () => {
    let maxInFlight = 0;
    let inFlight = 0;

    const handler = vi.fn(async (args: { title: string }) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);

      // Имитируем внутреннюю асинхронность (например, сохранение в БД)
      await new Promise((resolve) => setTimeout(resolve, 1));

      inFlight--;
      return { id: "task_1", ...args };
    });

    const tools: Tool[] = [
      defineTool({
        name: "create_task",
        title: "Создать",
        description: "Создать задачу.",
        inputSchema: { title: z.string() },
        surfaces: ["chat"],
        mutation: true,
        impact: "irreversible",
        handler,
      }),
    ];

    const results = await applyAgentCalls(
      [
        { tool: "create_task", args: { title: "Первая" } },
        { tool: "create_task", args: { title: "Вторая" } },
        { tool: "create_task", args: { title: "Третья" } },
      ],
      tools
    );

    expect(results.every((r) => r.ok)).toBe(true);
    expect(handler.mock.calls.map(([a]) => a.title)).toEqual(["Первая", "Вторая", "Третья"]);
    expect(maxInFlight).toBe(1); // Никогда не было двух одновременных вызовов
  });

  it("неизвестный инструмент — провал, а не исключение", async () => {
    const [result] = await applyAgentCalls([{ tool: "drop_database", args: {} }], []);
    expect(result).toEqual({ ok: false, error: "Неизвестный инструмент: drop_database" });
  });

  it("плохие аргументы возвращаются провалом", async () => {
    const handler = vi.fn();
    const tools: Tool[] = [
      defineTool({
        name: "create_task",
        title: "Создать",
        description: "Создать задачу.",
        inputSchema: { title: z.string() },
        surfaces: ["chat"],
        mutation: true,
        impact: "irreversible",
        handler,
      }),
    ];

    const [result] = await applyAgentCalls([{ tool: "create_task", args: {} }], tools);
    expect(result.ok).toBe(false);
  });

  it("частичный провал: часть вызовов успешна, часть упала", async () => {
    const handler = vi.fn(async (args: { title: string }) => {
      if (args.title === "Вторая") {
        throw new Error("Ошибка сохранения");
      }
      return { id: "task_1", ...args };
    });

    const tools: Tool[] = [
      defineTool({
        name: "create_task",
        title: "Создать",
        description: "Создать задачу.",
        inputSchema: { title: z.string() },
        surfaces: ["chat"],
        mutation: true,
        impact: "irreversible",
        handler,
      }),
    ];

    const results = await applyAgentCalls(
      [
        { tool: "create_task", args: { title: "Первая" } },
        { tool: "create_task", args: { title: "Вторая" } },
        { tool: "create_task", args: { title: "Третья" } },
      ],
      tools
    );

    expect(results[0].ok).toBe(true);
    expect(results[1].ok).toBe(false);
    expect(results[2].ok).toBe(true);
    if (!results[1].ok) {
      expect(results[1].error).toContain("Ошибка сохранения");
    }
  });
});
