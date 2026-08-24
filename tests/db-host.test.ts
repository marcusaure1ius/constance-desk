import { describe, it, expect } from "vitest";
import {
  REMOTE_CONFIRM_FLAG,
  assertWriteAllowed,
  databaseHost,
  isLocalDatabaseHost,
  isLocalDatabaseUrl,
} from "@/lib/db/db-host";

const NEON = "postgresql://user:pass@ep-fake-name.eu-central-1.aws.neon.tech/db";
const LOCAL = "postgresql://postgres:postgres@localhost:55462/constance_ci";

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
