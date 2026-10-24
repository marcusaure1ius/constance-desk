import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockGetEnvironmentById,
  mockGetColumns,
  mockGetCategories,
  mockGetTasks,
  mockGetSubtasksForTasks,
} = vi.hoisted(() => ({
  mockGetEnvironmentById: vi.fn(),
  mockGetColumns: vi.fn(),
  mockGetCategories: vi.fn(),
  mockGetTasks: vi.fn(),
  mockGetSubtasksForTasks: vi.fn(),
}));

vi.mock("@/lib/services/environments", () => ({ getEnvironmentById: mockGetEnvironmentById }));
vi.mock("@/lib/services/columns", () => ({ getColumns: mockGetColumns }));
vi.mock("@/lib/services/categories", () => ({ getCategories: mockGetCategories }));
vi.mock("@/lib/services/tasks", () => ({ getTasks: mockGetTasks }));
vi.mock("@/lib/services/subtasks", () => ({ getSubtasksForTasks: mockGetSubtasksForTasks }));

import { getBoardSnapshot, withSubtasks } from "@/lib/agent/board";

describe("getBoardSnapshot", () => {
  beforeEach(() => vi.clearAllMocks());

  it("возвращает null, если среда не найдена", async () => {
    mockGetEnvironmentById.mockResolvedValue(null);
    const res = await getBoardSnapshot("missing");
    expect(res).toBeNull();
  });

  it("собирает снимок доски", async () => {
    const env = { id: "env-1", name: "Work" };
    const columns = [{ id: "c1", title: "Бэклог" }];
    const categories = [{ id: "cat-1", name: "Запуск MVP" }];
    const tasks = [{ id: "t1", title: "Задача" }];
    mockGetEnvironmentById.mockResolvedValue(env);
    mockGetColumns.mockResolvedValue(columns);
    mockGetCategories.mockResolvedValue(categories);
    mockGetTasks.mockResolvedValue(tasks);
    mockGetSubtasksForTasks.mockResolvedValue([]);

    const res = await getBoardSnapshot("env-1");
    expect(res).toEqual({
      environment: env,
      columns,
      categories,
      tasks: [{ id: "t1", title: "Задача", subtasks: [] }],
    });
    expect(mockGetTasks).toHaveBeenCalledWith("env-1", { includeArchived: false });
  });
});

describe("withSubtasks", () => {
  beforeEach(() => vi.clearAllMocks());

  it("раскладывает подзадачи по задачам в коротком виде", async () => {
    mockGetSubtasksForTasks.mockResolvedValue([
      { id: "s1", taskId: "t1", title: "Шаг 1", dueDate: "2026-10-30", completedAt: new Date(), position: 0 },
      { id: "s2", taskId: "t1", title: "Шаг 2", dueDate: null, completedAt: null, position: 1 },
    ]);

    const res = await withSubtasks([{ id: "t1" }, { id: "t2" }]);

    expect(mockGetSubtasksForTasks).toHaveBeenCalledWith(["t1", "t2"]);
    expect(res).toEqual([
      {
        id: "t1",
        subtasks: [
          { id: "s1", title: "Шаг 1", dueDate: "2026-10-30", done: true },
          { id: "s2", title: "Шаг 2", dueDate: null, done: false },
        ],
      },
      { id: "t2", subtasks: [] },
    ]);
  });
});
