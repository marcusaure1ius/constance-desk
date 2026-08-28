import { neon } from "@neondatabase/serverless";
import { drizzle as drizzleNeon, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { isLocalDatabaseUrl } from "./db-host";
import * as schema from "./schema";

/**
 * Подключение к базе создаётся при первом запросе, а не при импорте модуля.
 *
 * Раньше здесь был вызов `neon(process.env.DATABASE_URL!)` на верхнем уровне:
 * любой файл, дотянувшийся импортом до `lib/db` (а это почти всё — сервисы,
 * действия, реестр инструментов), требовал переменную окружения просто чтобы
 * загрузиться. Из-за этого падал офлайн-прогон тестов в CI и скрипт установки
 * вебхука (T-0004). Ленивое подключение убирает причину, а не симптом:
 * импортировать модуль теперь можно где угодно, переменная нужна только тому,
 * кто действительно идёт в базу.
 */
/**
 * Тип берётся от neon-http — драйвера боевой среды. Локальное подключение
 * приводится к нему приведением: у драйверов различаются края (транзакции,
 * `$client`), а тот набор запросов, которым пользуются сервисы, у них общий.
 * Объединение двух типов вместо этого сломало бы вызовы во всех сервисах
 * сразу, ничего не дав взамен.
 */
type Database = NeonHttpDatabase<typeof schema>;

/**
 * Драйвер выбирается по хосту.
 *
 * neon-http ходит не в Postgres, а в HTTP-эндпоинт Neon, поэтому с обычной
 * локальной базой он не разговаривает вообще. Без этой развилки локальной
 * разработки не существует: `npm run dev` идёт только в боевую базу, и любую
 * новую таблицу приходится сначала создавать в проде.
 *
 * Локальность считается общей функцией — той же, что стережёт миграции.
 */
function connect(): Database {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL не задан — подключение к базе создать не из чего. " +
        "Переменная нужна только на запросе к базе, импорт lib/db её не требует."
    );
  }

  if (isLocalDatabaseUrl(url)) {
    return drizzlePg(new Pool({ connectionString: url }), {
      schema,
    }) as unknown as Database;
  }

  return drizzleNeon(neon(url), { schema });
}

let connection: Database | null = null;

function getConnection(): Database {
  connection ??= connect();
  return connection;
}

/**
 * Тот же интерфейс, что и раньше (`import { db } from "@/lib/db"`), но за ним
 * стоит прокси: подключение поднимается на первом обращении к любому свойству.
 * Методы drizzle привязываются к настоящему объекту — иначе внутри метода
 * `this` оказался бы прокси.
 */
export const db: Database = new Proxy({} as Database, {
  get(_target, prop) {
    const target = getConnection();
    const value = Reflect.get(target, prop, target);
    return typeof value === "function" ? value.bind(target) : value;
  },
  set(_target, prop, value) {
    return Reflect.set(getConnection(), prop, value);
  },
  has(_target, prop) {
    return Reflect.has(getConnection(), prop);
  },
});
