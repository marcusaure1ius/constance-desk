import { db } from "@/lib/db";
import { tasks, categories, columns } from "@/lib/db/schema";
import { and, gte, lt, eq, asc, inArray, or, isNull } from "drizzle-orm";
import { getWeekRange } from "@/lib/utils";

export type ReportTask = {
  id: string;
  title: string;
  description: string | null;
  categoryName: string | null;
  completedAt: Date;
};

export type WeeklyReport = {
  weekStart: Date;
  weekEnd: Date;
  completedTasks: ReportTask[];
  completedCount: number;
  startedCount: number;
};

export async function getWeeklyReport(date: Date, environmentId: string): Promise<WeeklyReport> {
  const { start, end } = getWeekRange(date);

  const envColumns = await db
    .select({ id: columns.id })
    .from(columns)
    .where(eq(columns.environmentId, environmentId));
  const columnIds = envColumns.map((c) => c.id);

  const completed = columnIds.length === 0 ? [] : await db
    .select({
      id: tasks.id,
      title: tasks.title,
      description: tasks.description,
      completedAt: tasks.completedAt,
      categoryName: categories.name,
    })
    .from(tasks)
    .leftJoin(categories, eq(tasks.categoryId, categories.id))
    .where(and(
      gte(tasks.completedAt, start),
      lt(tasks.completedAt, end),
      inArray(tasks.columnId, columnIds),
    ))
    .orderBy(asc(tasks.completedAt));

  const startedRows = columnIds.length === 0 ? [] : await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(
      and(
        gte(tasks.startDate, start.toISOString().split("T")[0]),
        lt(tasks.startDate, end.toISOString().split("T")[0]),
        inArray(tasks.columnId, columnIds),
      )
    );

  return {
    weekStart: start,
    weekEnd: end,
    completedTasks: completed.map((t) => ({
      ...t,
      completedAt: t.completedAt!,
    })),
    completedCount: completed.length,
    startedCount: startedRows.length,
  };
}

export type ExtendedReportTask = {
  id: string;
  title: string;
  description: string | null;
  categoryName: string | null;
  startDate: string;
  completedAt: Date | null;
};

export type ExtendedWeeklyReport = {
  weekStart: Date;
  weekEnd: Date;
  completedTasks: ExtendedReportTask[];
  carryoverTasks: ExtendedReportTask[];
  newTasks: ExtendedReportTask[];
};

export async function getExtendedWeeklyReport(
  date: Date,
  environmentId: string,
): Promise<ExtendedWeeklyReport> {
  const { start, end } = getWeekRange(date);
  const startDateStr = start.toISOString().split("T")[0];
  const endDateStr = end.toISOString().split("T")[0];

  const envColumns = await db
    .select({ id: columns.id })
    .from(columns)
    .where(eq(columns.environmentId, environmentId));
  const columnIds = envColumns.map((c) => c.id);

  if (columnIds.length === 0) {
    return {
      weekStart: start,
      weekEnd: end,
      completedTasks: [],
      carryoverTasks: [],
      newTasks: [],
    };
  }

  const selectFields = {
    id: tasks.id,
    title: tasks.title,
    description: tasks.description,
    startDate: tasks.startDate,
    completedAt: tasks.completedAt,
    categoryName: categories.name,
  };

  // completedTasks: completedAt в пределах недели
  const completedTasks = await db
    .select(selectFields)
    .from(tasks)
    .leftJoin(categories, eq(tasks.categoryId, categories.id))
    .where(and(
      gte(tasks.completedAt, start),
      lt(tasks.completedAt, end),
      inArray(tasks.columnId, columnIds),
    ))
    .orderBy(asc(tasks.completedAt));

  // carryoverTasks: startDate до начала недели И (не завершена ИЛИ завершена на этой неделе)
  const carryoverTasks = await db
    .select(selectFields)
    .from(tasks)
    .leftJoin(categories, eq(tasks.categoryId, categories.id))
    .where(and(
      lt(tasks.startDate, startDateStr),
      inArray(tasks.columnId, columnIds),
      or(
        isNull(tasks.completedAt),
        and(gte(tasks.completedAt, start), lt(tasks.completedAt, end)),
      ),
    ))
    .orderBy(asc(tasks.startDate));

  // newTasks: startDate в пределах недели
  const newTasks = await db
    .select(selectFields)
    .from(tasks)
    .leftJoin(categories, eq(tasks.categoryId, categories.id))
    .where(and(
      gte(tasks.startDate, startDateStr),
      lt(tasks.startDate, endDateStr),
      inArray(tasks.columnId, columnIds),
    ))
    .orderBy(asc(tasks.startDate));

  return {
    weekStart: start,
    weekEnd: end,
    completedTasks,
    carryoverTasks,
    newTasks,
  };
}

export function formatReportAsText(report: WeeklyReport): string {
  const { weekStart, weekEnd, completedTasks, completedCount, startedCount } = report;
  const startStr = weekStart.toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
  });
  const endStr = weekEnd.toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });

  let text = `Отчёт за неделю: ${startStr} — ${endStr}\n`;
  text += `Выполнено: ${completedCount} из ${startedCount} задач\n\n`;

  for (const task of completedTasks) {
    const cat = task.categoryName ? ` (${task.categoryName})` : "";
    const date = task.completedAt.toLocaleDateString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
    text += `✓ ${task.title}${cat} — ${date}\n`;
    if (task.description) {
      text += `  ${task.description}\n`;
    }
  }

  return text.trim();
}
