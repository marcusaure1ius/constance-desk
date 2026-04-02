import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockDb, selectChain, insertChain, updateChain, deleteChain } =
  vi.hoisted(() => {
    const selectChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn(),
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
  getColumns,
  createColumn,
  deleteColumn,
} from "@/lib/services/columns";

describe("getColumns", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.select.mockReturnValue(selectChain);
    selectChain.from.mockReturnValue(selectChain);
  });

  it("возвращает отсортированные колонки", async () => {
    const cols = [
      { id: "1", title: "Бэклог", position: 0 },
      { id: "2", title: "В работе", position: 1 },
    ];
    selectChain.orderBy.mockResolvedValue(cols);
    const result = await getColumns();
    expect(result).toEqual(cols);
  });
});

describe("createColumn", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.select.mockReturnValue(selectChain);
    selectChain.from.mockReturnValue(selectChain);
    selectChain.orderBy.mockResolvedValue([]);
    mockDb.insert.mockReturnValue(insertChain);
    insertChain.values.mockReturnValue(insertChain);
  });

  it("создаёт колонку с позицией 0 если нет других", async () => {
    const col = { id: "1", title: "Новая", position: 0 };
    insertChain.returning.mockResolvedValue([col]);
    const result = await createColumn("Новая");
    expect(result).toEqual(col);
  });

  it("создаёт колонку с правильной позицией", async () => {
    selectChain.orderBy.mockResolvedValue([
      { id: "1", title: "Первая", position: 0 },
      { id: "2", title: "Вторая", position: 1 },
    ]);
    const col = { id: "3", title: "Третья", position: 2 };
    insertChain.returning.mockResolvedValue([col]);
    const result = await createColumn("Третья");
    expect(result).toEqual(col);
  });
});

describe("deleteColumn", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.select.mockReturnValue(selectChain);
    selectChain.from.mockReturnValue(selectChain);
    mockDb.delete.mockReturnValue(deleteChain);
  });

  it("не удаляет колонку с задачами", async () => {
    selectChain.where.mockResolvedValue([{ count: 3 }]);
    const result = await deleteColumn("1");
    expect(result.error).toBeDefined();
  });

  it("удаляет пустую колонку", async () => {
    selectChain.where.mockResolvedValue([{ count: 0 }]);
    deleteChain.where.mockResolvedValue(undefined);
    const result = await deleteColumn("1");
    expect(result.error).toBeUndefined();
  });
});
