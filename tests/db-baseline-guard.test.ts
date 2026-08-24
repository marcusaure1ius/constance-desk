import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Барьер `db:baseline --apply` на нелокальной базе.
 *
 * Главное здесь — «ничего не пишет» проверяется не по факту записи, а по тому,
 * что скрипт вообще не дошёл до подключения: `pg` замокан, и конструктор
 * `Client` не должен быть вызван ни разу. Барьер, срабатывающий после
 * connect, уже не барьер.
 */
const clientCtor = vi.fn();

vi.mock("pg", () => ({
  Client: class {
    constructor(config: unknown) {
      clientCtor(config);
    }
    connect = vi.fn();
    query = vi.fn();
    end = vi.fn();
  },
}));

const NEON = "postgresql://user:pass@ep-fake-name.eu-central-1.aws.neon.tech/db";

// DATABASE_URL общий на процесс: при выключенной изоляции файлов безусловное
// `delete` в afterEach обокрало бы соседей (так же снимает и восстанавливает
// переменную tests/db-connection.test.ts).
const ORIGINAL_URL = process.env.DATABASE_URL;

let logs: string[] = [];
let logSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  clientCtor.mockClear();
  logs = [];
  logSpy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    logs.push(args.join(" "));
  });
});

afterEach(() => {
  logSpy.mockRestore();
  if (ORIGINAL_URL === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = ORIGINAL_URL;
});

describe("baseline: барьер по нелокальному хосту", () => {
  it("--apply без подтверждения падает и не подключается к базе", async () => {
    const { baseline } = await import("@/lib/db/baseline");
    process.env.DATABASE_URL = NEON;

    await expect(baseline(true)).rejects.toThrow(/не локальный/);
    expect(clientCtor).not.toHaveBeenCalled();
  });

  it("перед барьером печатает хост базы", async () => {
    const { baseline } = await import("@/lib/db/baseline");
    process.env.DATABASE_URL = NEON;

    await expect(baseline(true)).rejects.toThrow();
    expect(logs.join("\n")).toContain("База: ep-fake-name.eu-central-1.aws.neon.tech");
  });

  it("подтверждённый прогон до барьера не останавливается", async () => {
    const { baseline } = await import("@/lib/db/baseline");
    process.env.DATABASE_URL = NEON;

    // Мок pg ничего не отвечает на query — до содержательной части не дойдёт,
    // но это уже за барьером: важно, что подключение началось.
    await baseline(true, true).catch(() => {});
    expect(clientCtor).toHaveBeenCalledTimes(1);
  });

  it("предпросмотр по нелокальной базе законен: он read-only", async () => {
    const { baseline } = await import("@/lib/db/baseline");
    process.env.DATABASE_URL = NEON;

    await baseline(false).catch(() => {});
    expect(clientCtor).toHaveBeenCalledTimes(1);
  });
});
