/**
 * Baseline журнала миграций.
 *
 * Зачем нужен. Схема Constance накатывалась через `drizzle-kit push`, поэтому
 * таблицы в базе есть, а журнал `drizzle.__drizzle_migrations` пуст. Если в
 * таком состоянии запустить `drizzle-kit migrate`, он начнёт применять всё с
 * нуля и упадёт на первом же `CREATE TABLE` существующей таблицы.
 *
 * Скрипт помечает уже существующие миграции применёнными, ничего не выполняя.
 * Запускается **один раз на базу** перед первым `db:migrate`.
 *
 *   npm run db:baseline           — показать, что будет сделано
 *   npm run db:baseline -- --apply — записать в журнал
 *
 * Хеш и метка времени считаются ровно так же, как это делает drizzle-orm
 * (см. node_modules/drizzle-orm/migrator.js): sha256 содержимого .sql-файла и
 * поле `when` из meta/_journal.json.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { neon } from "@neondatabase/serverless";

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

  const sql = neon(url);
  const entries = readJournal();

  await sql`CREATE SCHEMA IF NOT EXISTS drizzle`;
  await sql`CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
    id SERIAL PRIMARY KEY,
    hash text NOT NULL,
    created_at bigint
  )`;

  const applied = (await sql`
    SELECT hash FROM drizzle.__drizzle_migrations
  `) as { hash: string }[];
  const appliedHashes = new Set(applied.map((r) => r.hash));

  const pending = entries.filter((e) => !appliedHashes.has(migrationHash(e.tag)));

  if (pending.length === 0) {
    console.log("Журнал уже в порядке: все миграции отмечены применёнными.");
    return { marked: 0 };
  }

  console.log(
    `Будут отмечены применёнными (без выполнения SQL): ${pending.length}`
  );
  for (const e of pending) console.log(`  ${e.tag}`);

  if (!apply) {
    console.log("\nЭто предварительный просмотр. Запуск: npm run db:baseline -- --apply");
    return { marked: 0 };
  }

  for (const e of pending) {
    await sql`
      INSERT INTO drizzle.__drizzle_migrations ("hash", "created_at")
      VALUES (${migrationHash(e.tag)}, ${e.when})
    `;
  }

  console.log(`\nГотово: отмечено ${pending.length}. Теперь можно запускать db:migrate.`);
  return { marked: pending.length };
}

if (process.argv[1] && process.argv[1].endsWith("baseline.ts")) {
  baseline(process.argv.includes("--apply")).catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
