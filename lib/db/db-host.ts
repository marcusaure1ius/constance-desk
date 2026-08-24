/**
 * Локальность хоста базы и барьер перед записью в неё.
 *
 * Зачем. `DATABASE_URL` в `.env.local` смотрит в боевой Neon, а
 * `drizzle.config.ts` подтягивает `.env.local` через `loadEnvConfig`. Пока в
 * проекте не было пакета `pg`, команды миграций локально просто не работали;
 * теперь работают — и `db:migrate` или `db:baseline --apply`, запущенные без
 * явного `DATABASE_URL`, уходят в продакшен. У `migrate` последствия шумные
 * (упадёт на `CREATE TABLE` существующей таблицы), у `baseline --apply` —
 * молчаливые: он отметит боевой журнал применённым, и откатить это обычным
 * способом нельзя.
 *
 * Поэтому один общий барьер: нелокальный хост требует явного флага
 * подтверждения. Проверка живёт здесь, а не копией в каждом скрипте, — у
 * копий разъезжаются края, а края тут дорогие (тестовый хелпер отвергал
 * `LOCALHOST` в верхнем регистре именно из-за такого края).
 */

/** Флаг «да, я знаю, что это не локальная база». */
export const REMOTE_CONFIRM_FLAG = "--i-know-its-production";

/**
 * Имена, за которыми стоит база на машине разработчика или в docker-сети.
 * Имена сервисов docker compose (`postgres`, `db`, …) резолвятся только внутри
 * сети контейнеров, снаружи их не существует.
 */
const LOCAL_HOSTNAMES = new Set([
  "localhost",
  "0.0.0.0",
  "host.docker.internal",
  "postgres",
  "postgresql",
  "pg",
  "db",
  "database",
]);

/**
 * Хост из строки подключения в каноническом виде: нижний регистр, без скобок
 * вокруг IPv6.
 *
 * Регистр приводится вручную намеренно. Схема `postgresql:` для WHATWG-парсера
 * не «специальная», поэтому `new URL()` оставляет хост как есть:
 * `postgresql://u:p@LOCALHOST/db` даёт `"LOCALHOST"`, тогда как
 * `https://LOCALHOST` дал бы `"localhost"`.
 *
 * Строка подключения в сообщение об ошибке не попадает — в ней пароль.
 */
export function databaseHost(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(
      "Строка подключения к базе не разбирается как URL — проверьте DATABASE_URL."
    );
  }
  return stripBrackets(parsed.hostname).toLowerCase();
}

/**
 * Локальный ли хост. Аргумент — уже хост, а не URL: вызывающий обычно
 * печатает хост в сообщении и не должен разбирать URL дважды.
 */
export function isLocalDatabaseHost(host: string): boolean {
  const h = stripBrackets(host).toLowerCase();

  // Unix-сокет: `postgresql:///constance?host=/var/run/postgresql`.
  if (h === "") return true;

  if (LOCAL_HOSTNAMES.has(h)) return true;

  // RFC 6761: вся зона .localhost — петля. Проверка именно по точке, иначе
  // сюда попал бы «localhost.attacker.example».
  if (h.endsWith(".localhost")) return true;

  // Петля IPv4 — вся сеть 127.0.0.0/8, а не только 127.0.0.1.
  if (isLoopbackIpv4(h)) return true;

  if (h.includes(":")) return isLoopbackIpv6(h);

  return false;
}

/** Локальна ли база, на которую смотрит строка подключения. */
export function isLocalDatabaseUrl(url: string): boolean {
  return isLocalDatabaseHost(databaseHost(url));
}

/**
 * Барьер перед записью в базу. Возвращает хост, чтобы вызывающий его напечатал:
 * «что за база» должно быть видно до того, как в неё что-то ушло.
 *
 * Барьер срабатывает до всякого сетевого обращения — это и есть его смысл.
 */
export function assertWriteAllowed(
  url: string,
  options: {
    confirmed: boolean;
    /** Как команда называется в прозе: «npm run db:migrate». */
    command: string;
    /** Готовая строка запуска с подтверждением, если она не выводится из command. */
    confirmExample?: string;
    /** Откуда взялся DATABASE_URL — для сообщения. */
    source?: string;
  }
): string {
  const host = databaseHost(url);
  if (isLocalDatabaseHost(host) || options.confirmed) return host;

  const source = options.source ? ` (${options.source})` : "";
  const example = options.confirmExample ?? `${options.command} -- ${REMOTE_CONFIRM_FLAG}`;
  throw new Error(
    `Хост базы "${host}" не локальный${source}, а команда ${options.command} пишет в базу.\n` +
      "Похоже на боевую базу. Если это действительно она и запись нужна, повторите " +
      "с явным подтверждением:\n" +
      `  DATABASE_URL=… ${example}\n` +
      "Для локальной базы задайте DATABASE_URL на localhost."
  );
}

function stripBrackets(host: string): string {
  return host.replace(/^\[/, "").replace(/\]$/, "");
}

function isLoopbackIpv4(host: string): boolean {
  const parts = host.split(".");
  if (parts.length !== 4) return false;
  if (!parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255)) return false;
  return parts[0] === "127";
}

/**
 * Петля IPv6 в любой записи: `::1`, `0:0:0:0:0:0:0:1`, а также
 * IPv4-совместимая `::ffff:127.0.0.1`.
 *
 * Нормализация — через тот же WHATWG-парсер: для «специальной» схемы он
 * сжимает адрес к канонической форме (`0:0:…:1` → `::1`,
 * `::ffff:127.0.0.1` → `::ffff:7f00:1`), поэтому свой разбор IPv6 не нужен.
 */
function isLoopbackIpv6(host: string): boolean {
  let canonical: string;
  try {
    canonical = stripBrackets(new URL(`http://[${host}]/`).hostname);
  } catch {
    return false;
  }

  if (canonical === "::1") return true;

  const mapped = /^::ffff:([0-9a-f]{1,4}):[0-9a-f]{1,4}$/.exec(canonical);
  if (mapped) return Number.parseInt(mapped[1], 16) >>> 8 === 127;

  return false;
}
