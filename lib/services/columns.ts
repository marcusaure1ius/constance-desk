import { db } from "@/lib/db";
import { columns, tasks } from "@/lib/db/schema";
import { eq, asc, count } from "drizzle-orm";

export async function getColumns(environmentId: string) {
  return db
    .select()
    .from(columns)
    .where(eq(columns.environmentId, environmentId))
    .orderBy(asc(columns.position));
}

export async function createColumn(title: string, environmentId: string) {
  const existing = await getColumns(environmentId);
  const maxPosition = existing.length > 0
    ? Math.max(...existing.map((c) => c.position))
    : -1;

  const [col] = await db
    .insert(columns)
    .values({ title, position: maxPosition + 1, environmentId })
    .returning();
  return col;
}

export async function updateColumn(id: string, title: string) {
  const [col] = await db
    .update(columns)
    .set({ title, updatedAt: new Date() })
    .where(eq(columns.id, id))
    .returning();
  return col;
}

export async function deleteColumn(id: string): Promise<{ error?: string }> {
  const taskCount = await db
    .select({ count: count() })
    .from(tasks)
    .where(eq(tasks.columnId, id));

  if (taskCount[0].count > 0) {
    return { error: "Нельзя удалить колонку с задачами. Сначала перенесите задачи." };
  }

  await db.delete(columns).where(eq(columns.id, id));
  return {};
}

export async function reorderColumns(orderedIds: string[]) {
  await Promise.all(
    orderedIds.map((id, index) =>
      db
        .update(columns)
        .set({ position: index, updatedAt: new Date() })
        .where(eq(columns.id, id))
    )
  );
}
