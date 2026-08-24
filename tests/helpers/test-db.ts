import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "@/lib/db/schema";
import { databaseHost, isLocalDatabaseHost } from "@/lib/db/db-host";

/**
 * Подключение к тестовой базе для интеграционных тестов.
 *
 * Берётся ТОЛЬКО `TEST_DATABASE_URL` и никогда `DATABASE_URL`: последний в
 * `.env.local` смотрит в боевой Neon, а vitest подхватывает `.env.local`
 * целиком. Плюс хост обязан быть локальным — иначе тест не запустится.
 *
 * Сама проверка локальности — общая с барьером команд миграций
 * (`lib/db/db-host.ts`). Здесь она когда-то жила своей копией и отвергала
 * `LOCALHOST` в верхнем регистре: `new URL()` не приводит хост к нижнему
 * регистру для схемы `postgresql:`.
 */
export function assertLocalDatabase(url: string): void {
  const host = databaseHost(url);
  if (!isLocalDatabaseHost(host)) {
    throw new Error(
      `TEST_DATABASE_URL указывает на нелокальный хост "${host}". ` +
        "Интеграционные тесты пишут и удаляют данные — запускать их можно только на локальной базе."
    );
  }
}

let pool: Pool | null = null;
let testDb: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function createTestDb() {
  if (testDb) return testDb;

  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error(
      "TEST_DATABASE_URL не задан — интеграционным тестам нужна настоящая локальная PostgreSQL. " +
        "Запуск: TEST_DATABASE_URL=postgresql://... npm run test:integration:db"
    );
  }
  assertLocalDatabase(url);

  pool = new Pool({ connectionString: url });
  testDb = drizzle(pool, { schema });
  return testDb;
}

export async function closeTestDb(): Promise<void> {
  await pool?.end();
  pool = null;
  testDb = null;
}
