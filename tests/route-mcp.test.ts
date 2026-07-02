import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Моки сервисного слоя, на который опираются MCP-tools ---
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
const URL = "http://localhost:3000/api/mcp/mcp";

function rpc(body: unknown, token: string | null = KEY) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return new Request(URL, { method: "POST", headers, body: JSON.stringify(body) });
}

// Ответ транспорта — SSE: "event: message\ndata: {json}\n\n". Достаём JSON-RPC сообщение.
function parseSse(text: string): { result?: { content: { text: string }[] }; error?: unknown } {
  const line = text.split("\n").find((l) => l.startsWith("data:"));
  if (!line) throw new Error(`Нет data-строки в SSE: ${text}`);
  return JSON.parse(line.slice("data:".length).trim());
}

// Вызвать tool и вернуть распарсенный полезный payload (tools возвращают JSON-текст).
async function callTool(name: string, args: Record<string, unknown> = {}) {
  const res = await POST(
    rpc({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } })
  );
  expect(res.status).toBe(200);
  const msg = parseSse(await res.text());
  return JSON.parse(msg.result!.content[0].text);
}

describe("MCP route /api/mcp/[transport]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("AGENT_API_KEY", KEY);
  });

  describe("авторизация (withMcpAuth)", () => {
    it("401 без Bearer-токена", async () => {
      const res = await POST(rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }, null));
      expect(res.status).toBe(401);
      expect(res.headers.get("www-authenticate")).toContain("Bearer");
    });

    it("401 с неверным токеном", async () => {
      const res = await POST(rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }, "wrong"));
      expect(res.status).toBe(401);
      expect(mocks.getEnvironments).not.toHaveBeenCalled();
    });

    it("пропускает запрос с верным токеном", async () => {
      mocks.getEnvironments.mockResolvedValue([]);
      const res = await POST(
        rpc({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "list_environments", arguments: {} } })
      );
      expect(res.status).toBe(200);
    });
  });

  describe("tools/list", () => {
    it("регистрирует все 9 инструментов", async () => {
      const res = await POST(rpc({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }));
      const msg = parseSse(await res.text()) as unknown as { result: { tools: { name: string }[] } };
      const names = msg.result.tools.map((t) => t.name).sort();
      expect(names).toEqual(
        [
          "create_epic",
          "create_epic_task",
          "create_task",
          "delete_task",
          "get_board",
          "list_environments",
          "list_tasks",
          "move_task",
          "update_task",
        ]
      );
    });
  });

  describe("list_environments", () => {
    it("возвращает среды из сервиса", async () => {
      mocks.getEnvironments.mockResolvedValue([{ id: "env-1", name: "Проект" }]);
      const data = await callTool("list_environments");
      expect(data).toEqual([{ id: "env-1", name: "Проект" }]);
    });
  });

  describe("get_board", () => {
    it("возвращает снимок доски, если среда найдена", async () => {
      const snapshot = { environment: { id: "env-1" }, columns: [], categories: [], tasks: [] };
      mocks.getBoardSnapshot.mockResolvedValue(snapshot);
      const data = await callTool("get_board", { environmentId: "env-1" });
      expect(data).toEqual(snapshot);
      expect(mocks.getBoardSnapshot).toHaveBeenCalledWith("env-1", undefined);
    });

    it("возвращает ошибку, если среда не найдена", async () => {
      mocks.getBoardSnapshot.mockResolvedValue(null);
      const data = await callTool("get_board", { environmentId: "missing" });
      expect(data).toEqual({ error: "Среда не найдена" });
    });

    it("пробрасывает includeArchived в getBoardSnapshot", async () => {
      const snapshot = { environment: { id: "env-1" }, columns: [], categories: [], tasks: [] };
      mocks.getBoardSnapshot.mockResolvedValue(snapshot);
      await callTool("get_board", { environmentId: "env-1", includeArchived: true });
      expect(mocks.getBoardSnapshot).toHaveBeenCalledWith("env-1", true);
    });
  });

  describe("list_tasks", () => {
    it("по умолчанию исключает архив (includeArchived undefined)", async () => {
      mocks.getTasks.mockResolvedValue([{ id: "t-1" }]);
      const data = await callTool("list_tasks", { environmentId: "env-1" });
      expect(data).toEqual([{ id: "t-1" }]);
      expect(mocks.getTasks).toHaveBeenCalledWith("env-1", { includeArchived: undefined });
    });

    it("пробрасывает includeArchived: true", async () => {
      mocks.getTasks.mockResolvedValue([]);
      await callTool("list_tasks", { environmentId: "env-1", includeArchived: true });
      expect(mocks.getTasks).toHaveBeenCalledWith("env-1", { includeArchived: true });
    });
  });

  describe("create_task", () => {
    it("создаёт задачу и пробрасывает аргументы в сервис", async () => {
      const task = { id: "t-1", title: "Задача" };
      mocks.createTask.mockResolvedValue(task);
      const data = await callTool("create_task", { title: "Задача", columnId: "col-1" });
      expect(data).toEqual(task);
      expect(mocks.createTask).toHaveBeenCalledWith({ title: "Задача", columnId: "col-1" });
    });

    it("оборачивает исключение сервиса в { error } (safeJson)", async () => {
      mocks.createTask.mockRejectedValue(new Error("БД недоступна"));
      const data = await callTool("create_task", { title: "X", columnId: "col-1" });
      expect(data).toEqual({ error: "БД недоступна" });
    });
  });

  describe("create_epic_task", () => {
    it("возвращает task/category/createdCategory при успехе", async () => {
      mocks.createEpicTask.mockResolvedValue({
        ok: true,
        task: { id: "t-1" },
        category: { id: "c-1" },
        createdCategory: true,
      });
      const data = await callTool("create_epic_task", {
        environmentId: "env-1",
        epicName: "Запуск MVP",
        columnName: "Бэклог",
        title: "Задача",
      });
      expect(data).toEqual({ task: { id: "t-1" }, category: { id: "c-1" }, createdCategory: true });
    });

    it("возвращает { error } при неуспехе (result.ok === false)", async () => {
      mocks.createEpicTask.mockResolvedValue({ ok: false, error: 'Колонка "Бэклог" не найдена' });
      const data = await callTool("create_epic_task", {
        environmentId: "env-1",
        epicName: "Запуск MVP",
        columnName: "Бэклог",
        title: "Задача",
      });
      expect(data).toEqual({ error: 'Колонка "Бэклог" не найдена' });
    });
  });

  describe("move_task и delete_task", () => {
    it("move_task возвращает { success: true } и вызывает сервис", async () => {
      mocks.moveTask.mockResolvedValue(undefined);
      const data = await callTool("move_task", {
        taskId: "t-1",
        targetColumnId: "col-2",
        targetPosition: 0,
      });
      expect(data).toEqual({ success: true });
      expect(mocks.moveTask).toHaveBeenCalledWith("t-1", "col-2", 0);
    });

    it("delete_task возвращает { success: true } и вызывает сервис", async () => {
      mocks.deleteTask.mockResolvedValue(undefined);
      const data = await callTool("delete_task", { id: "t-1" });
      expect(data).toEqual({ success: true });
      expect(mocks.deleteTask).toHaveBeenCalledWith("t-1");
    });
  });

  describe("update_task", () => {
    it("отделяет id и передаёт остальные поля в updateTask", async () => {
      const updated = { id: "t-1", title: "Новое" };
      mocks.updateTask.mockResolvedValue(updated);
      const data = await callTool("update_task", { id: "t-1", title: "Новое", priority: "high" });
      expect(data).toEqual(updated);
      expect(mocks.updateTask).toHaveBeenCalledWith("t-1", { title: "Новое", priority: "high" });
    });

    it("отклоняет неверный формат plannedDate (zod-валидация схемы tool)", async () => {
      const res = await POST(
        rpc({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "update_task", arguments: { id: "t-1", plannedDate: "30-06-2026" } },
        })
      );
      const msg = parseSse(await res.text());
      // невалидный аргумент → tool не выполняется, updateTask не вызывается
      expect(mocks.updateTask).not.toHaveBeenCalled();
      expect(JSON.stringify(msg)).toMatch(/plannedDate|invalid|Invalid/i);
    });
  });
});
