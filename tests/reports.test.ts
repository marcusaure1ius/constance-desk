import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {},
}));

import { formatReportAsText, type WeeklyReport } from "@/lib/services/reports";

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
