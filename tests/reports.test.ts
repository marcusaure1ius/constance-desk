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

import { formatReportAsText, getWeeklyReport, type WeeklyReport } from "@/lib/services/reports";

describe("formatReportAsText", () => {
  const baseReport: WeeklyReport = {
    weekStart: new Date(2026, 2, 2), // 2 марта 2026, понедельник
    weekEnd: new Date(2026, 2, 8), // 8 марта 2026, воскресенье
    completedTasks: [],
    completedCount: 0,
    startedCount: 5,
  };

  it("форматирует пустой отчёт", () => {
    const text = formatReportAsText(baseReport);
    expect(text).toContain("Отчёт за неделю");
    expect(text).toContain("Выполнено: 0 из 5 задач");
  });

  it("включает завершённые задачи", () => {
    const report: WeeklyReport = {
      ...baseReport,
      completedTasks: [
        {
          id: "1",
          title: "Задача 1",
          description: null,
          categoryName: "Разработка",
          completedAt: new Date(2026, 2, 3),
        },
      ],
      completedCount: 1,
    };
    const text = formatReportAsText(report);
    expect(text).toContain("✓ Задача 1 (Разработка)");
  });

  it("отображает описание задачи", () => {
    const report: WeeklyReport = {
      ...baseReport,
      completedTasks: [
        {
          id: "1",
          title: "Задача",
          description: "Подробности",
          categoryName: null,
          completedAt: new Date(2026, 2, 3),
        },
      ],
      completedCount: 1,
    };
    const text = formatReportAsText(report);
    expect(text).toContain("Подробности");
  });

  it("не добавляет категорию если её нет", () => {
    const report: WeeklyReport = {
      ...baseReport,
      completedTasks: [
        {
          id: "1",
          title: "Задача",
          description: null,
          categoryName: null,
          completedAt: new Date(2026, 2, 3),
        },
      ],
      completedCount: 1,
    };
    const text = formatReportAsText(report);
    expect(text).toMatch(/✓ Задача —/);
  });
});

describe("getWeeklyReport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.select.mockReturnValue(selectChain);
    selectChain.from.mockReturnValue(selectChain);
  });

  it("возвращает пустой отчёт если нет колонок", async () => {
    selectChain.where.mockResolvedValueOnce([]);
    const result = await getWeeklyReport(new Date(2026, 2, 4), "env-1");
    expect(result.completedCount).toBe(0);
    expect(result.startedCount).toBe(0);
    expect(result.completedTasks).toEqual([]);
  });

  it("возвращает отчёт с задачами", async () => {
    // envColumns
    selectChain.where.mockResolvedValueOnce([{ id: "col-1" }]);
    // completed tasks query
    selectChain.leftJoin.mockReturnValue(selectChain);
    selectChain.where.mockReturnValueOnce(selectChain);
    selectChain.orderBy.mockResolvedValueOnce([
      { id: "1", title: "Готово", description: null, completedAt: new Date(2026, 2, 3), categoryName: "Работа" },
    ]);
    // started tasks query
    selectChain.where.mockResolvedValueOnce([{ id: "1" }, { id: "2" }]);

    const result = await getWeeklyReport(new Date(2026, 2, 4), "env-1");
    expect(result.completedCount).toBe(1);
    expect(result.startedCount).toBe(2);
    expect(result.completedTasks[0].title).toBe("Готово");
  });
});
