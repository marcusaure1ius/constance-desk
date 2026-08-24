import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import path from "node:path";
import {
  REMOTE_CONFIRM_FLAG,
  assertWriteAllowed,
  databaseEndpoint,
  databaseHost,
  databaseTarget,
  isLocalDatabaseHost,
  isLocalDatabaseUrl,
} from "@/lib/db/db-host";

const NEON = "postgresql://user:pass@ep-fake-name.eu-central-1.aws.neon.tech/db";
const LOCAL = "postgresql://postgres:postgres@localhost:55462/constance_ci";

/**
 * Строка обхода из ревью T-0007: authority локальный, а соединение уходит по
 * `?host=`. Барьер видел «localhost» и пропускал запись в чужую базу.
 */
const BYPASS =
  "postgresql://postgres:postgres@localhost:9999/constance?host=localtest.me&port=55469";

describe("databaseHost", () => {
  it("приводит хост к нижнему регистру", () => {
    // Схема postgresql: не «специальная», поэтому new URL() сам регистр не
    // трогает — из-за этого прежняя проверка отвергала LOCALHOST.
    expect(new URL("postgresql://u:p@LOCALHOST:5432/db").hostname).toBe("LOCALHOST");
    expect(databaseHost("postgresql://u:p@LOCALHOST:5432/db")).toBe("localhost");
  });

  it("снимает скобки с IPv6", () => {
    expect(databaseHost("postgresql://u:p@[::1]:5432/db")).toBe("::1");
  });

  it("не тащит строку подключения в текст ошибки", () => {
    try {
      databaseHost("не-url-с-паролем-hunter2");
      throw new Error("ожидалась ошибка разбора");
    } catch (e) {
      expect((e as Error).message).not.toContain("hunter2");
      expect((e as Error).message).toContain("DATABASE_URL");
    }
  });
});

describe("isLocalDatabaseHost", () => {
  it.each([
    "localhost",
    "LOCALHOST",
    "LocalHost",
    "127.0.0.1",
    "127.0.0.5",
    "127.1.2.3",
    "::1",
    "[::1]",
    "0:0:0:0:0:0:0:1",
    "::ffff:127.0.0.1",
    "0.0.0.0",
    "host.docker.internal",
    "postgres",
    "db",
    "database",
    "pg",
    "constance.localhost",
    "",
  ])("локальный: %s", (host) => {
    expect(isLocalDatabaseHost(host)).toBe(true);
  });

  it.each([
    "ep-fake-name.eu-central-1.aws.neon.tech",
    "EP-FAKE-NAME.EU-CENTRAL-1.AWS.NEON.TECH",
    "db.example.com",
    // Подстрочное совпадение не должно проходить за локальность
    "localhost.attacker.example",
    "notlocalhost",
    "postgres.example.com",
    // Соседняя сеть, а не петля
    "128.0.0.1",
    "10.0.0.1",
    "2001:db8::1",
    "::ffff:8.8.8.8",
  ])("нелокальный: %s", (host) => {
    expect(isLocalDatabaseHost(host)).toBe(false);
  });
});

describe("isLocalDatabaseUrl", () => {
  it("разбирает URL целиком", () => {
    expect(isLocalDatabaseUrl(LOCAL)).toBe(true);
    expect(isLocalDatabaseUrl(NEON)).toBe(false);
    expect(isLocalDatabaseUrl("postgresql:///constance?host=/var/run/postgresql")).toBe(
      true
    );
  });
});

describe("assertWriteAllowed", () => {
  it("пропускает локальную базу без подтверждения", () => {
    expect(assertWriteAllowed(LOCAL, { confirmed: false, command: "npm run db:migrate" })).toBe(
      "localhost"
    );
  });

  it("на нелокальном хосте требует подтверждения", () => {
    expect(() =>
      assertWriteAllowed(NEON, { confirmed: false, command: "npm run db:migrate" })
    ).toThrow(/не локальный/);
  });

  it("называет хост, команду и флаг — иначе непонятно, что делать", () => {
    try {
      assertWriteAllowed(NEON, {
        confirmed: false,
        command: "npm run db:baseline -- --apply",
        source: "подхвачен из .env.local",
      });
      throw new Error("ожидался барьер");
    } catch (e) {
      const message = (e as Error).message;
      expect(message).toContain("ep-fake-name.eu-central-1.aws.neon.tech");
      expect(message).toContain("npm run db:baseline -- --apply");
      expect(message).toContain(REMOTE_CONFIRM_FLAG);
      expect(message).toContain("подхвачен из .env.local");
    }
  });

  it("с подтверждением пропускает нелокальный хост: легитимный прогон по проду возможен", () => {
    expect(assertWriteAllowed(NEON, { confirmed: true, command: "npm run db:migrate" })).toBe(
      "ep-fake-name.eu-central-1.aws.neon.tech"
    );
  });
});

/**
 * Разбор сверяется с настоящим парсером драйвера, а не с представлением о нём:
 * берётся ровно та копия `pg-connection-string`, которую грузит установленный
 * `pg` (через него ходит и drizzle-kit). Если драйвер поменяет правила, тест
 * покажет это раньше, чем барьер разойдётся с соединением.
 */
const requireFromTest = createRequire(import.meta.url);
const driverParse = requireFromTest(
  requireFromTest.resolve("pg-connection-string", {
    paths: [path.dirname(requireFromTest.resolve("pg"))],
  })
) as (str: string) => { host?: string; port?: string };

/** Края разбора: каждая строка — отдельное правило драйвера. */
const DRIVER_CASES = [
  // Обычные строки
  "postgresql://postgres:postgres@localhost:5432/constance",
  "postgresql://user:pass@ep-fake-name.eu-central-1.aws.neon.tech/db?sslmode=verify-full",
  // Параметры сильнее authority — та самая дыра
  BYPASS,
  "postgresql://u:p@localhost:5432/db?host=evil.example",
  "postgresql://u:p@localhost:5432/db?port=6000",
  // ...но только непустые: пустое значение откатывает на authority
  "postgresql://u:p@localhost:5432/db?host=",
  "postgresql://u:p@localhost:5432/db?host=&port=",
  // При повторе побеждает последний, даже когда он пустой
  "postgresql://u:p@localhost/db?host=a.example&host=b.example",
  "postgresql://u:p@localhost/db?host=evil.example&host=",
  // Имя параметра регистрозависимо, значение хоста — нет
  "postgresql://u:p@localhost/db?HOST=evil.example",
  "postgresql://u:p@localhost/db?host=EVIL.example",
  // %-экранирование: и в authority, и в значении параметра
  "postgresql://u:p@%6cocalhost/db",
  "postgresql://u:p@localhost/db?host=%6cocaltest.me",
  "postgresql://u:p@%2Fvar%2Frun%2Fpostgresql/db",
  "postgresql://u:p@localhost/db?host=%2Fvar%2Frun%2Fpostgresql",
  // Пробел драйвер прогоняет через encodeURI: это параметр « host», а не «host»
  "postgresql://u:p@localhost/db? host=evil.example",
  // ...и тот же encodeURI спасает пароль с пробелом
  "postgresql://u:p ass@localhost:5432/db",
  // Битое %-экранирование в значении параметра драйвер не роняет
  "postgresql://u:p@localhost/db?host=%zz",
  // Unix-сокеты во всех формах
  "postgresql:///constance?host=/var/run/postgresql",
  "postgresql://u:p@/db",
  "/var/run/postgresql constance",
  "socket:/var/run/postgresql?db=constance",
  "socket:/var/run/postgresql?db=constance&host=evil.example",
  // IPv6 в authority, в том числе перебитый параметром
  "postgresql://u:p@[::1]:5432/db",
  "postgresql://u:p@[::ffff:127.0.0.1]:5432/db",
  "postgresql://u:p@[::1]:5432/db?host=evil.example",
  // Регистр authority и короткая схема
  "postgresql://u:p@LOCALHOST:5432/db",
  "postgres://u:p@localhost/db?host=evil.example",
];

describe("databaseTarget: разбор совпадает с драйвером", () => {
  for (const url of DRIVER_CASES) {
    it(url, () => {
      const driver = driverParse(url);
      expect(databaseTarget(url)).toEqual({
        host: driver.host ?? "",
        port: driver.port ?? "",
      });
    });
  }

  it("сверка не тавтология: на этих строках драйвер берёт разные хосты", () => {
    const hosts = new Set(DRIVER_CASES.map((u) => driverParse(u).host));
    expect(hosts.size).toBeGreaterThan(5);
    expect(hosts).toContain("localtest.me");
    expect(hosts).toContain("/var/run/postgresql");
  });

  it("на битом %-экранировании в authority закрывается, как падает драйвер", () => {
    const broken = "postgresql://u:p@%c3%28/db";
    expect(() => driverParse(broken)).toThrow();
    expect(() => databaseTarget(broken)).toThrow(/DATABASE_URL/);
  });

  it("строку-мусор отвергает, хотя драйвер выдумывает ей хост", () => {
    // Расхождение намеренное: драйвер разбирает строку относительно
    // postgres://base и получает хост «base». Барьеру так нельзя — непонятую
    // строку он обязан отвергнуть, а не выдумать ей адрес.
    expect(driverParse("не-url-с-паролем-hunter2").host).toBe("base");
    expect(() => databaseTarget("не-url-с-паролем-hunter2")).toThrow(/DATABASE_URL/);
  });
});

describe("обход барьера через ?host=", () => {
  it("хост и порт берутся из параметров, а не из authority", () => {
    expect(databaseTarget(BYPASS)).toEqual({ host: "localtest.me", port: "55469" });
    expect(databaseHost(BYPASS)).toBe("localtest.me");
  });

  it("такая строка нелокальна и требует подтверждения", () => {
    expect(isLocalDatabaseUrl(BYPASS)).toBe(false);
    expect(() =>
      assertWriteAllowed(BYPASS, { confirmed: false, command: "npm run db:migrate" })
    ).toThrow(/не локальный/);
  });

  it("в сообщении называется тот хост, куда уйдёт соединение", () => {
    try {
      assertWriteAllowed(BYPASS, { confirmed: false, command: "npm run db:migrate" });
      throw new Error("ожидался барьер");
    } catch (e) {
      const first = (e as Error).message.split("\n")[0];
      expect(first).toContain("localtest.me");
      // Обманка из authority в вердикт не попадает («localhost» ниже по тексту —
      // это подсказка про запуск на локальной базе, а не хост этой строки).
      expect(first).not.toContain("localhost");
    }
  });

  it("с подтверждением проходит: легитимный прогон по чужой базе возможен", () => {
    expect(assertWriteAllowed(BYPASS, { confirmed: true, command: "npm run db:migrate" })).toBe(
      "localtest.me"
    );
  });

  it("подмена одного порта локальности не меняет", () => {
    const url = "postgresql://u:p@localhost:9999/db?port=55473";
    expect(isLocalDatabaseUrl(url)).toBe(true);
    expect(databaseEndpoint(url)).toBe("localhost:55473");
  });
});

describe("unix-сокет остаётся локальным", () => {
  for (const url of [
    "postgresql:///constance?host=/var/run/postgresql",
    "postgresql://u:p@localhost/db?host=/var/run/postgresql",
    "postgresql://u:p@%2Fvar%2Frun%2Fpostgresql/db",
    "postgresql://u:p@/db",
    "postgresql:///db",
    "/var/run/postgresql constance",
    "socket:/var/run/postgresql?db=constance",
  ]) {
    it(url, () => {
      expect(isLocalDatabaseUrl(url)).toBe(true);
      expect(() =>
        assertWriteAllowed(url, { confirmed: false, command: "npm run db:migrate" })
      ).not.toThrow();
    });
  }

  it("путь к сокету регистрозависим — его нельзя приводить к нижнему регистру", () => {
    expect(databaseHost("postgresql:///db?host=/Users/Alfa/pg")).toBe("/Users/Alfa/pg");
  });

  it("сокет — это ведущий слэш, а не слэш где угодно", () => {
    // pg решает так же: this.host.indexOf('/') === 0.
    expect(isLocalDatabaseHost("evil.example/var/run")).toBe(false);
    expect(isLocalDatabaseHost("../etc")).toBe(false);
  });
});

describe("databaseEndpoint", () => {
  it("печатает хост и порт, по которым пойдёт соединение", () => {
    expect(databaseEndpoint(BYPASS)).toBe("localtest.me:55469");
    expect(databaseEndpoint(LOCAL)).toBe("localhost:55462");
  });

  it("без порта печатает один хост", () => {
    expect(databaseEndpoint(NEON)).toBe("ep-fake-name.eu-central-1.aws.neon.tech");
  });
});
