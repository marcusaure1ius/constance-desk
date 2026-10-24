import { db } from "@/lib/db";
import { subtasks } from "@/lib/db/schema";
import { eq, asc, max, inArray } from "drizzle-orm";

export type CreateSubtaskInput = {
  taskId: string;
  title: string;
  dueDate?: string | null;
};

/** Подзадачи нескольких задач разом — доска грузит их одним запросом. */
export async function getSubtasksForTasks(taskIds: string[]) {
  if (taskIds.length === 0) return [];
  return db
    .select()
    .from(subtasks)
    .where(inArray(subtasks.taskId, taskIds))
    .orderBy(asc(subtasks.position));
}

export async function createSubtask(input: CreateSubtaskInput) {
  const title = input.title.trim();
  if (!title) throw new Error("Название подзадачи не может быть пустым");

  const [maxPos] = await db
    .select({ max: max(subtasks.position) })
    .from(subtasks)
    .where(eq(subtasks.taskId, input.taskId));

  const [subtask] = await db
    .insert(subtasks)
    .values({
      taskId: input.taskId,
      title,
      position: (maxPos?.max ?? -1) + 1,
      startDate: new Date().toISOString().split("T")[0],
      dueDate: input.dueDate || null,
    })
    .returning();
  return subtask;
}

export async function updateSubtask(
  id: string,
  data: Partial<{ title: string; dueDate: string | null; done: boolean }>
) {
  const { done, ...rest } = data;
  const patch: Partial<typeof subtasks.$inferInsert> = { ...rest, updatedAt: new Date() };
  if (rest.title !== undefined) {
    patch.title = rest.title.trim();
    if (!patch.title) throw new Error("Название подзадачи не может быть пустым");
  }
  if (done !== undefined) patch.completedAt = done ? new Date() : null;

  const [subtask] = await db
    .update(subtasks)
    .set(patch)
    .where(eq(subtasks.id, id))
    .returning();
  return subtask;
}

export async function deleteSubtask(id: string) {
  await db.delete(subtasks).where(eq(subtasks.id, id));
}
