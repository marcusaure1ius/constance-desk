import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { inArray } from "drizzle-orm";

/*
 * Интеграционные тесты поиска — настоящие SQL-запросы к PostgreSQL.
 * На моках drizzle их проверить нельзя: регистронезависимость, экранирование
 * шаблона и порядок страниц выполняет сама база, а не наш код.
 *
 * В основной прогон (npm test) не попадают: файлы *.integration.test.ts
 * исключены маской в vitest.config.ts.
 *
 * Запуск: TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:55455/constance_ci \
 *   npm run test:integration:db
 * Схему в базу накатывает npm run db:migrate (в CI — джоба migrations).
 */

// Пропуска (describe.skipIf) здесь намеренно нет: без базы прогон был бы зелёным,
// не проверив ничего. Без TEST_DATABASE_URL createTestDb падает — и файл падает
// вместе с ним, так что «зелёный» значит «проверено».
vi.mock("@/lib/db", async () => {
  const { createTestDb } = await import("./helpers/test-db");
  return { db: createTestDb() };
});

import { searchAll, searchTasks } from "@/lib/services/search";
import { columns, environments, tasks } from "@/lib/db/schema";
import { closeTestDb, createTestDb } from "./helpers/test-db";

const daysAgo = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
};

const ids: Record<string, string> = {};

describe("поиск по настоящей базе", () => {
  beforeAll(async () => {
    const db = createTestDb();

    const [envA] = await db
      .insert(environments)
      .values({ name: "T-0003 среда А", color: "#3b82f6", position: 900 })
      .returning();
    const [envB] = await db
      .insert(environments)
      .values({ name: "T-0003 среда Б", color: "#22c55e", position: 901 })
      .returning();
    ids.envA = envA.id;
    ids.envB = envB.id;

    const [colA] = await db
      .insert(columns)
      .values({ title: "Бэклог", position: 0, environmentId: envA.id })
      .returning();
    const [colB] = await db
      .insert(columns)
      .values({ title: "Дела", position: 0, environmentId: envB.id })
      .returning();
    ids.colA = colA.id;
    ids.colB = colB.id;

    const rows = await db
      .insert(tasks)
      .values([
        // Регистр: в базе «ВЭДу», искать будем «вэду»
        {
          title: "Обновить ВЭДу по контрагентам",
          columnId: colA.id,
          position: 0,
          startDate: "2026-08-01",
          updatedAt: daysAgo(1),
        },
        // Совпадение только в описании и в другой среде
        {
          title: "Разобрать почту",
          description: "свести цены и ККУ по вэду",
          columnId: colB.id,
          position: 0,
          startDate: "2026-08-01",
          updatedAt: daysAgo(2),
        },
        // Архив: выполнена 40 дней назад
        {
          title: "Старая вэду",
          columnId: colA.id,
          position: 1,
          startDate: "2026-06-01",
          completedAt: daysAgo(40),
          updatedAt: daysAgo(40),
        },
        // Свежевыполненная — архивом ещё не считается
        {
          title: "Свежая вэду",
          columnId: colA.id,
          position: 2,
          startDate: "2026-08-01",
          completedAt: daysAgo(2),
          updatedAt: daysAgo(3),
        },
        // Метасимволы LIKE
        {
          title: "Скидка 100% на баннеры",
          columnId: colA.id,
          position: 3,
          startDate: "2026-08-01",
          updatedAt: daysAgo(5),
        },
        {
          title: "Скидка 1000 рублей на баннеры",
          columnId: colA.id,
          position: 4,
          startDate: "2026-08-01",
          updatedAt: daysAgo(5),
        },
        {
          title: "Прогноз_1 по марже",
          columnId: colA.id,
          position: 5,
          startDate: "2026-08-01",
          updatedAt: daysAgo(6),
        },
        {
          title: "Прогноз-1 по марже",
          columnId: colA.id,
          position: 6,
          startDate: "2026-08-01",
          updatedAt: daysAgo(6),
        },
      ])
      .returning();

    ids.upper = rows[0].id;
    ids.byDescription = rows[1].id;
    ids.archived = rows[2].id;
    ids.recentlyDone = rows[3].id;
    ids.percent = rows[4].id;
    ids.thousand = rows[5].id;
    ids.underscore = rows[6].id;
    ids.dash = rows[7].id;

    // Пять задач для пагинации, с разной свежестью — порядок предсказуем
    const paged = await db
      .insert(tasks)
      .values(
        [0, 1, 2, 3, 4].map((n) => ({
          title: `Пагинация щщ ${n}`,
          columnId: colA.id,
          position: 10 + n,
          startDate: "2026-08-01",
          updatedAt: daysAgo(n + 1),
        }))
      )
      .returning();
    ids.paged = paged.map((t) => t.id).join(",");
  });

  afterAll(async () => {
    const db = createTestDb();
    const envIds = [ids.envA, ids.envB].filter(Boolean);
    if (envIds.length) {
      const envColumns = await db
        .select({ id: columns.id })
        .from(columns)
        .where(inArray(columns.environmentId, envIds));
      const columnIds = envColumns.map((c) => c.id);
      if (columnIds.length) {
        await db.delete(tasks).where(inArray(tasks.columnId, columnIds));
        await db.delete(columns).where(inArray(columns.id, columnIds));
      }
      await db.delete(environments).where(inArray(environments.id, envIds));
    }
    await closeTestDb();
  });

  it("находит задачу по фрагменту title в другом регистре", async () => {
    const hits = await searchTasks("вэду");
    expect(hits.map((h) => h.task.id)).toContain(ids.upper);
  });

  it("находит задачу по фрагменту description", async () => {
    const hits = await searchTasks("свести цены");
    expect(hits.map((h) => h.task.id)).toEqual([ids.byDescription]);
  });

  it("возвращает задачи из разных сред в одной выдаче", async () => {
    const hits = await searchTasks("вэду");
    const found = hits.filter((h) => [ids.upper, ids.byDescription].includes(h.task.id));
    expect(found).toHaveLength(2);
    expect(new Set(found.map((h) => h.environment.name))).toEqual(
      new Set(["T-0003 среда А", "T-0003 среда Б"])
    );
  });

  it("отдаёт колонку и среду задачи", async () => {
    const [hit] = await searchTasks("Обновить ВЭДу");
    expect(hit.column).toEqual({ id: ids.colA, title: "Бэклог" });
    expect(hit.environment).toMatchObject({ id: ids.envA, name: "T-0003 среда А" });
  });

  it("не показывает архивные задачи, но показывает свежевыполненные", async () => {
    const hits = await searchTasks("вэду");
    const foundIds = hits.map((h) => h.task.id);
    expect(foundIds).not.toContain(ids.archived);
    expect(foundIds).toContain(ids.recentlyDone);
  });

  it("показывает архивные по явному includeArchived", async () => {
    const hits = await searchTasks("вэду", { includeArchived: true });
    expect(hits.map((h) => h.task.id)).toContain(ids.archived);
  });

  it("вторая страница не дублирует первую и продолжает её", async () => {
    const all = await searchTasks("пагинация щщ", { limit: 10 });
    expect(all).toHaveLength(5);

    const first = await searchTasks("пагинация щщ", { limit: 2 });
    const second = await searchTasks("пагинация щщ", { limit: 2, offset: 2 });
    const firstIds = first.map((h) => h.task.id);
    const secondIds = second.map((h) => h.task.id);

    expect(firstIds).toHaveLength(2);
    expect(secondIds).toHaveLength(2);
    expect(firstIds.filter((id) => secondIds.includes(id))).toEqual([]);
    expect([...firstIds, ...secondIds]).toEqual(all.slice(0, 4).map((h) => h.task.id));
  });

  it("процент в запросе ищется как символ, а не как шаблон", async () => {
    const hits = await searchTasks("100%");
    expect(hits.map((h) => h.task.id)).toEqual([ids.percent]);
  });

  it("подчёркивание в запросе ищется как символ, а не как любой знак", async () => {
    const hits = await searchTasks("прогноз_1");
    expect(hits.map((h) => h.task.id)).toEqual([ids.underscore]);
  });

  it("пустой запрос ничего не возвращает", async () => {
    expect(await searchTasks("   ")).toEqual([]);
  });

  it("searchAll отдаёт задачи и пока пустые заметки", async () => {
    const result = await searchAll("Обновить ВЭДу");
    expect(result.tasks.map((h) => h.task.id)).toEqual([ids.upper]);
    expect(result.notes).toEqual([]);
  });

  it("лимит ограничен потолком страницы", async () => {
    const hits = await searchTasks("пагинация щщ", { limit: 1000 });
    expect(hits.length).toBeLessThanOrEqual(5);
    const single = await searchTasks("пагинация щщ", { limit: 1 });
    expect(single).toHaveLength(1);
  });
});

// Страховка от запуска по боевой базе живёт в хелпере — проверяем её саму.
describe("защита тестовой базы", () => {
  it("нелокальный хост в TEST_DATABASE_URL отвергается", async () => {
    const { assertLocalDatabase } = await import("./helpers/test-db");
    expect(() =>
      assertLocalDatabase("postgresql://user:pass@ep-cool-name.eu-central-1.aws.neon.tech/db")
    ).toThrow(/нелокальный хост/);
    expect(() =>
      assertLocalDatabase("postgresql://postgres:postgres@localhost:55455/constance_ci")
    ).not.toThrow();
  });
});
