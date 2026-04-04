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
  createTasksBatch,
  updateTask,
  deleteTask,
  moveTask,
  getTasksForToday,
} from "@/lib/services/tasks";

describe("getTasks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.select.mockReturnValue(selectChain);
    selectChain.from.mockReturnValue(selectChain);
  });

  it("возвращает задачи отсортированные по позиции", async () => {
    const envColumns = [{ id: "col-1" }, { id: "col-2" }];
    const taskList = [
      { id: "1", title: "Задача 1", position: 0 },
      { id: "2", title: "Задача 2", position: 1 },
    ];
    // Первый вызов select — колонки среды
    selectChain.where.mockResolvedValueOnce(envColumns);
    // Второй вызов select — задачи
    selectChain.where.mockReturnValueOnce(selectChain);
    selectChain.orderBy.mockResolvedValue(taskList);
    const result = await getTasks("env-1");
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

describe("moveTask", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.select.mockReturnValue(selectChain);
    selectChain.from.mockReturnValue(selectChain);
    mockDb.update.mockReturnValue(updateChain);
    updateChain.set.mockReturnValue(updateChain);
  });

  it("перемещает задачу в другую колонку", async () => {
    // currentTask
    selectChain.where.mockResolvedValueOnce([{ columnId: "col-1" }]);
    // allColumns ordered by desc position
    selectChain.orderBy.mockResolvedValueOnce([
      { id: "col-3", position: 2 },
      { id: "col-2", position: 1 },
      { id: "col-1", position: 0 },
    ]);
    // update task
    updateChain.where.mockResolvedValueOnce(undefined);
    // tasks in target column
    selectChain.where.mockReturnValueOnce(selectChain);
    selectChain.orderBy.mockResolvedValueOnce([
      { id: "t1", position: 0 },
      { id: "t2", position: 1 },
    ]);
    // renumber target
    updateChain.where.mockResolvedValue(undefined);
    // tasks in source column
    selectChain.where.mockReturnValueOnce(selectChain);
    selectChain.orderBy.mockResolvedValueOnce([]);

    await expect(moveTask("t1", "col-2", 0)).resolves.not.toThrow();
  });
});

describe("createTasksBatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.select.mockReturnValue(selectChain);
    selectChain.from.mockReturnValue(selectChain);
    mockDb.insert.mockReturnValue(insertChain);
    insertChain.values.mockReturnValue(insertChain);
  });

  it("создаёт несколько задач последовательно", async () => {
    const task1 = { id: "1", title: "Первая", position: 0, columnId: "col-1" };
    const task2 = { id: "2", title: "Вторая", position: 1, columnId: "col-1" };
    selectChain.where.mockResolvedValueOnce([{ max: null }]);
    insertChain.returning.mockResolvedValueOnce([task1]);
    selectChain.where.mockResolvedValueOnce([{ max: 0 }]);
    insertChain.returning.mockResolvedValueOnce([task2]);

    const result = await createTasksBatch([
      { title: "Первая", columnId: "col-1" },
      { title: "Вторая", columnId: "col-1" },
    ]);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual(task1);
    expect(result[1]).toEqual(task2);
  });

  it("возвращает пустой массив для пустого ввода", async () => {
    const result = await createTasksBatch([]);
    expect(result).toEqual([]);
  });
});

describe("getTasksForToday", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.select.mockReturnValue(selectChain);
    selectChain.from.mockReturnValue(selectChain);
  });

  it("возвращает задачи на сегодня", async () => {
    // envColumns
    selectChain.where.mockResolvedValueOnce([{ id: "col-1" }]);
    // tasks for today
    selectChain.where.mockReturnValueOnce(selectChain);
    const todayTasks = [{ id: "1", title: "Задача на сегодня" }];
    selectChain.orderBy.mockResolvedValue(todayTasks);
    const result = await getTasksForToday("env-1");
    expect(result).toEqual(todayTasks);
  });

  it("возвращает пустой массив если нет колонок", async () => {
    selectChain.where.mockResolvedValueOnce([]);
    const result = await getTasksForToday("env-1");
    expect(result).toEqual([]);
  });
});
