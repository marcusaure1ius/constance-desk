import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockDb, selectChain } = vi.hoisted(() => {
  const selectChain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn(),
    leftJoin: vi.fn().mockReturnThis(),
  };
  const mockDb = {
    select: vi.fn(() => selectChain),
  };
  return { mockDb, selectChain };
});

vi.mock("@/lib/db", () => ({ db: mockDb }));

import { getExtendedWeeklyReport } from "@/lib/services/reports";

describe("getExtendedWeeklyReport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.select.mockReturnValue(selectChain);
    selectChain.from.mockReturnValue(selectChain);
    selectChain.leftJoin.mockReturnValue(selectChain);
  });

  it("возвращает пустой отчёт если нет колонок", async () => {
    selectChain.where.mockResolvedValueOnce([]); // envColumns

    const result = await getExtendedWeeklyReport(new Date(2026, 2, 4), "env-1");

    expect(result.completedTasks).toEqual([]);
    expect(result.carryoverTasks).toEqual([]);
    expect(result.newTasks).toEqual([]);
  });

  it("возвращает completedTasks — задачи завершённые на этой неделе", async () => {
    // envColumns
    selectChain.where.mockResolvedValueOnce([{ id: "col-1" }]);
    // completed tasks query
    selectChain.where.mockReturnValueOnce(selectChain);
    selectChain.orderBy.mockResolvedValueOnce([
      {
        id: "1",
        title: "Завершённая",
        description: null,
        categoryName: "Работа",
        startDate: "2026-03-02",
        completedAt: new Date(2026, 2, 5),
      },
    ]);
    // carryover tasks query
    selectChain.where.mockReturnValueOnce(selectChain);
    selectChain.orderBy.mockResolvedValueOnce([]);
    // new tasks query
    selectChain.where.mockReturnValueOnce(selectChain);
    selectChain.orderBy.mockResolvedValueOnce([]);

    const result = await getExtendedWeeklyReport(new Date(2026, 2, 4), "env-1");

    expect(result.completedTasks).toHaveLength(1);
    expect(result.completedTasks[0].title).toBe("Завершённая");
    expect(result.completedTasks[0].completedAt).toEqual(new Date(2026, 2, 5));
  });

  it("возвращает carryoverTasks — задачи начатые до недели", async () => {
    // envColumns
    selectChain.where.mockResolvedValueOnce([{ id: "col-1" }]);
    // completed tasks query
    selectChain.where.mockReturnValueOnce(selectChain);
    selectChain.orderBy.mockResolvedValueOnce([]);
    // carryover tasks query
    selectChain.where.mockReturnValueOnce(selectChain);
    selectChain.orderBy.mockResolvedValueOnce([
      {
        id: "2",
        title: "Перенесённая",
        description: "Начата на прошлой неделе",
        categoryName: null,
        startDate: "2026-02-25",
        completedAt: null,
      },
    ]);
    // new tasks query
    selectChain.where.mockReturnValueOnce(selectChain);
    selectChain.orderBy.mockResolvedValueOnce([]);

    const result = await getExtendedWeeklyReport(new Date(2026, 2, 4), "env-1");

    expect(result.carryoverTasks).toHaveLength(1);
    expect(result.carryoverTasks[0].title).toBe("Перенесённая");
    expect(result.carryoverTasks[0].completedAt).toBeNull();
  });

  it("возвращает newTasks — задачи начатые на этой неделе", async () => {
    // envColumns
    selectChain.where.mockResolvedValueOnce([{ id: "col-1" }]);
    // completed tasks query
    selectChain.where.mockReturnValueOnce(selectChain);
    selectChain.orderBy.mockResolvedValueOnce([]);
    // carryover tasks query
    selectChain.where.mockReturnValueOnce(selectChain);
    selectChain.orderBy.mockResolvedValueOnce([]);
    // new tasks query
    selectChain.where.mockReturnValueOnce(selectChain);
    selectChain.orderBy.mockResolvedValueOnce([
      {
        id: "3",
        title: "Новая задача",
        description: null,
        categoryName: "Дизайн",
        startDate: "2026-03-03",
        completedAt: null,
      },
    ]);

    const result = await getExtendedWeeklyReport(new Date(2026, 2, 4), "env-1");

    expect(result.newTasks).toHaveLength(1);
    expect(result.newTasks[0].title).toBe("Новая задача");
    expect(result.newTasks[0].startDate).toBe("2026-03-03");
  });

  it("возвращает корректные weekStart и weekEnd", async () => {
    selectChain.where.mockResolvedValueOnce([]); // envColumns

    const result = await getExtendedWeeklyReport(new Date(2026, 2, 4), "env-1");

    // 4 марта 2026 — среда, неделя: пн 2 марта — вс 8 марта
    expect(result.weekStart.getDay()).toBe(1); // понедельник
  });
});
