import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { applyAgentCalls } from "@/lib/agent/apply";
import { defineTool, type Tool } from "@/lib/agent/tool-registry";

const handler = vi.fn(async (args: { title: string }) => ({ id: "task_1", ...args }));

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

describe("applyAgentCalls", () => {
  it("исполняет вызовы по порядку", async () => {
    const results = await applyAgentCalls(
      [
        { tool: "create_task", args: { title: "Первая" } },
        { tool: "create_task", args: { title: "Вторая" } },
      ],
      tools
    );

    expect(results.every((r) => r.ok)).toBe(true);
    expect(handler.mock.calls.map(([a]) => a.title)).toEqual(["Первая", "Вторая"]);
  });

  it("неизвестный инструмент — провал, а не исключение", async () => {
    const [result] = await applyAgentCalls([{ tool: "drop_database", args: {} }], tools);
    expect(result).toEqual({ ok: false, error: "Неизвестный инструмент: drop_database" });
  });

  it("плохие аргументы возвращаются провалом", async () => {
    const [result] = await applyAgentCalls([{ tool: "create_task", args: {} }], tools);
    expect(result.ok).toBe(false);
  });
});
