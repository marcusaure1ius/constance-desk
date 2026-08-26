import { describe, it, expect } from "vitest";
import {
  NO_EPIC,
  catKey,
  makeDroppableId,
  parseDroppableId,
  buildLanes,
  laneProgress,
  cellIndexToColumnPosition,
  type EpicTask,
} from "@/lib/board/epics";

describe("catKey", () => {
  it("возвращает id категории", () => {
    expect(catKey("cat-1")).toBe("cat-1");
  });
  it("возвращает NO_EPIC для null", () => {
    expect(catKey(null)).toBe(NO_EPIC);
  });
});

describe("makeDroppableId / parseDroppableId", () => {
  it("round-trip с id категории", () => {
    const id = makeDroppableId("col-1", "cat-1");
    expect(parseDroppableId(id)).toEqual({ columnId: "col-1", catKey: "cat-1" });
  });
  it("round-trip с NO_EPIC", () => {
    const id = makeDroppableId("col-1", NO_EPIC);
    expect(parseDroppableId(id)).toEqual({ columnId: "col-1", catKey: NO_EPIC });
  });
});

describe("buildLanes", () => {
  const cats = [
    { id: "a", name: "Alpha", color: "#fff" },
    { id: "b", name: "Beta", color: null },
  ];
  it("дорожка на каждую категорию в исходном порядке", () => {
    const lanes = buildLanes(cats, [{ categoryId: "a" }, { categoryId: "b" }]);
    expect(lanes.map((l) => l.key)).toEqual(["a", "b"]);
  });
  it("по умолчанию скрывает категории без задач", () => {
    const lanes = buildLanes(cats, [{ categoryId: "a" }]);
    expect(lanes.map((l) => l.key)).toEqual(["a"]);
  });
  it("без задач вовсе не оставляет дорожек", () => {
    expect(buildLanes(cats, [])).toEqual([]);
  });
  it("с showEmpty показывает все категории, включая пустые", () => {
    const lanes = buildLanes(cats, [{ categoryId: "a" }], { showEmpty: true });
    expect(lanes.map((l) => l.key)).toEqual(["a", "b"]);
  });
  it("добавляет дорожку «Без эпика» в конец, если есть задачи без категории", () => {
    const lanes = buildLanes(cats, [{ categoryId: "a" }, { categoryId: null }]);
    expect(lanes.map((l) => l.key)).toEqual(["a", NO_EPIC]);
    expect(lanes[1].category).toBeNull();
  });
  it("не добавляет «Без эпика», если все задачи с категорией", () => {
    const lanes = buildLanes(cats, [{ categoryId: "a" }, { categoryId: "b" }]);
    expect(lanes.map((l) => l.key)).toEqual(["a", "b"]);
  });
  it("не добавляет пустой «Без эпика» даже с showEmpty", () => {
    const lanes = buildLanes(cats, [{ categoryId: "a" }], { showEmpty: true });
    expect(lanes.map((l) => l.key)).toEqual(["a", "b"]);
  });
});

describe("laneProgress", () => {
  it("считает done = задачи в последней колонке", () => {
    const tasks = [
      { columnId: "c1" },
      { columnId: "c3" },
      { columnId: "c3" },
    ];
    expect(laneProgress(tasks, "c3")).toEqual({ done: 2, total: 3 });
  });
  it("done = 0, если lastColumnId undefined", () => {
    expect(laneProgress([{ columnId: "c1" }], undefined)).toEqual({ done: 0, total: 1 });
  });
});

describe("cellIndexToColumnPosition", () => {
  // Колонка c1: позиции вперемешку по эпикам.
  // position: t1(epic a,0), t2(epic b,1), t3(epic a,2), t4(none,3)
  const tasks: EpicTask[] = [
    { id: "t1", columnId: "c1", categoryId: "a", position: 0 },
    { id: "t2", columnId: "c1", categoryId: "b", position: 1 },
    { id: "t3", columnId: "c1", categoryId: "a", position: 2 },
    { id: "t4", columnId: "c1", categoryId: null, position: 3 },
  ];

  it("дроп в начало дорожки эпика a → глобальный индекс якоря t1 (0)", () => {
    // drag t3 (epic a) на cellIndex 0 дорожки a. epicTasks без t3 = [t1]; anchor = t1.
    expect(cellIndexToColumnPosition(tasks, "t3", "c1", "a", 0)).toBe(0);
  });

  it("дроп в конец дорожки эпика a → конец колонки (длина без перетаскиваемой = 3)", () => {
    // drag t1 (epic a) в конец дорожки a. epicTasks без t1 = [t3]; cellIndex 1 → нет якоря → длина.
    expect(cellIndexToColumnPosition(tasks, "t1", "c1", "a", 1)).toBe(3);
  });

  it("дроп в дорожку «Без эпика» в начало → индекс якоря t4", () => {
    // drag t1 в дорожку none, cellIndex 0. epicTasks none = [t4]; anchor t4 в полном порядке без t1.
    // columnTasks без t1 = [t2(1), t3(2), t4(3)] → indexOf(t4) = 2.
    expect(cellIndexToColumnPosition(tasks, "t1", "c1", NO_EPIC, 0)).toBe(2);
  });

  it("дроп в середину дорожки a при наличии трёх задач эпика", () => {
    const t: EpicTask[] = [
      { id: "x1", columnId: "c1", categoryId: "a", position: 0 },
      { id: "x2", columnId: "c1", categoryId: "a", position: 1 },
      { id: "x3", columnId: "c1", categoryId: "a", position: 2 },
    ];
    // drag x1 на cellIndex 1. epicTasks без x1 = [x2,x3]; anchor = x3 (index 1).
    // columnTasks без x1 = [x2,x3] → indexOf(x3) = 1.
    expect(cellIndexToColumnPosition(t, "x1", "c1", "a", 1)).toBe(1);
  });
});
