import { describe, it, expect } from "vitest";
import { computeEpicStatus, isOverdue } from "@/lib/slides-report/status";
import type { DraftTask } from "@/lib/slides-report/types";

const FRIDAY = "2026-09-11";

function task(overrides: Partial<DraftTask> = {}): DraftTask {
  return { id: "t", title: "Задача", plannedDate: null, completedAt: null, doneThisWeek: false, ...overrides };
}

describe("computeEpicStatus", () => {
  it("без задач — зелёный", () => {
    expect(computeEpicStatus([], FRIDAY)).toBe("green");
  });

  it("открытая задача с прошедшим сроком — красный", () => {
    expect(computeEpicStatus([task({ plannedDate: "2026-09-10" })], FRIDAY)).toBe("red");
  });

  it.each(["2026-09-11", "2026-09-14", "2026-09-15"])(
    "срок %s — в пределах 2 рабочих дней от пятницы, жёлтый",
    (plannedDate) => {
      expect(computeEpicStatus([task({ plannedDate })], FRIDAY)).toBe("yellow");
    }
  );

  it("срок через 3 рабочих дня — зелёный", () => {
    expect(computeEpicStatus([task({ plannedDate: "2026-09-16" })], FRIDAY)).toBe("green");
  });

  it("из четверга окно риска кончается в понедельник", () => {
    expect(computeEpicStatus([task({ plannedDate: "2026-09-14" })], "2026-09-10")).toBe("yellow");
    expect(computeEpicStatus([task({ plannedDate: "2026-09-15" })], "2026-09-10")).toBe("green");
  });

  it("открытая задача без срока — зелёный", () => {
    expect(computeEpicStatus([task()], FRIDAY)).toBe("green");
  });

  it("закрытая задача с прошедшим сроком на статус не влияет", () => {
    const closed = task({ plannedDate: "2026-09-01", completedAt: "2026-09-09T10:00:00.000Z", doneThisWeek: true });
    expect(computeEpicStatus([closed], FRIDAY)).toBe("green");
  });

  it("красный важнее жёлтого", () => {
    const tasks = [task({ plannedDate: "2026-09-14" }), task({ plannedDate: "2026-09-01" })];
    expect(computeEpicStatus(tasks, FRIDAY)).toBe("red");
  });
});

describe("isOverdue", () => {
  it("открытая с прошедшим сроком — просрочена", () => {
    expect(isOverdue(task({ plannedDate: "2026-09-10" }), FRIDAY)).toBe(true);
  });

  it("срок сегодня — ещё не просрочена", () => {
    expect(isOverdue(task({ plannedDate: FRIDAY }), FRIDAY)).toBe(false);
  });

  it("закрытая и без срока — не просрочены", () => {
    expect(isOverdue(task({ plannedDate: "2026-09-01", completedAt: "2026-09-09T10:00:00.000Z" }), FRIDAY)).toBe(false);
    expect(isOverdue(task(), FRIDAY)).toBe(false);
  });
});
