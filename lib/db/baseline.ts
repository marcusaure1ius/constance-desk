/**
 * Baseline журнала миграций.
 *
 * Зачем нужен. Схема Constance накатывалась через `drizzle-kit push`, поэтому
 * таблицы в базе есть, а журнал `drizzle.__drizzle_migrations` пуст. Если в
 * таком состоянии запустить `drizzle-kit migrate`, он начнёт применять всё с
 * нуля и упадёт на первом же `CREATE TABLE` уже существующей таблицы.
 *
 * Скрипт помечает существующие миграции применёнными, не выполняя их SQL.
 * Запускается **один раз на базу** перед первым `db:migrate`.
 *
 *   npm run db:baseline            — показать, что будет сделано (read-only)
 *   npm run db:baseline -- --apply — записать в журнал
 *
 * Хеш и метка времени считаются ровно так же, как в drizzle-orm
 * (node_modules/drizzle-orm/migrator.js): sha256 содержимого .sql-файла и
 * поле `when` из meta/_journal.json. Мигратор сравнивает по `created_at`,
 * поэтому после baseline он корректно пропустит отмеченные миграции.
 *
 * Драйвер — `pg`, а не `@neondatabase/serverless`: скрипт запускают руками и с
 * локальной базой тоже, а neon-драйвер умеет только websocket к Neon.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Client } from "pg";

type JournalEntry = { idx: number; when: number; tag: string };

const MIGRATIONS_DIR = path.join(process.cwd(), "drizzle");

export function readJournal(dir: string = MIGRATIONS_DIR): JournalEntry[] {
  const journalPath = path.join(dir, "meta", "_journal.json");
  const journal = JSON.parse(fs.readFileSync(journalPath, "utf8"));
  return journal.entries as JournalEntry[];
}

export function migrationHash(tag: string, dir: string = MIGRATIONS_DIR): string {
  const sql = fs.readFileSync(path.join(dir, `${tag}.sql`), "utf8");
  return crypto.createHash("sha256").update(sql).digest("hex");
}

export async function baseline(apply: boolean) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL не задан");

  const entries = readJournal();
  const client = new Client({ connectionString: url });
  await client.connect();

  try {
    // Предпросмотр обязан быть строго read-only: ничего не создаём, пока не
    // передан --apply. Отсутствие таблицы журнала — нормальный случай, он и
    // означает, что baseline ещё не делали.
    const journalTable = await client.query(
      `SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'drizzle' AND table_name = '__drizzle_migrations'`
    );

    const appliedHashes = new Set<string>();
    if (journalTable.rowCount) {
      const applied = await client.query<{ hash: string }>(
        "SELECT hash FROM drizzle.__drizzle_migrations"
      );
      for (const row of applied.rows) appliedHashes.add(row.hash);
    }

    const pending = entries.filter(
      (e) => !appliedHashes.has(migrationHash(e.tag))
    );

    if (pending.length === 0) {
      console.log("Журнал в порядке: все миграции отмечены применёнными.");
      return { marked: 0 };
    }

    console.log(`Будут отмечены применёнными без выполнения SQL: ${pending.length}`);
    for (const e of pending) console.log(`  ${e.tag}`);

    if (!apply) {
      console.log("\nЭто предпросмотр, база не изменена.");
      console.log("Запуск: npm run db:baseline -- --apply");
      return { marked: 0 };
    }

    await client.query("CREATE SCHEMA IF NOT EXISTS drizzle");
    await client.query(
      `CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
         id SERIAL PRIMARY KEY,
         hash text NOT NULL,
         created_at bigint
       )`
    );

    for (const e of pending) {
      await client.query(
        'INSERT INTO drizzle.__drizzle_migrations ("hash", "created_at") VALUES ($1, $2)',
        [migrationHash(e.tag), e.when]
      );
    }

    console.log(`\nОтмечено: ${pending.length}. Теперь можно запускать db:migrate.`);
    return { marked: pending.length };
  } finally {
    await client.end();
  }
}

if (process.argv[1]?.endsWith("baseline.ts")) {
  baseline(process.argv.includes("--apply")).catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
