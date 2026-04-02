import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockDb, selectChain, insertChain, updateChain, deleteChain } =
  vi.hoisted(() => {
    const selectChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn(),
    };
    const insertChain = {
      values: vi.fn().mockReturnThis(),
      returning: vi.fn(),
    };
    const updateChain = {
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      returning: vi.fn(),
    };
    const deleteChain = {
      where: vi.fn(),
    };
    const mockDb = {
      select: vi.fn(() => selectChain),
      insert: vi.fn(() => insertChain),
      update: vi.fn(() => updateChain),
      delete: vi.fn(() => deleteChain),
    };
    return { mockDb, selectChain, insertChain, updateChain, deleteChain };
  });

vi.mock("@/lib/db", () => ({ db: mockDb }));

import {
  getTasks,
  getTasksByColumn,
  createTask,
  updateTask,
  deleteTask,
} from "@/lib/services/tasks";

describe("getTasks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.select.mockReturnValue(selectChain);
    selectChain.from.mockReturnValue(selectChain);
  });

  it("возвращает задачи отсортированные по позиции", async () => {
    const taskList = [
      { id: "1", title: "Задача 1", position: 0 },
      { id: "2", title: "Задача 2", position: 1 },
    ];
    selectChain.orderBy.mockResolvedValue(taskList);
    const result = await getTasks();
    expect(result).toEqual(taskList);
  });
});

describe("getTasksByColumn", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.select.mockReturnValue(selectChain);
    selectChain.from.mockReturnValue(selectChain);
    selectChain.where.mockReturnValue(selectChain);
  });

  it("возвращает задачи по колонке", async () => {
    const taskList = [{ id: "1", title: "Задача", columnId: "col-1" }];
    selectChain.orderBy.mockResolvedValue(taskList);
    const result = await getTasksByColumn("col-1");
    expect(result).toEqual(taskList);
  });
});

describe("createTask", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.select.mockReturnValue(selectChain);
    selectChain.from.mockReturnValue(selectChain);
    selectChain.where.mockResolvedValue([{ max: 2 }]);
    mockDb.insert.mockReturnValue(insertChain);
    insertChain.values.mockReturnValue(insertChain);
  });

  it("создаёт задачу со следующей позицией", async () => {
    const task = {
      id: "1",
      title: "Новая задача",
      position: 3,
      columnId: "col-1",
    };
    insertChain.returning.mockResolvedValue([task]);

    const result = await createTask({
      title: "Новая задача",
      columnId: "col-1",
    });
    expect(result).toEqual(task);
  });

  it("создаёт задачу с позицией 0 в пустой колонке", async () => {
    selectChain.where.mockResolvedValue([{ max: null }]);
    const task = { id: "1", title: "Первая", position: 0, columnId: "col-1" };
    insertChain.returning.mockResolvedValue([task]);

    const result = await createTask({
      title: "Первая",
      columnId: "col-1",
    });
    expect(result).toEqual(task);
  });
});

describe("updateTask", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.update.mockReturnValue(updateChain);
    updateChain.set.mockReturnValue(updateChain);
    updateChain.where.mockReturnValue(updateChain);
  });

  it("обновляет поля задачи", async () => {
    const task = { id: "1", title: "Обновлённая", priority: "high" };
    updateChain.returning.mockResolvedValue([task]);

    const result = await updateTask("1", {
      title: "Обновлённая",
      priority: "high",
    });
    expect(result).toEqual(task);
  });
});

describe("deleteTask", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.delete.mockReturnValue(deleteChain);
  });

  it("удаляет задачу", async () => {
    deleteChain.where.mockResolvedValue(undefined);
    await expect(deleteTask("1")).resolves.not.toThrow();
  });
});
