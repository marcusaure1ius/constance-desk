import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { eq } from "drizzle-orm";

/*
 * Подзадачи на настоящей PostgreSQL: каскадное удаление вместе с задачей
 * выполняет база, на моках drizzle его не проверить.
 *
 * Запуск: TEST_DATABASE_URL=postgresql://... npm run test:integration:db
 */

vi.mock("@/lib/db", async () => {
  const { createTestDb } = await import("./helpers/test-db");
  return { db: createTestDb() };
});

import {
  createSubtask,
  deleteSubtask,
  getSubtasksForTasks,
  updateSubtask,
} from "@/lib/services/subtasks";
import { deleteTask } from "@/lib/services/tasks";
import { columns, environments, tasks } from "@/lib/db/schema";
import { closeTestDb, createTestDb } from "./helpers/test-db";

let environmentId: string;
let taskId: string;

describe("подзадачи на настоящей базе", () => {
  beforeAll(async () => {
    const db = createTestDb();
    const [env] = await db
      .insert(environments)
      .values({ name: "Подзадачи среда", color: "#3b82f6", position: 920 })
      .returning();
    environmentId = env.id;
    const [col] = await db
      .insert(columns)
      .values({ title: "В работе", position: 0, environmentId })
      .returning();
    const [task] = await db
      .insert(tasks)
      .values({ title: "Родитель", columnId: col.id, position: 0, startDate: "2026-10-24" })
      .returning();
    taskId = task.id;
  });

  afterAll(async () => {
    await createTestDb().delete(environments).where(eq(environments.id, environmentId));
    await closeTestDb();
  });

  it("создаёт по порядку, отмечает и удаляет", async () => {
    const a = await createSubtask({ taskId, title: "Первая", dueDate: "2026-10-30" });
    const b = await createSubtask({ taskId, title: "Вторая" });
    expect([a.position, b.position]).toEqual([0, 1]);
    expect(a.dueDate).toBe("2026-10-30");
    expect(b.dueDate).toBeNull();

    const done = await updateSubtask(a.id, { done: true });
    expect(done.completedAt).toBeInstanceOf(Date);

    await deleteSubtask(b.id);
    const left = await getSubtasksForTasks([taskId]);
    expect(left.map((s) => s.title)).toEqual(["Первая"]);
  });

  it("удаляются вместе с задачей", async () => {
    await createSubtask({ taskId, title: "Ещё одна" });
    await deleteTask(taskId);
    expect(await getSubtasksForTasks([taskId])).toEqual([]);
  });
});
