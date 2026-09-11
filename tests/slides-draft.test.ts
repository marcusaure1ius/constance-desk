import { describe, it, expect, vi, beforeEach } from "vitest";
import { conditionUses } from "./helpers/sql-conditions";

const { mockDb, selectChain } = vi.hoisted(() => {
  const selectChain = {
    from: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    where: vi.fn(),
  };
  const mockDb = { select: vi.fn(() => selectChain) };
  return { mockDb, selectChain };
});

vi.mock("@/lib/db", () => ({ db: mockDb }));

import { getSlidesDraft, groupDraftEpics, type DraftTaskRow } from "@/lib/services/slides-draft";
import { reportWeekFromMonday } from "@/lib/slides-report/week";

const WEEK = reportWeekFromMonday("2026-09-07");

function row(overrides: Partial<DraftTaskRow>): DraftTaskRow {
  return {
    id: "t",
    title: "Задача",
    plannedDate: null,
    completedAt: null,
    categoryId: "c1",
    categoryName: "[МП_Q3'2026] Индикаторы",
    ...overrides,
  };
}

describe("groupDraftEpics", () => {
  it("группирует задачи по категориям и сортирует эпики по названию", () => {
    const epics = groupDraftEpics(
      [
        row({ id: "1", categoryId: "c2", categoryName: "[МП_Q4'2026] Уведомления" }),
        row({ id: "2" }),
        row({ id: "3", categoryId: "c2", categoryName: "[МП_Q4'2026] Уведомления" }),
      ],
      WEEK
    );
    expect(epics.map((e) => e.name)).toEqual(["[МП_Q3'2026] Индикаторы", "[МП_Q4'2026] Уведомления"]);
    expect(epics[1].tasks.map((t) => t.id)).toEqual(["1", "3"]);
  });

  it("помечает закрытые на неделе и отдаёт время закрытия ISO-строкой", () => {
    const [epic] = groupDraftEpics([row({ completedAt: new Date("2026-09-09T10:00:00.000Z") })], WEEK);
    expect(epic.tasks[0]).toMatchObject({ doneThisWeek: true, completedAt: "2026-09-09T10:00:00.000Z" });
  });

  it("отбрасывает задачи, закрытые вне недели", () => {
    const epics = groupDraftEpics(
      [
        row({ id: "before", completedAt: new Date("2026-09-06T23:59:59.000Z") }),
        row({ id: "after", completedAt: new Date("2026-09-14T00:00:00.000Z") }),
      ],
      WEEK
    );
    expect(epics).toEqual([]);
  });

  it("сначала закрытые по времени закрытия, затем открытые по сроку, без срока — в конце", () => {
    const [epic] = groupDraftEpics(
      [
        row({ id: "nodate-b", title: "Б" }),
        row({ id: "late", plannedDate: "2026-09-30" }),
        row({ id: "done2", completedAt: new Date("2026-09-10T10:00:00.000Z") }),
        row({ id: "soon", plannedDate: "2026-09-15" }),
        row({ id: "done1", completedAt: new Date("2026-09-08T10:00:00.000Z") }),
        row({ id: "nodate-a", title: "А" }),
      ],
      WEEK
    );
    expect(epic.tasks.map((t) => t.id)).toEqual(["done1", "done2", "soon", "late", "nodate-a", "nodate-b"]);
  });
});

describe("getSlidesDraft", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.select.mockReturnValue(selectChain);
    selectChain.from.mockReturnValue(selectChain);
    selectChain.innerJoin.mockReturnValue(selectChain);
  });

  it("считает неделю от «сегодня» браузера и возвращает его в черновике", async () => {
    selectChain.where.mockResolvedValueOnce([]);
    const draft = await getSlidesDraft("env-1", "2026-09-14");
    expect(draft.week.label).toBe("07.09.2026 - 11.09.2026");
    expect(draft.today).toBe("2026-09-14");
    expect(draft.epics).toEqual([]);
  });

  it("фильтрует по среде и по времени закрытия", async () => {
    selectChain.where.mockResolvedValueOnce([]);
    await getSlidesDraft("env-1", "2026-09-11");
    const condition = selectChain.where.mock.calls[0][0];
    expect(conditionUses(condition, "environment_id")).toBe(true);
    expect(conditionUses(condition, "completed_at")).toBe(true);
  });

  it("берёт только задачи с категорией — через inner join колонок и категорий", async () => {
    selectChain.where.mockResolvedValueOnce([row({ id: "1" })]);
    const draft = await getSlidesDraft("env-1", "2026-09-11");
    expect(selectChain.innerJoin).toHaveBeenCalledTimes(2);
    expect(draft.epics).toHaveLength(1);
  });
});
