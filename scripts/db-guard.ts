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
 *
 * Логика вынесена из `main` в `runGuard` с внешними зависимостями, чтобы её
 * можно было проверить тестами: у обёртки нет типов и компилятор её ошибок не
 * ловит, а молчаливая регрессия здесь стоит боевой базы (`tests/db-guard.test.ts`).
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { loadEnvConfig } from "@next/env";
import {
  REMOTE_CONFIRM_FLAG,
  assertWriteAllowed,
  databaseEndpoint,
} from "../lib/db/db-host";

/** Команды drizzle-kit, которые изменяют базу. Остальные обёртка не пускает. */
const WRITING_COMMANDS = new Set(["migrate", "push"]);

export type GuardArgv = {
  command: string;
  confirmed: boolean;
  /** Аргументы, которые уходят drizzle-kit как есть. */
  passthrough: string[];
};

/**
 * Разбор аргументов обёртки.
 *
 * Отдельной функцией и без доступа к окружению намеренно: подтверждение обязано
 * приходить только из этой командной строки. Будь оно доступно из переменных,
 * его можно было бы прописать в `.env.local` — рядом с боевым URL, который
 * барьер и сторожит.
 */
export function parseGuardArgv(argv: string[]): GuardArgv {
  const command = argv[0];
  if (!command || !WRITING_COMMANDS.has(command)) {
    throw new Error(
      `Обёртка вызывается как: npx tsx scripts/db-guard.ts <${[...WRITING_COMMANDS].join("|")}> [аргументы drizzle-kit]`
    );
  }

  // Подтверждение снимается из argv и в drizzle-kit не идёт: там оно
  // неизвестный аргумент, а в логе — лишний повод считать флаг безобидным.
  return {
    command,
    confirmed: argv.includes(REMOTE_CONFIRM_FLAG),
    passthrough: argv.slice(1).filter((a) => a !== REMOTE_CONFIRM_FLAG),
  };
}

export type GuardDeps = {
  /** Окружение процесса; `loadDotEnv` дописывает в него же. */
  env: Record<string, string | undefined>;
  /** Подхват `.env.local` — вызывается только если DATABASE_URL не задан явно. */
  loadDotEnv: () => void;
  run: (bin: string, args: string[]) => { status: number | null; error?: Error };
  log: (message: string) => void;
  fail: (message: string) => void;
};

/** Код возврата процесса: 0 — drizzle-kit отработал, иначе провал. */
export function runGuard(argv: string[], deps: GuardDeps): number {
  let parsed: GuardArgv;
  try {
    parsed = parseGuardArgv(argv);
  } catch (e) {
    deps.fail(message(e));
    return 1;
  }
  const { command, confirmed, passthrough } = parsed;

  // Явный DATABASE_URL — тот, что уже в окружении. Всё, что приедет ниже из
  // .env.local, — неявный: пользователь его в этой команде не называл.
  const explicit = deps.env.DATABASE_URL;
  if (!explicit) deps.loadDotEnv();

  const url = deps.env.DATABASE_URL;
  if (!url) {
    deps.fail(
      "DATABASE_URL не задан ни в окружении, ни в .env.local.\n" +
        `Запуск по локальной базе: DATABASE_URL=postgresql://postgres:postgres@localhost:5432/constance npm run db:${command}`
    );
    return 1;
  }

  const source = explicit ? "задан явно" : "подхвачен из .env.local";
  try {
    assertWriteAllowed(url, { confirmed, command: `npm run db:${command}`, source });
  } catch (e) {
    deps.fail(message(e));
    return 1;
  }

  // Хост и порт печатаются те самые, по которым пойдёт соединение: authority
  // строки подключения может говорить одно, а параметры `?host=`/`?port=` —
  // другое, и решает драйвер (см. lib/db/db-host.ts).
  deps.log(`База: ${databaseEndpoint(url)} (DATABASE_URL ${source})`);
  if (confirmed) deps.log("Подтверждено флагом " + REMOTE_CONFIRM_FLAG + ".");

  const local = path.join(process.cwd(), "node_modules", ".bin", "drizzle-kit");
  const bin = existsSync(local) ? local : "drizzle-kit";
  const result = deps.run(bin, [command, ...passthrough]);

  if (result.error) {
    deps.fail(`Не удалось запустить drizzle-kit: ${result.error.message}`);
    return 1;
  }
  // Сигнал (например, Ctrl+C) статуса не даёт — не выдаём его за успех.
  return result.status ?? 1;
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

if (process.argv[1]?.endsWith("db-guard.ts")) {
  process.exit(
    runGuard(process.argv.slice(2), {
      env: process.env,
      loadDotEnv: () => loadEnvConfig(process.cwd()),
      run: (bin, args) => {
        const result = spawnSync(bin, args, { stdio: "inherit" });
        return { status: result.status, error: result.error };
      },
      log: (m) => console.log(m),
      fail: (m) => console.error(m),
    })
  );
}
