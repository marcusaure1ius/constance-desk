import { describe, it, expect } from "vitest";
import { generateReportPptx } from "@/lib/services/report-pptx";
import type { ExtendedWeeklyReport } from "@/lib/services/reports";

describe("generateReportPptx", () => {
  const baseReport: ExtendedWeeklyReport = {
    weekStart: new Date(2026, 2, 30), // 30 марта 2026
    weekEnd: new Date(2026, 3, 5), // 5 апреля 2026
    completedTasks: [
      {
        id: "1",
        title: "Настроить CI/CD",
        description: "Описание",
        categoryName: "DevOps",
        startDate: "2026-03-25",
        completedAt: new Date(2026, 3, 1),
      },
    ],
    carryoverTasks: [
      {
        id: "2",
        title: "Рефакторинг API",
        description: null,
        categoryName: "Разработка",
        startDate: "2026-03-20",
        completedAt: null,
      },
      {
        id: "1",
        title: "Настроить CI/CD",
        description: "Описание",
        categoryName: "DevOps",
        startDate: "2026-03-25",
        completedAt: new Date(2026, 3, 1),
      },
    ],
    newTasks: [
      {
        id: "3",
        title: "Добавить тесты",
        description: null,
        categoryName: null,
        startDate: "2026-03-30",
        completedAt: null,
      },
    ],
  };

  it("возвращает Buffer, начинающийся с PK (ZIP magic bytes)", async () => {
    const buffer = await generateReportPptx(baseReport);

    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.length).toBeGreaterThan(0);
    // PPTX — это ZIP-файл, который начинается с PK (0x50, 0x4B)
    expect(buffer[0]).toBe(0x50); // 'P'
    expect(buffer[1]).toBe(0x4b); // 'K'
  });

  it("работает с пустыми списками задач", async () => {
    const emptyReport: ExtendedWeeklyReport = {
      weekStart: new Date(2026, 2, 30),
      weekEnd: new Date(2026, 3, 5),
      completedTasks: [],
      carryoverTasks: [],
      newTasks: [],
    };

    const buffer = await generateReportPptx(emptyReport);

    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer[0]).toBe(0x50);
    expect(buffer[1]).toBe(0x4b);
  });

  it("генерирует файл достаточного размера", async () => {
    const buffer = await generateReportPptx(baseReport);

    // PPTX файл должен быть больше 10KB
    expect(buffer.length).toBeGreaterThan(10_000);
  });
});
