import { db } from "@/lib/db";
import { tasks, columns } from "@/lib/db/schema";
import { eq, and, or, asc, desc, max, inArray, isNull, gte, lt } from "drizzle-orm";

export type CreateTaskInput = {
  title: string;
  description?: string;
  columnId: string;
  categoryId?: string;
  priority?: "urgent" | "high" | "normal";
  startDate?: string;
  plannedDate?: string;
};

export const ARCHIVE_AFTER_DAYS = 30;

/**
 * Граница архива: задачи, выполненные раньше неё, в обычные выдачи не попадают.
 * Экспортируется, чтобы поиск считал архив по тому же порогу, что и доска.
 */
export function archiveCutoff(): Date {
  const d = new Date();
  d.setDate(d.getDate() - ARCHIVE_AFTER_DAYS);
  return d;
}

export async function getTasks(
  environmentId: string,
  options?: { includeArchived?: boolean }
) {
  const envColumns = await db
    .select({ id: columns.id })
    .from(columns)
    .where(eq(columns.environmentId, environmentId));

  if (envColumns.length === 0) return [];
  const columnIds = envColumns.map((c) => c.id);

  const conditions = [inArray(tasks.columnId, columnIds)];
  if (!options?.includeArchived) {
    conditions.push(
      or(isNull(tasks.completedAt), gte(tasks.completedAt, archiveCutoff()))!
    );
  }

  return db
    .select()
    .from(tasks)
    .where(and(...conditions))
    .orderBy(asc(tasks.position));
}

export async function getArchivedTasks(environmentId: string) {
  const envColumns = await db
    .select({ id: columns.id })
    .from(columns)
    .where(eq(columns.environmentId, environmentId));

  if (envColumns.length === 0) return [];
  const columnIds = envColumns.map((c) => c.id);

  return db
    .select()
    .from(tasks)
    .where(
      and(
        inArray(tasks.columnId, columnIds),
        lt(tasks.completedAt, archiveCutoff())
      )
    )
    .orderBy(desc(tasks.completedAt));
}

export async function getTasksByColumn(columnId: string) {
  return db
    .select()
    .from(tasks)
    .where(eq(tasks.columnId, columnId))
    .orderBy(asc(tasks.position));
}

async function isLastColumn(columnId: string): Promise<boolean> {
  const [col] = await db
    .select({ position: columns.position, environmentId: columns.environmentId })
    .from(columns)
    .where(eq(columns.id, columnId));
  if (!col) return false;

  const [maxCol] = await db
    .select({ maxPos: max(columns.position) })
    .from(columns)
    .where(eq(columns.environmentId, col.environmentId));

  return maxCol?.maxPos != null && col.position === maxCol.maxPos;
}

/**
 * Колонки среды, которой принадлежит `columnId`, по возрастанию позиции.
 * Нужен там, где «последняя колонка» должна считаться внутри одной среды,
 * а не глобально по всем проектам.
 */
async function environmentColumns(columnId: string) {
  const [col] = await db
    .select({ environmentId: columns.environmentId })
    .from(columns)
    .where(eq(columns.id, columnId));
  if (!col) return [];

  return db
    .select({ id: columns.id })
    .from(columns)
    .where(eq(columns.environmentId, col.environmentId))
    .orderBy(asc(columns.position));
}

export async function createTask(input: CreateTaskInput) {
  const [maxPos] = await db
    .select({ max: max(tasks.position) })
    .from(tasks)
    .where(eq(tasks.columnId, input.columnId));

  const position = (maxPos?.max ?? -1) + 1;

  const completedAt = (await isLastColumn(input.columnId)) ? new Date() : null;

  const [task] = await db
    .insert(tasks)
    .values({
      title: input.title,
      description: input.description || null,
      columnId: input.columnId,
      categoryId: input.categoryId || null,
      priority: input.priority || "normal",
      position,
      startDate: input.startDate || new Date().toISOString().split("T")[0],
      plannedDate: input.plannedDate || null,
      completedAt,
    })
    .returning();

  return task;
}

export async function updateTask(
  id: string,
  data: Partial<{
    title: string;
    description: string | null;
    categoryId: string | null;
    priority: "urgent" | "high" | "normal";
    plannedDate: string | null;
  }>
) {
  const [task] = await db
    .update(tasks)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(tasks.id, id))
    .returning();
  return task;
}

export async function restoreTask(id: string) {
  const [current] = await db
    .select({ columnId: tasks.columnId })
    .from(tasks)
    .where(eq(tasks.id, id));

  const patch: {
    completedAt: null;
    updatedAt: Date;
    columnId?: string;
    position?: number;
  } = { completedAt: null, updatedAt: new Date() };

  if (current) {
    const envColumns = await environmentColumns(current.columnId);
    const last = envColumns[envColumns.length - 1];
    // Задача лежит в «Готово»: снять completedAt мало — на доске она останется
    // выполненной, потому что прогресс дорожки считается по последней колонке.
    if (envColumns.length > 1 && last?.id === current.columnId) {
      const target = envColumns[envColumns.length - 2];
      const [maxPos] = await db
        .select({ max: max(tasks.position) })
        .from(tasks)
        .where(eq(tasks.columnId, target.id));

      patch.columnId = target.id;
      // Позиция обязательна: доска сортирует по ней, а без пересчёта задача
      // столкнулась бы с уже занятым индексом в целевой колонке.
      patch.position = (maxPos?.max ?? -1) + 1;
    }
  }

  const [task] = await db
    .update(tasks)
    .set(patch)
    .where(eq(tasks.id, id))
    .returning();
  return task;
}

export async function deleteTask(id: string) {
  await db.delete(tasks).where(eq(tasks.id, id));
}

export async function moveTask(
  taskId: string,
  targetColumnId: string,
  targetPosition: number
) {
  // Capture source column before moving
  const [currentTask] = await db
    .select({ columnId: tasks.columnId })
    .from(tasks)
    .where(eq(tasks.id, taskId));
  const sourceColumnId = currentTask?.columnId;

  // Последняя колонка считается внутри среды: глобальный поиск по всем
  // проектам помечал бы выполненными задачи, попавшие в чужую колонку.
  const completedAt = (await isLastColumn(targetColumnId)) ? new Date() : null;

  await db
    .update(tasks)
    .set({
      columnId: targetColumnId,
      position: targetPosition,
      completedAt,
      updatedAt: new Date(),
    })
    .where(eq(tasks.id, taskId));

  // Пересчитать позиции всех задач в целевой колонке
  const allInTarget = await db
    .select()
    .from(tasks)
    .where(eq(tasks.columnId, targetColumnId))
    .orderBy(asc(tasks.position));

  await Promise.all(
    allInTarget.map((t, idx) =>
      db
        .update(tasks)
        .set({ position: idx })
        .where(eq(tasks.id, t.id))
    )
  );

  // Also renumber source column if different from target
  if (sourceColumnId && sourceColumnId !== targetColumnId) {
    const allInSource = await db
      .select()
      .from(tasks)
      .where(eq(tasks.columnId, sourceColumnId))
      .orderBy(asc(tasks.position));

    await Promise.all(
      allInSource.map((t, idx) =>
        db.update(tasks).set({ position: idx }).where(eq(tasks.id, t.id))
      )
    );
  }
}

export async function createTasksBatch(inputs: CreateTaskInput[]): Promise<typeof tasks.$inferSelect[]> {
  const results = [];
  for (const input of inputs) {
    const task = await createTask(input);
    results.push(task);
  }
  return results;
}

export async function getTasksForToday(environmentId: string) {
  const today = new Date().toISOString().split("T")[0];
  const envColumns = await db
    .select({ id: columns.id })
    .from(columns)
    .where(eq(columns.environmentId, environmentId));

  if (envColumns.length === 0) return [];
  const columnIds = envColumns.map((c) => c.id);

  return db
    .select()
    .from(tasks)
    .where(and(eq(tasks.plannedDate, today), inArray(tasks.columnId, columnIds)))
    .orderBy(asc(tasks.position));
}
