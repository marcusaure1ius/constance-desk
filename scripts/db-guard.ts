/**
 * Обёртка над командами drizzle-kit, которые пишут в базу (`migrate`, `push`).
 *
 *   npx tsx scripts/db-guard.ts migrate
 *   npx tsx scripts/db-guard.ts push -- --i-know-its-production
 *
 * Зачем. `drizzle.config.ts` зовёт `loadEnvConfig(process.cwd())`, а тот
 * подхватывает `.env.local` с боевым Neon-URL. То есть `npm run db:migrate`
 * без явного `DATABASE_URL` целится в продакшен — и раньше это было безобидно
 * только потому, что пакета `pg` в проекте не было. Обёртка встаёт перед
 * drizzle-kit, печатает хост и его происхождение и на нелокальном хосте
 * требует явного `--i-know-its-production`.
 *
 * Подтверждение читается ТОЛЬКО из argv и только до загрузки `.env.local`:
 * иначе переменную-подтверждение можно было бы прописать в тот же `.env.local`
 * и обесценить барьер.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { loadEnvConfig } from "@next/env";
import { REMOTE_CONFIRM_FLAG, assertWriteAllowed } from "../lib/db/db-host";

/** Команды drizzle-kit, которые изменяют базу. Остальные обёртка не пускает. */
const WRITING_COMMANDS = new Set(["migrate", "push"]);

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function main(): void {
  const argv = process.argv.slice(2);
  const command = argv[0];
  if (!command || !WRITING_COMMANDS.has(command)) {
    fail(
      `Обёртка вызывается как: npx tsx scripts/db-guard.ts <${[...WRITING_COMMANDS].join("|")}> [аргументы drizzle-kit]`
    );
  }

  // Подтверждение снимается из argv до loadEnvConfig и в drizzle-kit не идёт.
  const confirmed = argv.includes(REMOTE_CONFIRM_FLAG);
  const passthrough = argv.slice(1).filter((a) => a !== REMOTE_CONFIRM_FLAG);

  // Явный DATABASE_URL — тот, что уже в окружении. Всё, что приедет ниже из
  // .env.local, — неявный: пользователь его в этой команде не называл.
  const explicit = process.env.DATABASE_URL;
  if (!explicit) loadEnvConfig(process.cwd());

  const url = process.env.DATABASE_URL;
  if (!url) {
    fail(
      "DATABASE_URL не задан ни в окружении, ни в .env.local.\n" +
        `Запуск по локальной базе: DATABASE_URL=postgresql://postgres:postgres@localhost:5432/constance npm run db:${command}`
    );
  }

  const source = explicit ? "задан явно" : "подхвачен из .env.local";
  let host: string;
  try {
    host = assertWriteAllowed(url, {
      confirmed,
      command: `npm run db:${command}`,
      source,
    });
  } catch (e) {
    fail(e instanceof Error ? e.message : String(e));
  }

  console.log(`База: ${host} (DATABASE_URL ${source})`);
  if (confirmed) console.log("Подтверждено флагом " + REMOTE_CONFIRM_FLAG + ".");

  const local = path.join(process.cwd(), "node_modules", ".bin", "drizzle-kit");
  const bin = existsSync(local) ? local : "drizzle-kit";
  const result = spawnSync(bin, [command, ...passthrough], { stdio: "inherit" });

  if (result.error) fail(`Не удалось запустить drizzle-kit: ${result.error.message}`);
  // Сигнал (например, Ctrl+C) статуса не даёт — не выдаём его за успех.
  process.exit(result.status ?? 1);
}

main();
