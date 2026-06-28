import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockGetEnvironmentById,
  mockGetColumns,
  mockGetCategories,
  mockCreateCategory,
  mockCreateTask,
} = vi.hoisted(() => ({
  mockGetEnvironmentById: vi.fn(),
  mockGetColumns: vi.fn(),
  mockGetCategories: vi.fn(),
  mockCreateCategory: vi.fn(),
  mockCreateTask: vi.fn(),
}));

vi.mock("@/lib/services/environments", () => ({ getEnvironmentById: mockGetEnvironmentById }));
vi.mock("@/lib/services/columns", () => ({ getColumns: mockGetColumns }));
vi.mock("@/lib/services/categories", () => ({
  getCategories: mockGetCategories,
  createCategory: mockCreateCategory,
}));
vi.mock("@/lib/services/tasks", () => ({ createTask: mockCreateTask }));

import { createEpicTask } from "@/lib/agent/epic-task";

const baseInput = {
  environmentId: "env-1",
  epicName: "Запуск MVP",
  columnName: "Бэклог",
  title: "Подготовить список задач",
};

describe("createEpicTask", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetEnvironmentById.mockResolvedValue({ id: "env-1", name: "Work" });
    mockGetColumns.mockResolvedValue([{ id: "col-1", title: "Бэклог" }]);
  });

  it("ошибка, если среда не найдена", async () => {
    mockGetEnvironmentById.mockResolvedValue(null);
    const res = await createEpicTask(baseInput);
    expect(res).toEqual({ ok: false, error: "Среда не найдена" });
  });

  it("ошибка, если колонка не найдена", async () => {
    mockGetColumns.mockResolvedValue([{ id: "col-1", title: "Готово" }]);
    const res = await createEpicTask(baseInput);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("Бэклог");
  });

  it("создаёт эпик, если его нет", async () => {
    mockGetCategories.mockResolvedValue([]);
    const cat = { id: "cat-1", name: "Запуск MVP" };
    const task = { id: "task-1", title: baseInput.title, columnId: "col-1", categoryId: "cat-1" };
    mockCreateCategory.mockResolvedValue(cat);
    mockCreateTask.mockResolvedValue(task);

    const res = await createEpicTask(baseInput);
    expect(res).toEqual({ ok: true, task, category: cat, createdCategory: true });
    expect(mockCreateCategory).toHaveBeenCalledWith("Запуск MVP", undefined, "env-1");
    expect(mockCreateTask).toHaveBeenCalledWith({
      title: baseInput.title,
      description: undefined,
      columnId: "col-1",
      categoryId: "cat-1",
      priority: undefined,
      plannedDate: undefined,
    });
  });

  it("переиспользует существующий эпик", async () => {
    const cat = { id: "cat-1", name: "Запуск MVP" };
    const task = { id: "task-2", title: baseInput.title, columnId: "col-1", categoryId: "cat-1" };
    mockGetCategories.mockResolvedValue([cat]);
    mockCreateTask.mockResolvedValue(task);

    const res = await createEpicTask(baseInput);
    expect(res).toEqual({ ok: true, task, category: cat, createdCategory: false });
    expect(mockCreateCategory).not.toHaveBeenCalled();
  });
});
