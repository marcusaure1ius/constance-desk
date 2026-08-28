import { and, asc, desc, eq, gte, ilike, inArray, isNull, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { columns, environments, noteFolders, notes, tasks } from "@/lib/db/schema";
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

export type NoteSearchHit = {
  note: {
    id: string;
    title: string;
    folderId: string | null;
    environmentId: string;
    updatedAt: Date;
  };
  /** Путь от корня среды: «Цены/Аномалии/Выбросы в ККУ». */
  path: string;
  environment: { id: string; name: string; color: string };
};

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
 * Поиск по заметкам: заголовок и текст, по всем средам — как и поиск по
 * задачам.
 *
 * Путь собирается вторым запросом, а не рекурсивным CTE в первом: папок в
 * среде десятки, они целиком помещаются в память, а сырой SQL стоил бы
 * привязки к драйверу ради одного лишнего запроса. Архива у заметок нет —
 * `includeArchived` к ним неприменим, поэтому опция здесь не читается.
 */
export async function searchNotes(
  query: string,
  options: SearchOptions = {}
): Promise<NoteSearchHit[]> {
  const trimmed = query.trim();
  // Пустой запрос дал бы шаблон '%%' — то есть выдачу всех заметок.
  if (!trimmed) return [];

  const pattern = `%${escapeLikePattern(trimmed)}%`;

  const found = await db
    .select({
      note: {
        id: notes.id,
        title: notes.title,
        folderId: notes.folderId,
        environmentId: notes.environmentId,
        updatedAt: notes.updatedAt,
      },
      environment: {
        id: environments.id,
        name: environments.name,
        color: environments.color,
      },
    })
    .from(notes)
    .innerJoin(environments, eq(notes.environmentId, environments.id))
    .where(or(ilike(notes.title, pattern), ilike(notes.text, pattern)))
    // Свежее выше; id — устойчивый разрыв ничьей, иначе страницы разъедутся.
    .orderBy(desc(notes.updatedAt), asc(notes.id))
    .limit(clampLimit(options.limit))
    .offset(clampOffset(options.offset));

  if (found.length === 0) return [];

  // Все находки в корне — за путями идти незачем.
  if (found.every((hit) => hit.note.folderId === null)) {
    return found.map((hit) => ({ ...hit, path: hit.note.title }));
  }

  const envIds = [...new Set(found.map((hit) => hit.note.environmentId))];
  const folders = await db
    .select({
      id: noteFolders.id,
      name: noteFolders.name,
      parentId: noteFolders.parentId,
    })
    .from(noteFolders)
    .where(inArray(noteFolders.environmentId, envIds));

  const byId = new Map(folders.map((folder) => [folder.id, folder]));

  const pathOf = (folderId: string | null, title: string): string => {
    const segments: string[] = [];
    // Посещённые идентификаторы, а не имена: кольцо в данных надо ловить по
    // папке, а тёзки в разных ветках — обычное дело и подъём не зацикливают.
    const seen = new Set<string>();
    let current = folderId;
    while (current && !seen.has(current)) {
      seen.add(current);
      const folder = byId.get(current);
      if (!folder) break;
      segments.unshift(folder.name);
      current = folder.parentId;
    }
    return [...segments, title].join("/");
  };

  return found.map((hit) => ({
    ...hit,
    path: pathOf(hit.note.folderId, hit.note.title),
  }));
}

/** Общая точка входа для бота: задачи и заметки отдаются раздельно. */
export async function searchAll(
  query: string,
  options: SearchOptions = {}
): Promise<SearchAllResult> {
  const [foundTasks, foundNotes] = await Promise.all([
    searchTasks(query, options),
    searchNotes(query, options),
  ]);
  return { tasks: foundTasks, notes: foundNotes };
}
