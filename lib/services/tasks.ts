import { db } from "@/lib/db";
import { tasks, columns } from "@/lib/db/schema";
import { eq, and, asc, desc, max } from "drizzle-orm";

export type CreateTaskInput = {
  title: string;
  description?: string;
  columnId: string;
  categoryId?: string;
  priority?: "urgent" | "high" | "normal";
  startDate?: string;
  plannedDate?: string;
};

export async function getTasks() {
  return db.select().from(tasks).orderBy(asc(tasks.position));
}

export async function getTasksByColumn(columnId: string) {
  return db
    .select()
    .from(tasks)
    .where(eq(tasks.columnId, columnId))
    .orderBy(asc(tasks.position));
}

export async function createTask(input: CreateTaskInput) {
  const [maxPos] = await db
    .select({ max: max(tasks.position) })
    .from(tasks)
    .where(eq(tasks.columnId, input.columnId));

  const position = (maxPos?.max ?? -1) + 1;

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

  // Определить, является ли целевая колонка последней
  const allColumns = await db
    .select()
    .from(columns)
    .orderBy(desc(columns.position));
  const lastColumnId = allColumns[0]?.id;
  const isLastColumn = targetColumnId === lastColumnId;

  // Обновить саму задачу
  const completedAt = isLastColumn ? new Date() : null;

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

export async function getTasksForToday() {
  const today = new Date().toISOString().split("T")[0];
  return db
    .select()
    .from(tasks)
    .where(eq(tasks.plannedDate, today))
    .orderBy(asc(tasks.position));
}
