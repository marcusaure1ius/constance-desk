import { describe, it, expect, vi, beforeEach } from "vitest";
import { columnRefs } from "./helpers/sql-conditions";

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
  getArchivedTasks,
  restoreTask,
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

describe("getArchivedTasks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.select.mockReturnValue(selectChain);
    selectChain.from.mockReturnValue(selectChain);
  });

  it("возвращает архивные задачи, отсортированные по дате выполнения", async () => {
    const envColumns = [{ id: "col-1" }];
    const archived = [{ id: "a1", title: "Старая задача" }];
    // select колонок среды
    selectChain.where.mockResolvedValueOnce(envColumns);
    // select задач: where -> chain, orderBy -> результат
    selectChain.where.mockReturnValueOnce(selectChain);
    selectChain.orderBy.mockResolvedValue(archived);
    const result = await getArchivedTasks("env-1");
    expect(result).toEqual(archived);
  });

  it("возвращает пустой массив, если у среды нет колонок", async () => {
    selectChain.where.mockResolvedValueOnce([]);
    const result = await getArchivedTasks("env-1");
    expect(result).toEqual([]);
  });
});

describe("restoreTask", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.select.mockReturnValue(selectChain);
    selectChain.from.mockReturnValue(selectChain);
    mockDb.update.mockReturnValue(updateChain);
    updateChain.set.mockReturnValue(updateChain);
    updateChain.where.mockReturnValue(updateChain);
  });

  it("сбрасывает completedAt в null и возвращает задачу", async () => {
    const task = { id: "1", title: "Задача", completedAt: null };
    // текущая задача
    selectChain.where.mockResolvedValueOnce([{ columnId: "col-2" }]);
    // среда колонки
    selectChain.where.mockResolvedValueOnce([{ environmentId: "env-1" }]);
    // колонки среды по возрастанию позиции
    selectChain.where.mockReturnValueOnce(selectChain);
    selectChain.orderBy.mockResolvedValueOnce([{ id: "col-1" }, { id: "col-2" }]);
    // максимум позиции в целевой колонке
    selectChain.where.mockResolvedValueOnce([{ max: 0 }]);
    updateChain.returning.mockResolvedValue([task]);

    const result = await restoreTask("1");

    expect(result).toEqual(task);
    const setArg = updateChain.set.mock.calls[0][0];
    expect(setArg.completedAt).toBeNull();
  });

  it("возвращает задачу из последней колонки в предпоследнюю", async () => {
    // Регрессия: раньше снималась только дата закрытия, а задача оставалась
    // в «Готово» — прогресс дорожки считает её выполненной по колонке.
    const task = { id: "1", title: "Задача", completedAt: null };
    selectChain.where.mockResolvedValueOnce([{ columnId: "col-done" }]);
    selectChain.where.mockResolvedValueOnce([{ environmentId: "env-1" }]);
    selectChain.where.mockReturnValueOnce(selectChain);
    selectChain.orderBy.mockResolvedValueOnce([
      { id: "col-backlog" },
      { id: "col-doing" },
      { id: "col-done" },
    ]);
    // максимум позиции в целевой колонке
    selectChain.where.mockResolvedValueOnce([{ max: 7 }]);
    updateChain.returning.mockResolvedValue([task]);

    await restoreTask("1");

    const setArg = updateChain.set.mock.calls[0][0];
    expect(setArg.columnId).toBe("col-doing");
    expect(setArg.completedAt).toBeNull();
    // Позиция обязательна: без неё задача столкнётся с занятым индексом
    // в целевой колонке, а доска сортирует именно по position.
    expect(setArg.position).toBe(8);

    // Колонки берутся внутри среды задачи, а не глобально по всем проектам.
    const envCondition = selectChain.where.mock.calls[2][0];
    expect(columnRefs(envCondition)).toContain("environment_id");
  });

  it("не трогает колонку, если задача не в последней", async () => {
    const task = { id: "1", title: "Задача", completedAt: null };
    selectChain.where.mockResolvedValueOnce([{ columnId: "col-doing" }]);
    selectChain.where.mockResolvedValueOnce([{ environmentId: "env-1" }]);
    selectChain.where.mockReturnValueOnce(selectChain);
    selectChain.orderBy.mockResolvedValueOnce([
      { id: "col-backlog" },
      { id: "col-doing" },
      { id: "col-done" },
    ]);
    updateChain.returning.mockResolvedValue([task]);

    await restoreTask("1");

    const setArg = updateChain.set.mock.calls[0][0];
    expect(setArg.columnId).toBeUndefined();
  });

  it("не двигает задачу, если в среде единственная колонка", async () => {
    const task = { id: "1", title: "Задача", completedAt: null };
    selectChain.where.mockResolvedValueOnce([{ columnId: "col-only" }]);
    selectChain.where.mockResolvedValueOnce([{ environmentId: "env-1" }]);
    selectChain.where.mockReturnValueOnce(selectChain);
    selectChain.orderBy.mockResolvedValueOnce([{ id: "col-only" }]);
    updateChain.returning.mockResolvedValue([task]);

    await restoreTask("1");

    const setArg = updateChain.set.mock.calls[0][0];
    expect(setArg.columnId).toBeUndefined();
    expect(setArg.completedAt).toBeNull();
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

  it("проставляет completedAt при создании в последней колонке", async () => {
    selectChain.where.mockResolvedValueOnce([{ max: 0 }]); // max позиции задач
    selectChain.where.mockResolvedValueOnce([
      { position: 2, environmentId: "env-1" },
    ]); // сведения о колонке
    selectChain.where.mockResolvedValueOnce([{ maxPos: 2 }]); // max позиции колонок среды
    const task = { id: "1", title: "Готовая", columnId: "done-col" };
    insertChain.returning.mockResolvedValue([task]);

    await createTask({ title: "Готовая", columnId: "done-col" });

    const values = insertChain.values.mock.calls[0][0];
    expect(values.completedAt).toBeInstanceOf(Date);
  });

  it("не проставляет completedAt в обычной колонке", async () => {
    selectChain.where.mockResolvedValueOnce([{ max: 0 }]);
    selectChain.where.mockResolvedValueOnce([
      { position: 0, environmentId: "env-1" },
    ]);
    selectChain.where.mockResolvedValueOnce([{ maxPos: 2 }]);
    const task = { id: "1", title: "Обычная", columnId: "todo-col" };
    insertChain.returning.mockResolvedValue([task]);

    await createTask({ title: "Обычная", columnId: "todo-col" });

    const values = insertChain.values.mock.calls[0][0];
    expect(values.completedAt).toBeNull();
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
    // isLastColumn: сама колонка, затем максимум позиции в её среде
    selectChain.where.mockResolvedValueOnce([{ position: 1, environmentId: "env-1" }]);
    selectChain.where.mockResolvedValueOnce([{ maxPos: 2 }]);
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

  it("не помечает выполненной задачу, попавшую в последнюю колонку ЧУЖОЙ среды", async () => {
    // Регрессия: раньше последняя колонка искалась глобально по всем средам,
    // и задача в непоследней колонке своего проекта получала completedAt,
    // если её колонка оказывалась последней по глобальной позиции.
    selectChain.where.mockResolvedValueOnce([{ columnId: "col-a1" }]);
    // целевая колонка: позиция 5 — но в своей среде максимум 9
    selectChain.where.mockResolvedValueOnce([{ position: 5, environmentId: "env-a" }]);
    selectChain.where.mockResolvedValueOnce([{ maxPos: 9 }]);
    updateChain.where.mockResolvedValueOnce(undefined);
    selectChain.where.mockReturnValueOnce(selectChain);
    selectChain.orderBy.mockResolvedValueOnce([]);
    updateChain.where.mockResolvedValue(undefined);
    selectChain.where.mockReturnValueOnce(selectChain);
    selectChain.orderBy.mockResolvedValueOnce([]);

    await moveTask("t1", "col-a2", 0);

    const setArg = updateChain.set.mock.calls[0][0];
    expect(setArg.completedAt).toBeNull();

    // Ключевая проверка регрессии: максимум позиции ищется среди колонок ОДНОЙ
    // среды. Без этого утверждения тест прошёл бы и на глобальном запросе —
    // мок возвращает одни и те же данные независимо от WHERE.
    const maxPosCondition = selectChain.where.mock.calls[2][0];
    expect(columnRefs(maxPosCondition)).toContain("environment_id");
  });

  it("помечает выполненной задачу в последней колонке СВОЕЙ среды", async () => {
    selectChain.where.mockResolvedValueOnce([{ columnId: "col-a1" }]);
    selectChain.where.mockResolvedValueOnce([{ position: 9, environmentId: "env-a" }]);
    selectChain.where.mockResolvedValueOnce([{ maxPos: 9 }]);
    updateChain.where.mockResolvedValueOnce(undefined);
    selectChain.where.mockReturnValueOnce(selectChain);
    selectChain.orderBy.mockResolvedValueOnce([]);
    updateChain.where.mockResolvedValue(undefined);
    selectChain.where.mockReturnValueOnce(selectChain);
    selectChain.orderBy.mockResolvedValueOnce([]);

    await moveTask("t1", "col-a-done", 0);

    const setArg = updateChain.set.mock.calls[0][0];
    expect(setArg.completedAt).toBeInstanceOf(Date);
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
