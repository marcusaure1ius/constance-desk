import { db } from "@/lib/db";
import { tasks, columns } from "@/lib/db/schema";
import { eq, and, inArray, isNull, gte, lt, asc } from "drizzle-orm";

export type TodayBriefingTask = typeof tasks.$inferSelect & {
  columnTitle?: string;
};

export type TodayBriefing = {
  date: string;
  inProgress: TodayBriefingTask[];
  planned: TodayBriefingTask[];
  completed: TodayBriefingTask[];
  suggestions: TodayBriefingTask[];
  progress: { done: number; total: number };
};

export async function getTodayBriefing(
  environmentId: string
): Promise<TodayBriefing | null> {
  const today = new Date().toISOString().split("T")[0];
  const todayStart = new Date(`${today}T00:00:00`);
  const tomorrowStart = new Date(todayStart);
  tomorrowStart.setDate(tomorrowStart.getDate() + 1);

  const envColumns = await db
    .select()
    .from(columns)
    .where(eq(columns.environmentId, environmentId))
    .orderBy(asc(columns.position));

  if (envColumns.length === 0) return null;

  const firstColumn = envColumns[0];
  const lastColumn = envColumns[envColumns.length - 1];
  const middleColumns = envColumns.slice(1, -1);
  const middleColumnIds = middleColumns.map((c) => c.id);

  const [inProgressRaw, planned, completed, suggestions] = await Promise.all([
    middleColumnIds.length > 0
      ? db
          .select()
          .from(tasks)
          .where(inArray(tasks.columnId, middleColumnIds))
          .orderBy(asc(tasks.priority), asc(tasks.position))
      : Promise.resolve([]),
    db
      .select()
      .from(tasks)
      .where(
        and(eq(tasks.columnId, firstColumn.id), eq(tasks.plannedDate, today))
      )
      .orderBy(asc(tasks.priority), asc(tasks.position)),
    db
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.columnId, lastColumn.id),
          gte(tasks.completedAt, todayStart),
          lt(tasks.completedAt, tomorrowStart)
        )
      )
      .orderBy(asc(tasks.priority)),
    db
      .select()
      .from(tasks)
      .where(
        and(eq(tasks.columnId, firstColumn.id), isNull(tasks.plannedDate))
      )
      .orderBy(asc(tasks.priority), asc(tasks.position))
      .limit(5),
  ]);

  const columnMap = Object.fromEntries(
    envColumns.map((c) => [c.id, c.title])
  );
  const inProgress = inProgressRaw.map((t) => ({
    ...t,
    columnTitle: columnMap[t.columnId] ?? "",
  }));

  const done = completed.length;
  const total = inProgress.length + planned.length + completed.length;

  return {
    date: today,
    inProgress,
    planned,
    completed,
    suggestions,
    progress: { done, total },
  };
}
