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
  getCategories,
  createCategory,
  updateCategory,
  deleteCategory,
} from "@/lib/services/categories";

describe("getCategories", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.select.mockReturnValue(selectChain);
    selectChain.from.mockReturnValue(selectChain);
  });

  it("возвращает категории отсортированные по имени", async () => {
    const cats = [
      { id: "1", name: "Баги", color: "#f00" },
      { id: "2", name: "Фичи", color: "#0f0" },
    ];
    selectChain.orderBy.mockResolvedValue(cats);
    const result = await getCategories("env-1");
    expect(result).toEqual(cats);
  });
});

describe("createCategory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.insert.mockReturnValue(insertChain);
    insertChain.values.mockReturnValue(insertChain);
  });

  it("создаёт категорию с цветом", async () => {
    const cat = { id: "1", name: "Баги", color: "#f00" };
    insertChain.returning.mockResolvedValue([cat]);
    const result = await createCategory("Баги", "#f00", "env-1");
    expect(result).toEqual(cat);
  });

  it("создаёт категорию без цвета", async () => {
    const cat = { id: "2", name: "Другое", color: undefined };
    insertChain.returning.mockResolvedValue([cat]);
    const result = await createCategory("Другое", undefined, "env-1");
    expect(result).toEqual(cat);
  });
});

describe("updateCategory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.update.mockReturnValue(updateChain);
    updateChain.set.mockReturnValue(updateChain);
    updateChain.where.mockReturnValue(updateChain);
  });

  it("обновляет название категории", async () => {
    const cat = { id: "1", name: "Новое имя", color: "#f00" };
    updateChain.returning.mockResolvedValue([cat]);
    const result = await updateCategory("1", { name: "Новое имя" });
    expect(result).toEqual(cat);
  });
});

describe("deleteCategory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.delete.mockReturnValue(deleteChain);
  });

  it("удаляет категорию", async () => {
    deleteChain.where.mockResolvedValue(undefined);
    await expect(deleteCategory("1")).resolves.not.toThrow();
  });
});
