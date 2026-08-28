import { describe, it, expect, vi, beforeEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const { mockDb, selectChain } = vi.hoisted(() => {
  const selectChain = {
    from: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    offset: vi.fn(),
  };
  return { mockDb: { select: vi.fn(() => selectChain) }, selectChain };
});

vi.mock("@/lib/db", () => ({ db: mockDb }));

import {
  SEARCH_MAX_LIMIT,
  SEARCH_PAGE_SIZE,
  escapeLikePattern,
  searchAll,
  searchNotes,
  searchTasks,
} from "@/lib/services/search";

/**
 * Мок drizzle вернёт одно и то же при любом WHERE, поэтому проверять «функция
 * вернула то, что подсунул мок» бессмысленно. Сериализуем перехваченное условие
 * в настоящий SQL и утверждаем по нему.
 */
const dialect = new PgDialect();
const lastWhere = () => dialect.sqlToQuery(selectChain.where.mock.calls.at(-1)![0]);
const lastOrderBy = () =>
  selectChain.orderBy.mock.calls.at(-1)!.map((part) => dialect.sqlToQuery(part).sql);

describe("searchTasks — форма запроса", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.select.mockReturnValue(selectChain);
    selectChain.from.mockReturnValue(selectChain);
    selectChain.innerJoin.mockReturnValue(selectChain);
    selectChain.where.mockReturnValue(selectChain);
    selectChain.orderBy.mockReturnValue(selectChain);
    selectChain.limit.mockReturnValue(selectChain);
    selectChain.offset.mockResolvedValue([]);
  });

  it("ищет регистронезависимо по title и description", async () => {
    await searchTasks("вэду");
    const { sql, params } = lastWhere();

    expect(sql).toContain('"tasks"."title" ilike');
    expect(sql).toContain('"tasks"."description" ilike');
    expect(params.slice(0, 2)).toEqual(["%вэду%", "%вэду%"]);
  });

  it("обрезает пробелы по краям запроса", async () => {
    await searchTasks("  вэду  ");
    expect(lastWhere().params[0]).toBe("%вэду%");
  });

  it("экранирует метасимволы шаблона", async () => {
    await searchTasks("100% на 5_бань");
    expect(lastWhere().params[0]).toBe("%100\\% на 5\\_бань%");
  });

  it("отсекает архив по completed_at", async () => {
    await searchTasks("вэду");
    const { sql } = lastWhere();
    expect(sql).toContain('"tasks"."completed_at" is null');
    expect(sql).toContain('"tasks"."completed_at" >=');
  });

  it("includeArchived убирает фильтр архива", async () => {
    await searchTasks("вэду", { includeArchived: true });
    expect(lastWhere().sql).not.toContain("completed_at");
  });

  it("соединяет задачи с колонками и средами", async () => {
    await searchTasks("вэду");
    expect(selectChain.innerJoin).toHaveBeenCalledTimes(2);
    const joins = selectChain.innerJoin.mock.calls.map((call) => dialect.sqlToQuery(call[1]).sql);
    expect(joins[0]).toBe('"tasks"."column_id" = "columns"."id"');
    expect(joins[1]).toBe('"columns"."environment_id" = "environments"."id"');
  });

  it("сортирует по свежести с устойчивым разрывом ничьей", async () => {
    await searchTasks("вэду");
    expect(lastOrderBy()).toEqual(['"tasks"."updated_at" desc', '"tasks"."id" asc']);
  });

  it("пустой запрос не идёт в базу", async () => {
    expect(await searchTasks("   ")).toEqual([]);
    expect(mockDb.select).not.toHaveBeenCalled();
  });
});

describe("searchTasks — пагинация", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.select.mockReturnValue(selectChain);
    selectChain.from.mockReturnValue(selectChain);
    selectChain.innerJoin.mockReturnValue(selectChain);
    selectChain.where.mockReturnValue(selectChain);
    selectChain.orderBy.mockReturnValue(selectChain);
    selectChain.limit.mockReturnValue(selectChain);
    selectChain.offset.mockResolvedValue([]);
  });

  const page = () => ({
    limit: selectChain.limit.mock.calls.at(-1)![0],
    offset: selectChain.offset.mock.calls.at(-1)![0],
  });

  it("по умолчанию берёт страницу SEARCH_PAGE_SIZE с нулевого смещения", async () => {
    await searchTasks("вэду");
    expect(page()).toEqual({ limit: SEARCH_PAGE_SIZE, offset: 0 });
  });

  it("пробрасывает лимит и смещение", async () => {
    await searchTasks("вэду", { limit: 5, offset: 10 });
    expect(page()).toEqual({ limit: 5, offset: 10 });
  });

  it("режет лимит по потолку", async () => {
    await searchTasks("вэду", { limit: 5000 });
    expect(page().limit).toBe(SEARCH_MAX_LIMIT);
  });

  it("отрицательные и дробные значения нормализует", async () => {
    await searchTasks("вэду", { limit: -3, offset: -7 });
    expect(page()).toEqual({ limit: SEARCH_PAGE_SIZE, offset: 0 });

    await searchTasks("вэду", { limit: 4.9, offset: 2.9 });
    expect(page()).toEqual({ limit: 4, offset: 2 });
  });

  // Ноль означает «лимит не задан», а не «отдай пустую страницу»: пустая
  // выдача неотличима от «ничего не найдено» и молча прятала бы находки.
  it("нулевой лимит читается как умолчание, а не как пустая страница", async () => {
    await searchTasks("вэду", { limit: 0 });
    expect(page().limit).toBe(SEARCH_PAGE_SIZE);
  });

  it("нечисловые значения заменяет умолчаниями", async () => {
    await searchTasks("вэду", { limit: Number.NaN, offset: Number.NaN });
    expect(page()).toEqual({ limit: SEARCH_PAGE_SIZE, offset: 0 });
  });
});

describe("escapeLikePattern", () => {
  it("экранирует процент, подчёркивание и обратный слэш", () => {
    expect(escapeLikePattern("100%_\\")).toBe("100\\%\\_\\\\");
  });

  it("обычный текст не трогает", () => {
    expect(escapeLikePattern("вэду итмо")).toBe("вэду итмо");
  });
});

describe("searchNotes и searchAll", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.select.mockReturnValue(selectChain);
    selectChain.from.mockReturnValue(selectChain);
    selectChain.innerJoin.mockReturnValue(selectChain);
    selectChain.where.mockReturnValue(selectChain);
    selectChain.orderBy.mockReturnValue(selectChain);
    selectChain.limit.mockReturnValue(selectChain);
    selectChain.offset.mockResolvedValue([]);
  });

  it("пустой запрос не ходит в базу", async () => {
    expect(await searchNotes("   ")).toEqual([]);
    expect(mockDb.select).not.toHaveBeenCalled();
  });

  it("ищет по заголовку и тексту заметки", async () => {
    await searchNotes("вэду");
    expect(lastWhere().sql).toContain('"title" ilike');
    expect(lastWhere().sql).toContain('"text" ilike');
  });

  // Заметка в корне среды папок не имеет, и второй запрос за путями ей не
  // нужен: путь такой заметки — это её заголовок.
  it("находка в корне обходится без запроса за папками", async () => {
    selectChain.offset.mockResolvedValue([
      { note: { id: "n-1", title: "Входящее", folderId: null }, environment: {} },
    ]);

    const found = await searchNotes("вход");
    expect(found[0].path).toBe("Входящее");
    expect(mockDb.select).toHaveBeenCalledTimes(1);
  });

  it("searchAll возвращает задачи и заметки раздельно", async () => {
    // Мок отвечает одинаково обоим запросам, поэтому строка несёт сразу оба
    // ключа. Проверяется здесь не содержимое, а раскладка ответа надвое.
    const row = {
      task: { id: "t-1" },
      note: { id: "n-1", title: "Входящее", folderId: null },
      column: {},
      environment: {},
    };
    selectChain.offset.mockResolvedValue([row]);

    const result = await searchAll("вэду");
    expect(result.tasks).toEqual([row]);
    expect(result.notes).toEqual([{ ...row, path: "Входящее" }]);
  });

  it("searchAll пробрасывает пагинацию в поиск задач", async () => {
    await searchAll("вэду", { limit: 3, offset: 6 });
    expect(selectChain.limit).toHaveBeenCalledWith(3);
    expect(selectChain.offset).toHaveBeenCalledWith(6);
  });
});
