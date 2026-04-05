import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockDb, selectChain } = vi.hoisted(() => {
  const selectChain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn(),
  };
  const mockDb = {
    select: vi.fn(() => selectChain),
  };
  return { mockDb, selectChain };
});

vi.mock("@/lib/db", () => ({ db: mockDb }));

import { getTodayBriefing } from "@/lib/services/today";

describe("getTodayBriefing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.select.mockReturnValue(selectChain);
    selectChain.from.mockReturnValue(selectChain);
    selectChain.where.mockReturnValue(selectChain);
    selectChain.orderBy.mockReturnValue(selectChain);
  });

  it("возвращает null если нет колонок", async () => {
    selectChain.orderBy.mockResolvedValueOnce([]);
    const result = await getTodayBriefing("env-1");
    expect(result).toBeNull();
  });

  it("возвращает структуру брифинга с правильными секциями", async () => {
    const columns = [
      { id: "col-1", title: "Бэклог", position: 0, environmentId: "env-1" },
      { id: "col-2", title: "В работе", position: 1, environmentId: "env-1" },
      { id: "col-3", title: "Готово", position: 2, environmentId: "env-1" },
    ];
    const inProgressTasks = [
      { id: "t1", title: "Задача в работе", columnId: "col-2", priority: "urgent" },
    ];
    const plannedTasks = [
      { id: "t2", title: "Запланировано", columnId: "col-1", priority: "high" },
    ];
    const completedTasks = [
      { id: "t3", title: "Готово", columnId: "col-3", priority: "normal" },
    ];
    const suggestions = [
      { id: "t4", title: "Из бэклога", columnId: "col-1", priority: "high" },
    ];

    // 1. columns query
    selectChain.orderBy.mockResolvedValueOnce(columns);
    // 2. inProgress (middle columns)
    selectChain.orderBy.mockResolvedValueOnce(inProgressTasks);
    // 3. planned (first column, plannedDate = today)
    selectChain.orderBy.mockResolvedValueOnce(plannedTasks);
    // 4. completed (last column, completedAt today)
    selectChain.orderBy.mockResolvedValueOnce(completedTasks);
    // 5. suggestions (first column, no plannedDate)
    selectChain.limit.mockResolvedValueOnce(suggestions);

    const result = await getTodayBriefing("env-1");

    expect(result).not.toBeNull();
    expect(result!.inProgress).toEqual([
      { ...inProgressTasks[0], columnTitle: "В работе" },
    ]);
    expect(result!.planned).toEqual(plannedTasks);
    expect(result!.completed).toEqual(completedTasks);
    expect(result!.suggestions).toEqual(suggestions);
    expect(result!.progress).toEqual({ done: 1, total: 3 });
  });

  it("обрабатывает доску с двумя колонками (нет средних)", async () => {
    const columns = [
      { id: "col-1", title: "Бэклог", position: 0, environmentId: "env-1" },
      { id: "col-2", title: "Готово", position: 1, environmentId: "env-1" },
    ];

    selectChain.orderBy.mockResolvedValueOnce(columns);
    // No inProgress query (no middle columns) — skipped via Promise.resolve([])
    selectChain.orderBy.mockResolvedValueOnce([]); // planned
    selectChain.orderBy.mockResolvedValueOnce([]); // completed
    selectChain.limit.mockResolvedValueOnce([]);   // suggestions

    const result = await getTodayBriefing("env-1");

    expect(result).not.toBeNull();
    expect(result!.inProgress).toEqual([]);
    expect(result!.progress).toEqual({ done: 0, total: 0 });
  });
});
