import { describe, it, expect } from "vitest";
import {
  cycleStatus,
  initEpicStates,
  toggleTask,
  toSlideRows,
  viewEpic,
} from "@/lib/slides-report/dialog-state";
import { reportWeekFromMonday } from "@/lib/slides-report/week";
import type { DraftTask, SlidesDraft } from "@/lib/slides-report/types";

const TODAY = "2026-09-11";
const done: DraftTask = { id: "b", title: "Макеты", plannedDate: null, completedAt: "2026-09-09T10:00:00.000Z", doneThisWeek: true };
const overdue: DraftTask = { id: "a", title: "Дизайн-чек", plannedDate: "2026-09-08", completedAt: null, doneThisWeek: false };
const later: DraftTask = { id: "c", title: "Фронт", plannedDate: "2026-09-30", completedAt: null, doneThisWeek: false };

const draft: SlidesDraft = {
  week: reportWeekFromMonday("2026-09-07"),
  today: TODAY,
  epics: [
    { categoryId: "e1", name: "[МП_Q3'2026] Индикаторы", tasks: [done, overdue, later] },
    { categoryId: "e2", name: "[МП_Q4'2026] Уведомления", tasks: [later] },
  ],
};

describe("initEpicStates", () => {
  it("все эпики включены, все задачи отмечены, правок нет", () => {
    const [first] = initEpicStates(draft);
    expect(first.included).toBe(true);
    expect(first.checkedIds).toEqual(["b", "a", "c"]);
    expect(first.statusOverride).toBeNull();
    expect(first.thisWeekOverride).toBeNull();
    expect(first.nextWeekOverride).toBeNull();
  });
});

describe("viewEpic", () => {
  it("выводит статус и тексты из отмеченных задач", () => {
    const view = viewEpic(initEpicStates(draft)[0], TODAY);
    expect(view.status).toBe("red");
    expect(view.statusIsAuto).toBe(true);
    expect(view.tasks).toEqual(["Макеты", "Дизайн-чек", "Фронт"]);
    expect(view.thisWeek).toBe("Макеты");
    expect(view.nextWeek).toBe("Дизайн-чек\nФронт");
  });

  it("снятая галочка убирает задачу из текстов и пересчитывает статус", () => {
    const view = viewEpic(toggleTask(initEpicStates(draft)[0], "a"), TODAY);
    expect(view.status).toBe("green");
    expect(view.tasks).toEqual(["Макеты", "Фронт"]);
    expect(view.nextWeek).toBe("Фронт");
  });

  it("возвращённая галочка ставит задачу на её место", () => {
    const epic = toggleTask(toggleTask(initEpicStates(draft)[0], "a"), "a");
    expect(viewEpic(epic, TODAY).tasks).toEqual(["Макеты", "Дизайн-чек", "Фронт"]);
  });

  it("ручной текст недели не пересобирается вслед за галочками", () => {
    const edited = { ...initEpicStates(draft)[0], nextWeekOverride: "Своими словами" };
    const view = viewEpic(toggleTask(edited, "c"), TODAY);
    expect(view.nextWeek).toBe("Своими словами");
    expect(view.nextWeekIsAuto).toBe(false);
  });

  it("сброс правки возвращает собранный текст", () => {
    const reset = { ...initEpicStates(draft)[0], nextWeekOverride: null };
    expect(viewEpic(reset, TODAY).nextWeek).toBe("Дизайн-чек\nФронт");
  });
});

describe("cycleStatus", () => {
  it("идёт по кругу от текущего цвета: зелёный → жёлтый → красный → зелёный", () => {
    let epic = initEpicStates(draft)[1]; // авто — зелёный
    epic = cycleStatus(epic, TODAY);
    expect(viewEpic(epic, TODAY).status).toBe("yellow");
    epic = cycleStatus(epic, TODAY);
    expect(viewEpic(epic, TODAY).status).toBe("red");
    epic = cycleStatus(epic, TODAY);
    expect(viewEpic(epic, TODAY).status).toBe("green");
    expect(viewEpic(epic, TODAY).statusIsAuto).toBe(false);
  });

  it("ручной статус переживает переключение галочек", () => {
    let epic = cycleStatus(initEpicStates(draft)[0], TODAY); // авто-красный → вручную зелёный
    epic = toggleTask(epic, "b");
    expect(viewEpic(epic, TODAY).status).toBe("green");
  });
});

describe("toSlideRows", () => {
  it("выключенный эпик в строки не попадает, порядок сохраняется", () => {
    const [first, second] = initEpicStates(draft);
    expect(toSlideRows([{ ...first, included: false }, second], TODAY)).toEqual([
      { focus: "[МП_Q4'2026] Уведомления", tasks: ["Фронт"], status: "green", thisWeek: "", nextWeek: "Фронт" },
    ]);
  });
});
