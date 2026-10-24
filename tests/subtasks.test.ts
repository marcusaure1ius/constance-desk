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
  getSubtasksForTasks,
  createSubtask,
  updateSubtask,
  deleteSubtask,
} from "@/lib/services/subtasks";

beforeEach(() => {
  vi.clearAllMocks();
  mockDb.select.mockReturnValue(selectChain);
  selectChain.from.mockReturnValue(selectChain);
  mockDb.insert.mockReturnValue(insertChain);
  insertChain.values.mockReturnValue(insertChain);
  mockDb.update.mockReturnValue(updateChain);
  updateChain.set.mockReturnValue(updateChain);
  updateChain.where.mockReturnValue(updateChain);
});

describe("getSubtasksForTasks", () => {
  it("без задач не ходит в базу", async () => {
    expect(await getSubtasksForTasks([])).toEqual([]);
    expect(mockDb.select).not.toHaveBeenCalled();
  });

  it("возвращает подзадачи по позиции", async () => {
    const rows = [{ id: "s1", taskId: "t1", position: 0 }];
    selectChain.where.mockReturnValue(selectChain);
    selectChain.orderBy.mockResolvedValue(rows);
    expect(await getSubtasksForTasks(["t1"])).toEqual(rows);
  });
});

describe("createSubtask", () => {
  it("ставит следующую позицию, сегодняшнюю дату начала и срок", async () => {
    selectChain.where.mockResolvedValue([{ max: 1 }]);
    insertChain.returning.mockResolvedValue([{ id: "s1" }]);

    await createSubtask({ taskId: "t1", title: "  Позвонить  ", dueDate: "2026-10-30" });

    const values = insertChain.values.mock.calls[0][0];
    expect(values).toMatchObject({
      taskId: "t1",
      title: "Позвонить",
      position: 2,
      dueDate: "2026-10-30",
    });
    expect(values.startDate).toBe(new Date().toISOString().split("T")[0]);
  });

  it("первая подзадача без срока — позиция 0, срок null", async () => {
    selectChain.where.mockResolvedValue([{ max: null }]);
    insertChain.returning.mockResolvedValue([{ id: "s1" }]);

    await createSubtask({ taskId: "t1", title: "Первая" });

    expect(insertChain.values.mock.calls[0][0]).toMatchObject({ position: 0, dueDate: null });
  });

  it("пустое название отвергает", async () => {
    await expect(createSubtask({ taskId: "t1", title: "   " })).rejects.toThrow();
    expect(mockDb.insert).not.toHaveBeenCalled();
  });
});

describe("updateSubtask", () => {
  it("done=true проставляет completedAt, false — снимает", async () => {
    updateChain.returning.mockResolvedValue([{ id: "s1" }]);

    await updateSubtask("s1", { done: true });
    expect(updateChain.set.mock.calls[0][0].completedAt).toBeInstanceOf(Date);
    expect(updateChain.set.mock.calls[0][0]).not.toHaveProperty("done");

    await updateSubtask("s1", { done: false });
    expect(updateChain.set.mock.calls[1][0].completedAt).toBeNull();
  });

  it("меняет срок, не трогая отметку о выполнении", async () => {
    updateChain.returning.mockResolvedValue([{ id: "s1" }]);
    await updateSubtask("s1", { dueDate: null });
    const patch = updateChain.set.mock.calls[0][0];
    expect(patch.dueDate).toBeNull();
    expect(patch).not.toHaveProperty("completedAt");
  });

  it("пустое название отвергает", async () => {
    await expect(updateSubtask("s1", { title: " " })).rejects.toThrow();
    expect(mockDb.update).not.toHaveBeenCalled();
  });
});

describe("deleteSubtask", () => {
  it("удаляет по id", async () => {
    deleteChain.where.mockResolvedValue(undefined);
    await deleteSubtask("s1");
    expect(mockDb.delete).toHaveBeenCalled();
  });
});
