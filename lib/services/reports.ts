import { db } from "@/lib/db";
import { tasks, categories } from "@/lib/db/schema";
import { and, gte, lt, eq, asc } from "drizzle-orm";
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

export async function getWeeklyReport(date: Date): Promise<WeeklyReport> {
  const { start, end } = getWeekRange(date);

  const completed = await db
    .select({
      id: tasks.id,
      title: tasks.title,
      description: tasks.description,
      completedAt: tasks.completedAt,
      categoryName: categories.name,
    })
    .from(tasks)
    .leftJoin(categories, eq(tasks.categoryId, categories.id))
    .where(and(gte(tasks.completedAt, start), lt(tasks.completedAt, end)))
    .orderBy(asc(tasks.completedAt));

  const startedRows = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(
      and(
        gte(tasks.startDate, start.toISOString().split("T")[0]),
        lt(tasks.startDate, end.toISOString().split("T")[0])
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
