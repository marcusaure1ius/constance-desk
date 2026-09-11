import { describe, it, expect } from "vitest";
import { buildEpicTexts } from "@/lib/slides-report/texts";
import type { DraftTask } from "@/lib/slides-report/types";

function task(overrides: Partial<DraftTask>): DraftTask {
  return { id: "t", title: "Задача", plannedDate: null, completedAt: null, doneThisWeek: false, ...overrides };
}

const done = task({ id: "1", title: "Макеты прошли чек", completedAt: "2026-09-09T10:00:00.000Z", doneThisWeek: true });
const front = task({ id: "2", title: "Разработка фронта", plannedDate: "2026-09-15" });
const analytics = task({ id: "3", title: "Аналитика" });

describe("buildEpicTexts", () => {
  it("«Задачи» — все переданные задачи по порядку", () => {
    expect(buildEpicTexts([done, front, analytics]).tasks).toEqual(["Макеты прошли чек", "Разработка фронта", "Аналитика"]);
  });

  it("«Текущая неделя» — закрытые на неделе", () => {
    expect(buildEpicTexts([done, front]).thisWeek).toBe("Макеты прошли чек");
  });

  it("«Следующая неделя» — открытые, по строке на задачу", () => {
    expect(buildEpicTexts([done, front, analytics]).nextWeek).toBe("Разработка фронта\nАналитика");
  });

  it("без задач — пустые ячейки", () => {
    expect(buildEpicTexts([])).toEqual({ tasks: [], thisWeek: "", nextWeek: "" });
  });
});
