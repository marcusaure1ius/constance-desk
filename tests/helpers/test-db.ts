import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "@/lib/db/schema";

/**
 * Подключение к тестовой базе для интеграционных тестов.
 *
 * Берётся ТОЛЬКО `TEST_DATABASE_URL` и никогда `DATABASE_URL`: последний в
 * `.env.local` смотрит в боевой Neon, а vitest подхватывает `.env.local`
 * целиком. Плюс хост обязан быть локальным — иначе тест не запустится.
 */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "postgres", "db"]);

export function assertLocalDatabase(url: string): void {
  const host = new URL(url).hostname.replace(/^\[|\]$/g, "");
  if (!LOCAL_HOSTS.has(host)) {
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
