import { and, asc, desc, eq, gte, ilike, isNull, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { columns, environments, tasks } from "@/lib/db/schema";
import { archiveCutoff } from "@/lib/services/tasks";

/**
 * Поиск по доске.
 *
 * Весь контур управления задачами из бота держится на «найти → показать →
 * нажать кнопку», поэтому поиск идёт по всем средам сразу: брифинг тоже
 * показывает все проекты, и вести себя иначе поиск не должен.
 *
 * Ищем по подстроке, без морфологии: короткие жаргонные слова («вэду», «итмо»)
 * стеммингом только портятся.
 */

/** Сколько результатов на странице по умолчанию. */
export const SEARCH_PAGE_SIZE = 20;
/** Потолок страницы: запрос из бота не должен вытянуть всю доску. */
export const SEARCH_MAX_LIMIT = 50;

export type SearchOptions = {
  /** Больше SEARCH_MAX_LIMIT срезается, меньше 1 — считается незаданным. */
  limit?: number;
  offset?: number;
  /** true — искать и по архиву (задачи, выполненные больше 30 дней назад). */
  includeArchived?: boolean;
};

export type TaskSearchHit = {
  task: typeof tasks.$inferSelect;
  column: { id: string; title: string };
  environment: { id: string; name: string; color: string };
};

/** Заметки появятся вместе с таблицей notes (S-01), сейчас поиск по ним пуст. */
export type NoteSearchHit = never;

export type SearchAllResult = {
  tasks: TaskSearchHit[];
  notes: NoteSearchHit[];
};

/**
 * Экранирует метасимволы LIKE. Без этого запрос «100%» превращается в шаблон
 * и находит вообще всё, а «прогноз_1» молча совпадает с «прогноз-1».
 */
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/**
 * Размер страницы. Лимит меньше единицы — не «страница на ноль результатов», а
 * отсутствие осмысленного значения: пустая выдача в боте неотличима от «ничего
 * не найдено», то есть ноль молча прятал бы находки. Поэтому `limit: 0`,
 * отрицательные и мусор вроде NaN одинаково означают «лимит не задан».
 */
function clampLimit(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return SEARCH_PAGE_SIZE;
  const limit = Math.trunc(value);
  if (limit < 1) return SEARCH_PAGE_SIZE;
  return Math.min(limit, SEARCH_MAX_LIMIT);
}

/** Смещение: неотрицательное целое, потолок — лишь бы не вылететь за bigint. */
function clampOffset(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 0;
  return Math.min(Math.max(Math.trunc(value), 0), Number.MAX_SAFE_INTEGER);
}

export async function searchTasks(
  query: string,
  options: SearchOptions = {}
): Promise<TaskSearchHit[]> {
  const trimmed = query.trim();
  // Пустой запрос дал бы шаблон '%%' — то есть выдачу всей доски.
  if (!trimmed) return [];

  const pattern = `%${escapeLikePattern(trimmed)}%`;
  const conditions = [
    or(ilike(tasks.title, pattern), ilike(tasks.description, pattern))!,
  ];
  if (!options.includeArchived) {
    conditions.push(
      or(isNull(tasks.completedAt), gte(tasks.completedAt, archiveCutoff()))!
    );
  }

  return db
    .select({
      task: tasks,
      column: { id: columns.id, title: columns.title },
      environment: {
        id: environments.id,
        name: environments.name,
        color: environments.color,
      },
    })
    .from(tasks)
    .innerJoin(columns, eq(tasks.columnId, columns.id))
    .innerJoin(environments, eq(columns.environmentId, environments.id))
    .where(and(...conditions))
    // Свежее выше; id — устойчивый разрыв ничьей, иначе страницы разъедутся.
    .orderBy(desc(tasks.updatedAt), asc(tasks.id))
    .limit(clampLimit(options.limit))
    .offset(clampOffset(options.offset));
}

/**
 * Заглушка до появления таблицы notes (S-01 в спеке): searchAll уже сейчас
 * отдаёт итоговую форму ответа, а заметок пока не существует. Аргументов нет
 * намеренно — принимать запрос и делать вид, что ищешь, было бы враньём.
 * Вместе с таблицей функция получит ту же сигнатуру, что и searchTasks.
 */
export async function searchNotes(): Promise<NoteSearchHit[]> {
  return [];
}

/** Общая точка входа для бота: задачи и заметки отдаются раздельно. */
export async function searchAll(
  query: string,
  options: SearchOptions = {}
): Promise<SearchAllResult> {
  const [foundTasks, foundNotes] = await Promise.all([
    searchTasks(query, options),
    searchNotes(),
  ]);
  return { tasks: foundTasks, notes: foundNotes };
}
