import { and, eq, gte, isNull, lt, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { categories, columns, tasks } from "@/lib/db/schema";
import { addDaysIso, utcMidnight } from "@/lib/slides-report/dates";
import { getReportWeek } from "@/lib/slides-report/week";
import type { DraftEpic, DraftTask, ReportWeek, SlidesDraft } from "@/lib/slides-report/types";

export type DraftTaskRow = {
  id: string;
  title: string;
  plannedDate: string | null;
  completedAt: Date | null;
  categoryId: string;
  categoryName: string;
};

/**
 * Черновик слайда: эпики активной среды и задачи, из которых модалка даст
 * выбрать.
 *
 * Берутся задачи с категорией — открытые и закрытые на неделе отчёта.
 * Закрытые раньше к неделе не относятся, а задачи без категории не лягут ни
 * в одну строку таблицы: строки строятся по эпикам.
 *
 * Окно недели — в UTC, как и в остальном отчёте: сдвиг в 3 часа на границе
 * недели принят сознательно.
 */
export async function getSlidesDraft(environmentId: string, today: string): Promise<SlidesDraft> {
  const week = getReportWeek(today);
  const from = utcMidnight(week.monday);
  const to = utcMidnight(addDaysIso(week.monday, 7));

  const rows = await db
    .select({
      id: tasks.id,
      title: tasks.title,
      plannedDate: tasks.plannedDate,
      completedAt: tasks.completedAt,
      categoryId: categories.id,
      categoryName: categories.name,
    })
    .from(tasks)
    .innerJoin(columns, eq(tasks.columnId, columns.id))
    .innerJoin(categories, eq(tasks.categoryId, categories.id))
    .where(
      and(
        eq(columns.environmentId, environmentId),
        or(isNull(tasks.completedAt), and(gte(tasks.completedAt, from), lt(tasks.completedAt, to)))
      )
    );

  return { week, today, epics: groupDraftEpics(rows, week) };
}

/**
 * Строки запроса → эпики. Задача, закрытая вне недели, отбрасывается и здесь:
 * функция не полагается на то, что WHERE уже отфильтровал.
 */
export function groupDraftEpics(rows: DraftTaskRow[], week: ReportWeek): DraftEpic[] {
  const from = utcMidnight(week.monday).getTime();
  const to = utcMidnight(addDaysIso(week.monday, 7)).getTime();
  const byCategory = new Map<string, DraftEpic>();

  for (const row of rows) {
    const doneAt = row.completedAt?.getTime() ?? null;
    const doneThisWeek = doneAt !== null && doneAt >= from && doneAt < to;
    if (doneAt !== null && !doneThisWeek) continue;

    let epic = byCategory.get(row.categoryId);
    if (!epic) {
      epic = { categoryId: row.categoryId, name: row.categoryName, tasks: [] };
      byCategory.set(row.categoryId, epic);
    }
    epic.tasks.push({
      id: row.id,
      title: row.title,
      plannedDate: row.plannedDate,
      completedAt: row.completedAt?.toISOString() ?? null,
      doneThisWeek,
    });
  }

  const epics = [...byCategory.values()];
  for (const epic of epics) epic.tasks.sort(compareDraftTasks);
  return epics.sort((a, b) => a.name.localeCompare(b.name, "ru"));
}

/** Сначала закрытые на неделе (по времени закрытия), потом открытые по сроку; без срока — в конце. */
function compareDraftTasks(a: DraftTask, b: DraftTask): number {
  if (a.doneThisWeek !== b.doneThisWeek) return a.doneThisWeek ? -1 : 1;
  if (a.doneThisWeek) {
    return (a.completedAt ?? "").localeCompare(b.completedAt ?? "") || a.title.localeCompare(b.title, "ru");
  }
  if (a.plannedDate !== b.plannedDate) {
    if (a.plannedDate === null) return 1;
    if (b.plannedDate === null) return -1;
    return a.plannedDate.localeCompare(b.plannedDate);
  }
  return a.title.localeCompare(b.title, "ru");
}
