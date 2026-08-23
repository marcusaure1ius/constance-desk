import { describe, it, expect, vi, beforeEach } from "vitest";

// Провал инструмента должен доезжать до клиента с флагом isError: без него
// модель видит обычный текст и не отличает ошибку от результата.
const mocks = vi.hoisted(() => ({
  getEnvironments: vi.fn(),
  getBoardSnapshot: vi.fn(),
  getTasks: vi.fn(),
  createTask: vi.fn(),
  updateTask: vi.fn(),
  moveTask: vi.fn(),
  deleteTask: vi.fn(),
  createCategory: vi.fn(),
  createEpicTask: vi.fn(),
}));

vi.mock("@/lib/services/environments", () => ({ getEnvironments: mocks.getEnvironments }));
vi.mock("@/lib/agent/board", () => ({ getBoardSnapshot: mocks.getBoardSnapshot }));
vi.mock("@/lib/agent/epic-task", () => ({ createEpicTask: mocks.createEpicTask }));
vi.mock("@/lib/services/categories", () => ({ createCategory: mocks.createCategory }));
vi.mock("@/lib/services/tasks", () => ({
  getTasks: mocks.getTasks,
  createTask: mocks.createTask,
  updateTask: mocks.updateTask,
  moveTask: mocks.moveTask,
  deleteTask: mocks.deleteTask,
}));

import { POST } from "@/app/api/mcp/[transport]/route";

const KEY = "secret-agent-key";

async function callTool(name: string, args: Record<string, unknown> = {}) {
  const res = await POST(
    new Request("http://localhost:3000/api/mcp/mcp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${KEY}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name, arguments: args },
      }),
    })
  );
  const text = await res.text();
  const line = text.split("\n").find((l) => l.startsWith("data:"))!;
  const message = JSON.parse(line.slice("data:".length).trim()) as {
    result: { content: { text: string }[]; isError?: boolean };
  };
  return {
    isError: message.result.isError,
    payload: JSON.parse(message.result.content[0].text),
  };
}

describe("MCP route: признак ошибки в ответе инструмента", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("AGENT_API_KEY", KEY);
  });

  it("успех приходит без isError", async () => {
    mocks.getEnvironments.mockResolvedValue([{ id: "env-1" }]);
    const { isError, payload } = await callTool("list_environments");
    expect(isError).toBeUndefined();
    expect(payload).toEqual([{ id: "env-1" }]);
  });

  it("падение сервиса помечается isError: true", async () => {
    mocks.createTask.mockRejectedValue(new Error("БД недоступна"));
    const { isError, payload } = await callTool("create_task", {
      title: "Задача",
      columnId: "col-1",
    });
    expect(isError).toBe(true);
    expect(payload).toEqual({ error: "БД недоступна" });
  });

  it("доменный отказ помечается isError: true", async () => {
    mocks.getBoardSnapshot.mockResolvedValue(null);
    const { isError, payload } = await callTool("get_board", { environmentId: "missing" });
    expect(isError).toBe(true);
    expect(payload).toEqual({ error: "Среда не найдена" });
  });
});
