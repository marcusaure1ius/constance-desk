import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { eq, inArray, like } from "drizzle-orm";

/*
 * Управление задачами на настоящей базе.
 *
 * Перенос между средами и закрытие задачи — это порядок колонок, пересчёт
 * позиций и обнуление внешнего ключа. На моках drizzle всё это проверить
 * нельзя: мок вернёт подложенную колонку независимо от ORDER BY, и тест
 * «первая колонка» прошёл бы на коде, который берёт последнюю.
 *
 * TTL хендлов — тем более: срок годности отсекается запросом, а не кодом.
 *
 * В основной прогон (npm test) не попадают: файлы *.integration.test.ts
 * исключены маской в vitest.config.ts.
 *
 * Запуск: TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:55467/constance_ci \
 *   npm run test:integration:db
 */

vi.mock("@/lib/db", async () => {
  const { createTestDb } = await import("./helpers/test-db");
  return { db: createTestDb() };
});

import {
  completeTask,
  moveTaskToColumn,
  moveTaskToEnvironment,
  getTaskDetails,
} from "@/lib/services/tasks";
import {
  cancelAwaitInput,
  createHandle,
  getHandle,
  takeAwaitInput,
  useHandle,
} from "@/lib/services/tg-handles";
import { categories, columns, environments, tasks, tgHandles } from "@/lib/db/schema";
import { closeTestDb, createTestDb } from "./helpers/test-db";

const MARK = "T-0006";
const CHAT = 990006;

const ids: Record<string, string> = {};

describe("перенос и закрытие задачи на настоящей базе", () => {
  beforeAll(async () => {
    const db = createTestDb();

    const [envA] = await db
      .insert(environments)
      .values({ name: `${MARK} среда А`, color: "#3b82f6", position: 960 })
      .returning();
    const [envB] = await db
      .insert(environments)
      .values({ name: `${MARK} среда Б`, color: "#22c55e", position: 961 })
      .returning();
    ids.envA = envA.id;
    ids.envB = envB.id;

    // Позиции нарочно вразнобой: «первая» обязана определяться по position,
    // а не по порядку вставки и не по алфавиту.
    const colsA = await db
      .insert(columns)
      .values([
        { title: "Готово", position: 2, environmentId: envA.id },
        { title: "Бэклог", position: 0, environmentId: envA.id },
        { title: "В работе", position: 1, environmentId: envA.id },
      ])
      .returning();
    const colsB = await db
      .insert(columns)
      .values([
        { title: "Сделано", position: 5, environmentId: envB.id },
        { title: "Входящие", position: 1, environmentId: envB.id },
        { title: "Разбор", position: 3, environmentId: envB.id },
      ])
      .returning();

    ids.aBacklog = colsA.find((c) => c.title === "Бэклог")!.id;
    ids.aWork = colsA.find((c) => c.title === "В работе")!.id;
    ids.aDone = colsA.find((c) => c.title === "Готово")!.id;
    ids.bFirst = colsB.find((c) => c.title === "Входящие")!.id;
    ids.bLast = colsB.find((c) => c.title === "Сделано")!.id;

    const [epic] = await db
      .insert(categories)
      .values({ name: `${MARK} Техдолг`, environmentId: envA.id })
      .returning();
    ids.epic = epic.id;

    // Соседка в целевой колонке: позиция перенесённой задачи обязана встать
    // после неё, а не столкнуться с занятым индексом.
    const [neighbour] = await db
      .insert(tasks)
      .values({
        title: `${MARK} сосед во «Входящих»`,
        columnId: ids.bFirst,
        position: 0,
        startDate: "2026-08-01",
      })
      .returning();
    ids.neighbour = neighbour.id;
  });

  afterAll(async () => {
    const db = createTestDb();
    await db.delete(tasks).where(like(tasks.title, `${MARK}%`));
    await db.delete(categories).where(like(categories.name, `${MARK}%`));
    await db.delete(columns).where(inArray(columns.environmentId, [ids.envA, ids.envB]));
    await db.delete(environments).where(inArray(environments.id, [ids.envA, ids.envB]));
    // Пул закрывает последний describe файла: здесь он ещё нужен.
  });

  async function makeTask(title: string, columnId: string, categoryId?: string) {
    const db = createTestDb();
    const [task] = await db
      .insert(tasks)
      .values({
        title: `${MARK} ${title}`,
        columnId,
        categoryId: categoryId ?? null,
        position: 0,
        startDate: "2026-08-01",
      })
      .returning();
    return task;
  }

  it("перенос в другую среду кладёт задачу в первую колонку и обнуляет эпик", async () => {
    const task = await makeTask("перенос", ids.aBacklog, ids.epic);
    expect(task.categoryId).toBe(ids.epic);

    await moveTaskToEnvironment(task.id, ids.envB);

    const details = await getTaskDetails(task.id);
    expect(details).not.toBeNull();
    // Первая по position, а не последняя и не любая другая.
    expect(details!.column.title).toBe("Входящие");
    expect(details!.environment.id).toBe(ids.envB);
    // Эпики принадлежат среде: ссылка на чужой эпик показала бы на доске
    // дорожку из другого проекта.
    expect(details!.task.categoryId).toBeNull();
    expect(details!.epic).toBeNull();
    // Первая колонка не последняя — задача не считается выполненной.
    expect(details!.task.completedAt).toBeNull();
  });

  it("перенесённая задача встаёт после тех, кто уже в колонке", async () => {
    const task = await makeTask("позиция", ids.aBacklog);
    await moveTaskToEnvironment(task.id, ids.envB);

    const db = createTestDb();
    const inColumn = await db.select().from(tasks).where(eq(tasks.columnId, ids.bFirst));
    const moved = inColumn.find((t) => t.id === task.id);
    const neighbour = inColumn.find((t) => t.id === ids.neighbour);

    expect(moved, "задача не попала в первую колонку целевой среды").toBeDefined();
    expect(neighbour).toBeDefined();
    expect(moved!.position).not.toBe(neighbour!.position);
    expect(moved!.position).toBeGreaterThan(neighbour!.position);
  });

  it("закрытие переносит в последнюю колонку своей среды и ставит дату", async () => {
    const task = await makeTask("закрытие", ids.aBacklog);
    expect(task.completedAt).toBeNull();

    await completeTask(task.id);

    const details = await getTaskDetails(task.id);
    expect(details!.column.title).toBe("Готово");
    expect(details!.environment.id).toBe(ids.envA);
    expect(details!.task.completedAt).not.toBeNull();
  });

  it("последняя колонка считается внутри своей среды, а не по всей базе", async () => {
    // Среда Б имеет колонку с position 5 — больше любой в среде А. Глобальный
    // максимум увёл бы закрытую задачу в чужой проект.
    const task = await makeTask("своя среда", ids.aWork);
    await completeTask(task.id);

    const details = await getTaskDetails(task.id);
    expect(details!.environment.id).toBe(ids.envA);
    expect(details!.task.columnId).toBe(ids.aDone);
  });

  it("перенос в промежуточную колонку снимает дату закрытия", async () => {
    const task = await makeTask("возврат", ids.aBacklog);
    await completeTask(task.id);

    await moveTaskToColumn(task.id, ids.aWork);

    const details = await getTaskDetails(task.id);
    expect(details!.column.title).toBe("В работе");
    expect(details!.task.completedAt).toBeNull();
  });

  it("getTaskDetails отдаёт задачу вместе с колонкой, средой и эпиком", async () => {
    const task = await makeTask("подробности", ids.aBacklog, ids.epic);
    const details = await getTaskDetails(task.id);

    expect(details!.task.title).toContain("подробности");
    expect(details!.column.id).toBe(ids.aBacklog);
    expect(details!.environment.name).toContain("среда А");
    expect(details!.epic?.name).toContain("Техдолг");
  });

  it("несуществующая задача — null, а не исключение", async () => {
    expect(await getTaskDetails("00000000-0000-4000-8000-000000000000")).toBeNull();
  });
});

describe("хендлы на настоящей базе", () => {
  afterAll(async () => {
    const db = createTestDb();
    await db.delete(tgHandles).where(eq(tgHandles.chatId, CHAT));
    await closeTestDb();
  });

  it("живой хендл читается, отработанный — уже нет", async () => {
    const id = await createHandle({ kind: "search", payload: { query: "вэду" }, chatId: CHAT });
    const found = await getHandle(id);
    expect(found?.payload).toEqual({ query: "вэду" });

    await useHandle(id);
    expect(await getHandle(id)).toBeNull();
  });

  it("протухший хендл не находится: TTL отсекает сама база", async () => {
    const id = await createHandle({
      kind: "search",
      payload: { query: "старое" },
      chatId: CHAT,
      ttlMinutes: -1,
    });

    expect(await getHandle(id)).toBeNull();
  });

  it("через двадцать минут ожидание ввода протухло, а кнопка жива", async () => {
    const awaited = await createHandle({
      kind: "await_input",
      payload: { taskId: "task-ttl", field: "title" },
      chatId: CHAT,
    });
    const search = await createHandle({
      kind: "search",
      payload: { query: "вэду" },
      chatId: CHAT,
    });

    // Оба хендла заведены сейчас и с умолчаниями — разница только в сроке
    // годности. Двигаем часы, а не спим: срок отсекает запрос, ему всё равно,
    // откуда взялось «сейчас». Подменяется только Date — таймеры драйвера pg
    // трогать нельзя, иначе прогон повиснет на соединении.
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(Date.now() + 20 * 60 * 1000);

      // Забытый вопрос не перехватывает сообщение: для бота это «вопроса не
      // задавали», и текст уходит обычным путём в захват.
      expect(await takeAwaitInput(CHAT)).toBeNull();
      // А карточка в чате живёт неделю: её кнопки через двадцать минут
      // обязаны работать.
      expect(await getHandle(search)).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }

    // Пока часы не сдвинуты, то же самое ожидание забирается как обычно —
    // иначе «протухло» ничем не отличалось бы от «не завелось».
    expect((await takeAwaitInput(CHAT))?.id).toBe(awaited);
    await useHandle(search);
  });

  it("ожидание ввода забирается ровно один раз", async () => {
    const id = await createHandle({
      kind: "await_input",
      payload: { taskId: "task-1", field: "title" },
      chatId: CHAT,
      messageId: 77,
    });

    const first = await takeAwaitInput(CHAT);
    expect(first?.id).toBe(id);
    expect(first?.messageId).toBe(77);

    // Второе сообщение подряд не должно применить ту же правку повторно.
    expect(await takeAwaitInput(CHAT)).toBeNull();
  });

  it("берётся последний заданный вопрос, а не первый", async () => {
    await createHandle({
      kind: "await_input",
      payload: { taskId: "task-1", field: "title" },
      chatId: CHAT,
    });
    // created_at у обоих один и тот же с точностью до миллисекунды — разводим.
    await new Promise((resolve) => setTimeout(resolve, 5));
    await createHandle({
      kind: "await_input",
      payload: { taskId: "task-2", field: "description" },
      chatId: CHAT,
    });

    const taken = await takeAwaitInput(CHAT);
    expect(taken?.payload).toEqual({ taskId: "task-2", field: "description" });

    await cancelAwaitInput(CHAT);
  });

  it("отмена снимает все ожидания чата", async () => {
    await createHandle({
      kind: "await_input",
      payload: { taskId: "task-3", field: "title" },
      chatId: CHAT,
    });
    await cancelAwaitInput(CHAT);

    expect(await takeAwaitInput(CHAT)).toBeNull();
  });

  it("чужой чат не видит чужого ожидания", async () => {
    await createHandle({
      kind: "await_input",
      payload: { taskId: "task-4", field: "title" },
      chatId: CHAT,
    });

    expect(await takeAwaitInput(CHAT + 1)).toBeNull();
    await cancelAwaitInput(CHAT);
  });
});
