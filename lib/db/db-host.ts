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
 *
 * Ещё один дорогой край стоил дыры: барьер читал хост только из authority,
 * а драйвер сильнее authority считает параметры запроса. Строка
 * `postgresql://postgres:postgres@localhost:9999/db?host=…&port=…` печатала
 * «База: localhost», проходила барьер и работала с базой по другому адресу —
 * при том что на порту 9999 не слушал никто. Поэтому разбор ниже повторяет
 * драйвер, а не здравый смысл: барьер обязан судить ровно о той машине, к
 * которой пойдёт соединение.
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

/** Куда пойдёт соединение. Порт — строкой, как его отдаёт драйвер. */
export type DatabaseTarget = { host: string; port: string };

/**
 * Хост и порт строки подключения так, как их понимает драйвер.
 *
 * Разбор повторяет `pg-connection-string` (его зовёт `pg`, а через `pg` ходит
 * и drizzle-kit) вместе с его краями — сверено с
 * `node_modules/pg-connection-string/index.js`:
 *
 * - строка, начинающаяся со слэша, — вообще не URL, а «путь-к-сокету [база]»;
 * - параметры `host` и `port` сильнее authority, но только непустые:
 *   `?host=` откатывает драйвер обратно на authority;
 * - при повторе параметра побеждает последний: драйвер складывает пары в
 *   объект, а не берёт первую через `searchParams.get()`;
 * - имена параметров регистрозависимы — `?HOST=` драйвер не читает
 *   (а вот значение хоста регистронезависимо, см. `normalizeHost`);
 * - строку с пробелом или битым %-экранированием драйвер сначала прогоняет
 *   через `encodeURI`, поэтому `? host=` — это параметр « host», а не «host»;
 * - `postgresql://u:p@/db` WHATWG-парсер не принимает: драйвер подставляет
 *   фиктивный хост и считает хост пустым, то есть сокетом;
 * - хост из authority %-декодируется, поэтому `%2Fvar%2Frun%2Fpostgresql` —
 *   это путь к сокету, а не имя машины.
 *
 * Строка подключения в сообщения об ошибках не попадает — в ней пароль.
 */
export function databaseTarget(url: string): DatabaseTarget {
  // Не URL, а путь к unix-сокету: `/var/run/postgresql constance`.
  if (url.startsWith("/")) return { host: url.split(" ")[0], port: "" };

  const { parsed, dummyHost } = parseConnectionUrl(url);

  // Последнее вхождение параметра, включая пустое: `?host=evil&host=` драйвер
  // прочитает как «параметра нет» и вернётся к authority.
  let queryHost = "";
  let queryPort = "";
  for (const [key, value] of parsed.searchParams) {
    if (key === "host") queryHost = value;
    else if (key === "port") queryPort = value;
  }

  // Схема `socket:`: хост — это путь, и `?host=` драйвер здесь затирает.
  if (parsed.protocol === "socket:") {
    return { host: decodeOrFail(parsed.pathname, decodeURI), port: queryPort };
  }

  const port = queryPort || parsed.port;

  // Authority разбирается только когда он вообще нужен: при живом `?host=`
  // драйвер до него не доходит, а значит и не падает на битом %-экранировании.
  if (queryHost) return { host: queryHost, port };

  const host = dummyHost ? "" : decodeOrFail(parsed.hostname, decodeURIComponent);
  return { host, port };
}

/**
 * Хост из строки подключения в каноническом виде: нижний регистр, без скобок
 * вокруг IPv6.
 */
export function databaseHost(url: string): string {
  return normalizeHost(databaseTarget(url).host);
}

/** Хост с портом — для человека: «localhost:55473». */
export function databaseEndpoint(url: string): string {
  const { host, port } = databaseTarget(url);
  const shown = normalizeHost(host);
  return port ? `${shown}:${port}` : shown;
}

/**
 * Локальный ли хост. Аргумент — уже хост, а не URL: вызывающий обычно
 * печатает хост в сообщении и не должен разбирать URL дважды.
 */
export function isLocalDatabaseHost(host: string): boolean {
  // Unix-сокет в обеих формах: пустой хост (драйвер подставит сокет по
  // умолчанию) и явный путь `?host=/var/run/postgresql` — так же, как решает
  // сам `pg`: `if (this.host && this.host.indexOf('/') === 0)`.
  if (host === "" || isSocketPath(host)) return true;

  const h = normalizeHost(host);

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

/** Фиктивный хост из `pg-connection-string` — им драйвер чинит `@/`. */
const DUMMY_HOST = "___DUMMY___";

/**
 * Разбор строки подключения теми же двумя попытками, что и у драйвера.
 *
 * `dummyHost` означает «authority пуст»: WHATWG-парсер не принимает
 * `postgresql://u:p@/db`, и драйвер подставляет фиктивный хост, чтобы достать
 * из строки всё остальное.
 *
 * Своя ошибка вместо драйверной намеренно: сюда приходит `DATABASE_URL` с
 * паролем, и он не должен утечь в лог через текст исключения.
 */
function parseConnectionUrl(url: string): { parsed: URL; dummyHost: boolean } {
  // Тот же препроцессинг, что и в драйвере: пробелы и битые %-экранирования.
  const str = / |%[^a-f0-9]|%[a-f0-9][^a-f0-9]/i.test(url)
    ? encodeURI(url).replace(/%25(\d\d)/g, "%$1")
    : url;

  // Базового URL, в отличие от драйвера, здесь нет намеренно: драйвер
  // разбирает строку относительно `postgres://base`, и строка-мусор молча
  // превращается в хост «base». Барьеру так нельзя — непонятую строку он
  // обязан отвергнуть, а не выдумать ей адрес.
  try {
    return { parsed: new URL(str), dummyHost: false };
  } catch {
    // Вторая попытка — драйверная.
    try {
      return { parsed: new URL(str.replace("@/", `@${DUMMY_HOST}/`)), dummyHost: true };
    } catch {
      throw parseFailed();
    }
  }
}

function decodeOrFail(value: string, decode: (v: string) => string): string {
  try {
    return decode(value);
  } catch {
    // На битом %-экранировании в хосте падает и сам драйвер — соединения не
    // будет в любом случае, так что барьеру честнее закрыться.
    throw parseFailed();
  }
}

function parseFailed(): Error {
  return new Error(
    "Строка подключения к базе не разбирается как URL — проверьте DATABASE_URL."
  );
}

/** Путь к unix-сокету, а не имя машины. */
function isSocketPath(host: string): boolean {
  return host.startsWith("/");
}

/**
 * Имя машины регистронезависимо, путь к сокету — нет.
 *
 * Регистр приводится вручную намеренно: схема `postgresql:` для WHATWG-парсера
 * не «специальная», поэтому `new URL()` оставляет хост как есть —
 * `postgresql://u:p@LOCALHOST/db` даёт `"LOCALHOST"`, тогда как
 * `https://LOCALHOST` дал бы `"localhost"`.
 */
function normalizeHost(host: string): string {
  return isSocketPath(host) ? host : stripBrackets(host).toLowerCase();
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
