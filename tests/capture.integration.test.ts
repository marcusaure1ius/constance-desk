import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { asc, eq, inArray } from "drizzle-orm";

/*
 * Захват на настоящей базе: элементы модели → строки в tasks.
 *
 * На моках эту половину не проверить. Мок drizzle возвращает колонки в том
 * порядке, в каком их подсунул тест, поэтому «первая колонка среды» там
 * получается сама собой; в базе порядок задаёт ORDER BY position. Сюда же
 * попадает проверка, что срок ложится в колонку типа date, а эпик — в
 * category_id с внешним ключом.
 *
 * Модель здесь не участвует: captureItems подменяется заглушкой, сети нет.
 *
 * Запуск: TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:55461/constance_ci \
 *   npm run test:integration:db
 */

vi.mock("@/lib/db", async () => {
  const { createTestDb } = await import("./helpers/test-db");
  return { db: createTestDb() };
});

import { captureMessage } from "@/lib/telegram/capture";
import { loadCaptureBoard } from "@/lib/telegram/handle-update";
import { createTask } from "@/lib/services/tasks";
import { categories, columns, environments, tasks } from "@/lib/db/schema";
import { closeTestDb, createTestDb } from "./helpers/test-db";

const ids: Record<string, string> = {};

describe("захват на настоящей базе", () => {
  beforeAll(async () => {
    const db = createTestDb();

    // position -1000: активной средой бот считает первую по позиции, и тест
    // не должен зависеть от того, что осталось в базе от других прогонов.
    const [env] = await db
      .insert(environments)
      .values({ name: "T-0005 среда", color: "#3b82f6", position: -1000 })
      .returning();
    ids.env = env.id;

    // Колонки вставлены не по порядку: если код возьмёт первую вставленную
    // вместо первой по позиции, тест это увидит.
    const inserted = await db
      .insert(columns)
      .values([
        { title: "Готово", position: 2, environmentId: env.id },
        { title: "Инбокс", position: 0, environmentId: env.id },
        { title: "В работе", position: 1, environmentId: env.id },
      ])
      .returning();
    ids.inbox = inserted.find((c) => c.title === "Инбокс")!.id;

    const [epic] = await db
      .insert(categories)
      .values({ name: "ВЭД", color: "#22c55e", environmentId: env.id })
      .returning();
    ids.epic = epic.id;
  });

  afterAll(async () => {
    const db = createTestDb();
    const envColumns = await db
      .select({ id: columns.id })
      .from(columns)
      .where(eq(columns.environmentId, ids.env));

    // Задачи удаляются первыми: tasks.column_id ссылается на columns без
    // каскада, и удаление среды упало бы на внешнем ключе.
    if (envColumns.length > 0) {
      await db.delete(tasks).where(
        inArray(
          tasks.columnId,
          envColumns.map((c) => c.id)
        )
      );
    }
    await db.delete(environments).where(eq(environments.id, ids.env));
    await closeTestDb();
  });

  it("доска для промпта собирается из базы, колонки — по позиции", async () => {
    const board = await loadCaptureBoard();

    expect(board?.environment.name).toBe("T-0005 среда");
    expect(board?.columns.map((c) => c.title)).toEqual(["Инбокс", "В работе", "Готово"]);
    expect(board?.epics.map((e) => e.name)).toContain("ВЭД");
  });

  it("задачи ложатся в первую колонку со сроком, приоритетом и эпиком", async () => {
    const db = createTestDb();

    const result = await captureMessage("не важно: модель подменена", {
      loadBoard: loadCaptureBoard,
      captureItems: async () => [
        { kind: "task", text: "ответить по вэду", priority: "urgent", plannedDate: "2026-08-25", epic: "ВЭД" },
        { kind: "task", text: "заполнить итмо" },
        { kind: "note", text: "нет синергии в продуктах" },
      ],
      createTask,
    });

    expect(result.status).toBe("captured");
    expect(result.status === "captured" && result.others).toHaveLength(1);

    const rows = await db
      .select()
      .from(tasks)
      .where(eq(tasks.columnId, ids.inbox))
      .orderBy(asc(tasks.position));

    // Мысль задачей не стала: в колонке ровно две строки.
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.title)).toEqual(["ответить по вэду", "заполнить итмо"]);
    expect(rows.map((r) => r.position)).toEqual([0, 1]);

    expect(rows[0].plannedDate).toBe("2026-08-25");
    expect(rows[0].priority).toBe("urgent");
    expect(rows[0].categoryId).toBe(ids.epic);
    // Задача создана, а не закрыта: первая колонка не последняя.
    expect(rows[0].completedAt).toBeNull();
    expect(rows[0].startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    expect(rows[1].priority).toBe("normal");
    expect(rows[1].plannedDate).toBeNull();
    expect(rows[1].categoryId).toBeNull();
  });
});
