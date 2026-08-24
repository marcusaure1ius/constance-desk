import { describe, it, expect, afterEach, vi } from "vitest";

/*
 * Регрессия на T-0011: импорт `lib/db` не должен требовать DATABASE_URL.
 *
 * Раньше подключение создавалось на верхнем уровне модуля, поэтому офлайн-
 * прогон в CI падал ещё на загрузке файла: в джобе `test` переменной нет, а
 * локально она приезжала из `.env.local` через loadEnv — и дефект был не виден.
 * Тест снимает переменную явно, чтобы не зависеть от того, что лежит в
 * окружении разработчика.
 */

const ORIGINAL_URL = process.env.DATABASE_URL;

function withoutDatabaseUrl() {
  delete process.env.DATABASE_URL;
  vi.resetModules();
}

afterEach(() => {
  if (ORIGINAL_URL === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = ORIGINAL_URL;
  vi.resetModules();
});

describe("подключение к базе", () => {
  it("модуль импортируется без DATABASE_URL", async () => {
    withoutDatabaseUrl();

    // Object.keys по пространству имён модуля не трогает сам `db`, поэтому
    // проверяется именно импорт, а не первое обращение.
    const mod = await import("@/lib/db");
    expect(Object.keys(mod)).toContain("db");
  });

  it("без DATABASE_URL запрос падает с внятной ошибкой", async () => {
    withoutDatabaseUrl();

    const { db } = await import("@/lib/db");
    expect(() => db.select()).toThrow(/DATABASE_URL/);
  });

  it("с DATABASE_URL запросы через прокси строятся как обычно", async () => {
    process.env.DATABASE_URL = "postgresql://user:pass@ep-test.eu-central-1.aws.neon.tech/testdb";
    vi.resetModules();

    const { db } = await import("@/lib/db");
    const { tasks } = await import("@/lib/db/schema");

    // Билдер запроса и relational-API доступны через прокси, а не только
    // «объект не undefined».
    const { sql } = db.select().from(tasks).toSQL();
    expect(sql).toContain('from "tasks"');
    expect(db.query.tasks).toBeDefined();
    expect(typeof db.transaction).toBe("function");
  });
});
