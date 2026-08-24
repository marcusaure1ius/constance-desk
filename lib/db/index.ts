import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
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
type Database = ReturnType<typeof connect>;

function connect() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL не задан — подключение к базе создать не из чего. " +
        "Переменная нужна только на запросе к базе, импорт lib/db её не требует."
    );
  }
  return drizzle(neon(url), { schema });
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
