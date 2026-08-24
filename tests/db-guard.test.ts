import { describe, it, expect, vi } from "vitest";
import { REMOTE_CONFIRM_FLAG } from "@/lib/db/db-host";
import { parseGuardArgv, runGuard, type GuardDeps } from "../scripts/db-guard";

/**
 * Обёртка `npm run db:migrate` / `db:push`.
 *
 * У неё нет типов, которые ловил бы компилятор, и нет прогона в CI на плохом
 * пути: барьер здесь мог бы отвалиться молча, а стоит это боевой базы. Поэтому
 * проверяется то, на чём барьер держится: подтверждение приходит только из
 * argv, drizzle-kit не запускается, пока барьер не пройден, и хост берётся тот,
 * по которому реально пойдёт соединение.
 *
 * Запуск drizzle-kit подменён: тесты обязаны быть офлайн и ничего не писать.
 */
const NEON = "postgresql://user:pass@ep-fake-name.eu-central-1.aws.neon.tech/db";
const LOCAL = "postgresql://postgres:postgres@localhost:55473/constance_ci";
/** Локальный authority, а соединение уходит по ?host= — находка ревью T-0007. */
const BYPASS =
  "postgresql://postgres:postgres@localhost:9999/constance?host=localtest.me&port=55469";

type Harness = {
  deps: GuardDeps;
  run: ReturnType<typeof vi.fn>;
  logs: string[];
  errors: string[];
};

type Env = Record<string, string | undefined>;

/**
 * Переменные, которые тесты трогают в НАСТОЯЩЕМ окружении процесса.
 *
 * Настоящем — потому что в бою `runGuard` получает именно `process.env`, и
 * проверка «подтверждение только из argv» обязана быть проверкой про него:
 * с подставным объектом она проходит, даже если код читает process.env
 * напрямую. Плюс vitest подмешивает в окружение `.env.local` с боевым
 * DATABASE_URL — его надо снять, а после теста вернуть.
 */
const TOUCHED_ENV = [
  "DATABASE_URL",
  REMOTE_CONFIRM_FLAG,
  "I_KNOW_ITS_PRODUCTION",
  "DB_GUARD_CONFIRMED",
  "DRIZZLE_FORCE",
];

function withProcessEnv(vars: Env, fn: () => void): void {
  const saved = TOUCHED_ENV.map((k) => [k, process.env[k]] as const);
  for (const k of TOUCHED_ENV) delete process.env[k];
  Object.assign(process.env, vars);
  try {
    fn();
  } finally {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

function harness(env: Env, options: { dotEnv?: Env; status?: number } = {}): Harness {
  const logs: string[] = [];
  const errors: string[] = [];
  const run = vi.fn(() => ({ status: options.status ?? 0 }));

  return {
    run,
    logs,
    errors,
    deps: {
      env,
      // Настоящий loadEnvConfig дописывает в то же окружение — модель та же.
      loadDotEnv: () => Object.assign(env, options.dotEnv ?? {}),
      run,
      log: (m) => logs.push(m),
      fail: (m) => errors.push(m),
    },
  };
}

describe("parseGuardArgv", () => {
  it("читает команду и отдаёт остальное drizzle-kit", () => {
    expect(parseGuardArgv(["migrate"])).toEqual({
      command: "migrate",
      confirmed: false,
      passthrough: [],
    });
    expect(parseGuardArgv(["push", "--force", "--verbose"])).toEqual({
      command: "push",
      confirmed: false,
      passthrough: ["--force", "--verbose"],
    });
  });

  it("флаг подтверждения снимается из passthrough, а не уезжает в drizzle-kit", () => {
    expect(parseGuardArgv(["push", "--force", REMOTE_CONFIRM_FLAG, "--verbose"])).toEqual({
      command: "push",
      confirmed: true,
      passthrough: ["--force", "--verbose"],
    });
  });

  it("повторённый флаг вырезается весь", () => {
    expect(
      parseGuardArgv(["migrate", REMOTE_CONFIRM_FLAG, "--x", REMOTE_CONFIRM_FLAG]).passthrough
    ).toEqual(["--x"]);
  });

  it("похожий, но другой аргумент подтверждением не считается", () => {
    const parsed = parseGuardArgv(["migrate", `${REMOTE_CONFIRM_FLAG}=1`, "--i-know"]);
    expect(parsed.confirmed).toBe(false);
    expect(parsed.passthrough).toEqual([`${REMOTE_CONFIRM_FLAG}=1`, "--i-know"]);
  });

  it("без команды и на чужой команде отказывает: обёртка не общий проксик", () => {
    expect(() => parseGuardArgv([])).toThrow(/migrate\|push/);
    expect(() => parseGuardArgv(["studio"])).toThrow(/migrate\|push/);
    expect(() => parseGuardArgv([REMOTE_CONFIRM_FLAG])).toThrow(/migrate\|push/);
  });
});

describe("runGuard: подтверждение приходит только из argv", () => {
  it("переменные окружения не подтверждают ничего", () => {
    // Имена взяты с запасом: и сам флаг как имя переменной, и «человеческие»
    // варианты, которые первым делом захочется прописать в окружение.
    withProcessEnv(
      {
        DATABASE_URL: NEON,
        [REMOTE_CONFIRM_FLAG]: "1",
        I_KNOW_ITS_PRODUCTION: "1",
        DB_GUARD_CONFIRMED: "true",
        DRIZZLE_FORCE: "1",
      },
      () => {
        const h = harness(process.env);

        expect(runGuard(["migrate"], h.deps)).toBe(1);
        expect(h.run).not.toHaveBeenCalled();
        expect(h.errors.join("\n")).toContain(REMOTE_CONFIRM_FLAG);
      }
    );
  });

  it(".env.local не может подтвердить сам себя", () => {
    // Смысл барьера: боевой URL приезжает из .env.local — оттуда же нельзя
    // разрешить запись, иначе барьер обесценен одной строкой в том же файле.
    // Настоящий loadEnvConfig пишет в process.env, поэтому и здесь окружение
    // настоящее: иначе тест не увидел бы чтения переменных напрямую.
    withProcessEnv({}, () => {
      const h = harness(process.env, {
        dotEnv: {
          DATABASE_URL: NEON,
          [REMOTE_CONFIRM_FLAG]: "1",
          I_KNOW_ITS_PRODUCTION: "1",
        },
      });

      expect(runGuard(["migrate"], h.deps)).toBe(1);
      expect(h.run).not.toHaveBeenCalled();
      expect(h.errors.join("\n")).toContain("подхвачен из .env.local");
    });
  });

  it("с флагом в argv прогон по нелокальной базе разрешён", () => {
    const h = harness({ DATABASE_URL: NEON });

    expect(runGuard(["migrate", REMOTE_CONFIRM_FLAG], h.deps)).toBe(0);
    expect(h.run).toHaveBeenCalledTimes(1);
    expect(h.run.mock.calls[0][1]).toEqual(["migrate"]);
    expect(h.logs.join("\n")).toContain(REMOTE_CONFIRM_FLAG);
  });
});

describe("runGuard: барьер стоит до drizzle-kit", () => {
  it("обход через ?host= не проходит и до запуска не доходит", () => {
    const h = harness({ DATABASE_URL: BYPASS });

    expect(runGuard(["migrate"], h.deps)).toBe(1);
    expect(h.run).not.toHaveBeenCalled();
    expect(h.errors.join("\n")).toContain("localtest.me");
  });

  it("нелокальная база без флага: код 1 и ни одного запуска", () => {
    const h = harness({ DATABASE_URL: NEON });

    expect(runGuard(["push"], h.deps)).toBe(1);
    expect(h.run).not.toHaveBeenCalled();
  });

  it("без DATABASE_URL не запускает drizzle-kit вслепую", () => {
    const h = harness({});

    expect(runGuard(["migrate"], h.deps)).toBe(1);
    expect(h.run).not.toHaveBeenCalled();
    expect(h.errors.join("\n")).toContain("DATABASE_URL не задан");
  });

  it("на чужой команде не запускает ничего", () => {
    const h = harness({ DATABASE_URL: LOCAL });

    expect(runGuard(["studio"], h.deps)).toBe(1);
    expect(h.run).not.toHaveBeenCalled();
  });
});

describe("runGuard: локальная база работает без флагов", () => {
  it("запускает drizzle-kit и возвращает его код", () => {
    const h = harness({ DATABASE_URL: LOCAL });

    expect(runGuard(["migrate"], h.deps)).toBe(0);
    expect(h.run).toHaveBeenCalledTimes(1);
    expect(h.run.mock.calls[0][1]).toEqual(["migrate"]);
  });

  it("проваленный drizzle-kit не выдаётся за успех", () => {
    const h = harness({ DATABASE_URL: LOCAL }, { status: 3 });
    expect(runGuard(["migrate"], h.deps)).toBe(3);
  });

  it("прерванный сигналом drizzle-kit тоже не успех", () => {
    const h = harness({ DATABASE_URL: LOCAL });
    // Ctrl+C: статуса нет вообще, есть только сигнал.
    h.deps.run = () => ({ status: null });
    expect(runGuard(["migrate"], h.deps)).toBe(1);
  });

  it("печатает хост и порт, по которым пойдёт соединение", () => {
    const h = harness({ DATABASE_URL: LOCAL });
    runGuard(["migrate"], h.deps);
    expect(h.logs.join("\n")).toContain("База: localhost:55473 (DATABASE_URL задан явно)");
  });

  it("явный DATABASE_URL сильнее .env.local: боевой URL не подменяет локальный", () => {
    const h = harness({ DATABASE_URL: LOCAL }, { dotEnv: { DATABASE_URL: NEON } });

    expect(runGuard(["migrate"], h.deps)).toBe(0);
    expect(h.logs.join("\n")).toContain("задан явно");
    expect(h.logs.join("\n")).not.toContain("neon.tech");
  });
});
