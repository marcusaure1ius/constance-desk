import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { columnRefs } from "./helpers/sql-conditions";

/**
 * Сроки годности хендлов.
 *
 * Здесь проверяется ровно то, что считает наш код: какая дата уходит в
 * `expires_at`. Само отсечение просроченных — дело запроса, оно проверяется на
 * настоящей базе (`tests/task-control.integration.test.ts`).
 *
 * Ожидаемые даты записаны числами, а не через константы модуля: сверка с
 * константой прошла бы и после её замены обратно на неделю.
 */

const { mockDb, state } = vi.hoisted(() => {
  const state = {
    rows: [] as Record<string, unknown>[],
    inserted: [] as Record<string, unknown>[],
    selectWhere: [] as unknown[],
  };

  // Цепочка drizzle, которую можно дождаться на любом звене: `getHandle`
  // ждёт результат после `.where()`, `takeAwaitInput` — после `.limit()`.
  const selectChain: Record<string, unknown> = {};
  Object.assign(selectChain, {
    from: vi.fn(() => selectChain),
    where: vi.fn((condition: unknown) => {
      state.selectWhere.push(condition);
      return selectChain;
    }),
    orderBy: vi.fn(() => selectChain),
    limit: vi.fn(() => selectChain),
    then: (resolve: (value: unknown) => void) => resolve(state.rows),
  });

  const updateChain: Record<string, unknown> = {};
  Object.assign(updateChain, {
    set: vi.fn(() => updateChain),
    where: vi.fn(() => updateChain),
    returning: vi.fn(() => updateChain),
    then: (resolve: (value: unknown) => void) => resolve(state.rows),
  });

  const mockDb = {
    insert: vi.fn(() => ({
      values: vi.fn(async (values: Record<string, unknown>) => {
        state.inserted.push(values);
      }),
    })),
    select: vi.fn(() => selectChain),
    update: vi.fn(() => updateChain),
  };

  return { mockDb, state };
});

vi.mock("@/lib/db", () => ({ db: mockDb }));

import { createHandle, takeAwaitInput } from "@/lib/services/tg-handles";

const NOW = new Date("2026-08-24T12:00:00Z");

function lastExpiry(): Date {
  return state.inserted[state.inserted.length - 1].expiresAt as Date;
}

describe("срок годности хендла", () => {
  beforeEach(() => {
    state.rows = [];
    state.inserted = [];
    state.selectWhere = [];
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("ожидание ввода живёт минуты, а не дни", async () => {
    await createHandle({
      kind: "await_input",
      payload: { taskId: "task-1", field: "title" },
      chatId: 42,
    });

    // Пятнадцать минут: человек читает вопрос и отвечает сразу, а забытый
    // вопрос не должен перехватывать сообщение назавтра.
    expect(lastExpiry()).toEqual(new Date("2026-08-24T12:15:00Z"));
  });

  it("хендл за кнопкой живёт неделю: карточка остаётся в чате надолго", async () => {
    await createHandle({ kind: "search", payload: { query: "вэду" }, chatId: 42 });

    expect(lastExpiry()).toEqual(new Date("2026-08-31T12:00:00Z"));
  });

  it("у ожидания срок короче, чем у кнопки, — это не одно и то же число", async () => {
    await createHandle({ kind: "await_input", payload: {}, chatId: 42 });
    const awaitInput = lastExpiry();
    await createHandle({ kind: "search", payload: {}, chatId: 42 });
    const button = lastExpiry();

    expect(awaitInput.getTime()).toBeLessThan(button.getTime());
    // Верхняя граница на случай «поправили на 6 дней вместо 7»: ожидание
    // обязано измеряться минутами.
    expect(awaitInput.getTime() - NOW.getTime()).toBeLessThanOrEqual(30 * 60_000);
  });

  it("явный срок перебивает умолчание — на этом стоит тест протухшего хендла", async () => {
    await createHandle({ kind: "search", payload: {}, chatId: 42, ttlMinutes: -1 });

    expect(lastExpiry()).toEqual(new Date("2026-08-24T11:59:00Z"));
  });
});

describe("takeAwaitInput", () => {
  beforeEach(() => {
    state.rows = [];
    state.inserted = [];
    state.selectWhere = [];
  });

  it("ищет ожидание по чату, виду, статусу И сроку годности", async () => {
    await takeAwaitInput(42);

    // Без ссылки на expires_at запрос вернул бы вчерашнее ожидание: TTL в
    // минутах не значит ничего, если по нему никто не фильтрует.
    const refs = columnRefs(state.selectWhere[0]);
    expect(refs).toContain("expires_at");
    expect(refs).toContain("chat_id");
    expect(refs).toContain("kind");
    expect(refs).toContain("status");
  });

  it("пусто — значит вопроса не задавали: null, а не исключение", async () => {
    expect(await takeAwaitInput(42)).toBeNull();
  });
});
