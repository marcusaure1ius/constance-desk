import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  applyAwaitedInput,
  applyTaskCallback,
  isExpiredButton,
  parseAwaitInput,
  runSearch,
  BUTTON_TTL_DAYS,
  type ManageDeps,
  type SearchHit,
  type TaskDetails,
} from "@/lib/telegram/manage";
import {
  parseTaskCallback,
  taskCallback,
  type InlineButton,
  type Keyboard,
} from "@/lib/telegram/task-card";

/*
 * Тесты идут по настоящему состоянию, а не по заранее подложенному ответу.
 *
 * Мок, который на любой вызов отдаёт одно и то же, здесь ничего не доказал бы:
 * «повторное нажатие не делает второго действия» — это утверждение про то, что
 * состояние ИЗМЕНИЛОСЬ после первого нажатия. Поэтому вместо заглушек —
 * крошечная доска в памяти: задачи, колонки, среды и эпики.
 */

const TASK_ID = "3f1a2b3c-4d5e-4f60-8123-456789abcdef";
const ENV_A = "11111111-1111-4111-8111-111111111111";
const ENV_B = "22222222-2222-4222-8222-222222222222";
const COL_BACKLOG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const COL_WORK = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const COL_DONE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const EPIC_1 = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

const NOW = new Date("2026-08-25T12:00:00Z");
const CHAT = 555;

type World = {
  deps: ManageDeps;
  tasks: Map<string, TaskDetails>;
  handles: Map<string, { kind: string; payload: unknown; messageId?: number }>;
  calls: Record<string, ReturnType<typeof vi.fn>>;
};

function makeWorld(overrides: Partial<ManageDeps> = {}): World {
  const columnsOf: Record<string, { id: string; title: string }[]> = {
    [ENV_A]: [
      { id: COL_BACKLOG, title: "Бэклог" },
      { id: COL_WORK, title: "В работе" },
      { id: COL_DONE, title: "Готово" },
    ],
    [ENV_B]: [
      { id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", title: "Входящие" },
      { id: "ffffffff-ffff-4fff-8fff-ffffffffffff", title: "Сделано" },
    ],
  };
  const environments = [
    { id: ENV_A, name: "Работа" },
    { id: ENV_B, name: "Дом" },
  ];
  const epics = [{ id: EPIC_1, name: "Техдолг" }];

  const tasks = new Map<string, TaskDetails>();
  tasks.set(TASK_ID, {
    task: {
      id: TASK_ID,
      title: "ответить по вэду",
      description: null,
      priority: "normal",
      plannedDate: null,
      completedAt: null,
      createdAt: new Date("2026-08-23T09:00:00Z"),
      columnId: COL_BACKLOG,
      categoryId: null,
    },
    column: { ...columnsOf[ENV_A][0] },
    environment: { ...environments[0] },
    epic: null,
  });

  const handles = new Map<string, { kind: string; payload: unknown; messageId?: number }>();
  let handleCounter = 0;

  const find = (id: string) => tasks.get(id) ?? null;
  const columnById = (id: string) => {
    for (const [envId, cols] of Object.entries(columnsOf)) {
      const column = cols.find((c) => c.id === id);
      if (column) return { column, envId };
    }
    return null;
  };

  const calls = {
    completeTask: vi.fn(async (id: string) => {
      const found = find(id);
      if (!found) return;
      found.task.completedAt = new Date(NOW);
      found.task.columnId = COL_DONE;
      found.column = { id: COL_DONE, title: "Готово" };
    }),
    restoreTask: vi.fn(async (id: string) => {
      const found = find(id);
      if (!found) return;
      found.task.completedAt = null;
      found.task.columnId = COL_WORK;
      found.column = { id: COL_WORK, title: "В работе" };
    }),
    updateTask: vi.fn(async (id: string, patch: Record<string, unknown>) => {
      const found = find(id);
      if (!found) return;
      Object.assign(found.task, patch);
      if ("categoryId" in patch) {
        const epic = epics.find((e) => e.id === patch.categoryId);
        found.epic = epic ? { ...epic } : null;
      }
    }),
    deleteTask: vi.fn(async (id: string) => {
      tasks.delete(id);
    }),
    moveTaskToColumn: vi.fn(async (id: string, columnId: string) => {
      const found = find(id);
      const target = columnById(columnId);
      if (!found || !target) return;
      found.task.columnId = columnId;
      found.column = { ...target.column };
    }),
    moveTaskToEnvironment: vi.fn(async (id: string, environmentId: string) => {
      const found = find(id);
      const first = columnsOf[environmentId]?.[0];
      const environment = environments.find((e) => e.id === environmentId);
      if (!found || !first || !environment) return;
      found.task.columnId = first.id;
      found.task.categoryId = null;
      found.column = { ...first };
      found.environment = { ...environment };
      found.epic = null;
    }),
    createEpic: vi.fn(async (name: string) => {
      const epic = { id: `eeee0000-0000-4000-8000-00000000000${epics.length}`, name };
      epics.push(epic);
      return { id: epic.id };
    }),
    createHandle: vi.fn(
      async (input: { kind: string; payload: unknown; messageId?: number }) => {
        const id = `HANDLE${String(++handleCounter).padStart(4, "0")}`;
        handles.set(id, input);
        return id;
      }
    ),
    cancelAwaitInput: vi.fn(async () => {}),
    searchTasks: vi.fn(async () => [] as SearchHit[]),
    getTask: vi.fn(async (id: string) => {
      const found = find(id);
      // Копия: карточка не должна держать ссылку на живое состояние.
      return found ? (JSON.parse(JSON.stringify(found), reviveDates) as TaskDetails) : null;
    }),
  };

  const deps: ManageDeps = {
    getTask: calls.getTask,
    listEpics: async () => epics.map((e) => ({ ...e })),
    listColumns: async (environmentId) => (columnsOf[environmentId] ?? []).map((c) => ({ ...c })),
    listEnvironments: async () => environments.map((e) => ({ ...e })),
    searchTasks: calls.searchTasks,
    completeTask: calls.completeTask,
    restoreTask: calls.restoreTask,
    updateTask: calls.updateTask,
    deleteTask: calls.deleteTask,
    moveTaskToColumn: calls.moveTaskToColumn,
    moveTaskToEnvironment: calls.moveTaskToEnvironment,
    createEpic: calls.createEpic,
    createHandle: calls.createHandle,
    getHandle: async (id: string) => handles.get(id) ?? null,
    cancelAwaitInput: calls.cancelAwaitInput,
    now: () => NOW,
    ...overrides,
  };

  return { deps, tasks, handles, calls };
}

/** JSON.parse съедает Date — возвращаем обратно то, что было датой. */
function reviveDates(key: string, value: unknown) {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value)) return new Date(value);
  return value;
}

const press = (data: string, world: World, messageId = 3) =>
  applyTaskCallback(parseTaskCallback(data)!, { chatId: CHAT, messageId }, world.deps);

const codes = (keyboard: Keyboard | undefined): string[] =>
  (keyboard?.inline_keyboard.flat() ?? [])
    .filter((b): b is Extract<InlineButton, { callback_data: string }> => "callback_data" in b)
    .map((b) => b.callback_data);

const labels = (keyboard: Keyboard | undefined): string[] =>
  (keyboard?.inline_keyboard.flat() ?? []).map((b) => b.text);

describe("закрытие задачи", () => {
  beforeEach(() => vi.clearAllMocks());

  it("нажатие «✓» закрывает задачу: карточка становится ✅, кнопка исчезает", async () => {
    const world = makeWorld();
    // «← Назад» рисует исходную карточку, ничего не меняя: это и есть «до».
    const before = await press(taskCallback.back(TASK_ID), world);
    expect(codes(before.card.replyMarkup)).toContain(taskCallback.done(TASK_ID));
    expect(before.card.text).not.toContain("✅");

    const closed = await press(taskCallback.done(TASK_ID), world);

    expect(world.calls.completeTask).toHaveBeenCalledTimes(1);
    expect(closed.status).toBe("applied");
    expect(closed.card.text).toContain("✅");
    expect(codes(closed.card.replyMarkup)).not.toContain(taskCallback.done(TASK_ID));
    expect(codes(closed.card.replyMarkup)).toContain(taskCallback.undone(TASK_ID));
  });

  it("повторное нажатие говорит «уже» и второго закрытия не делает", async () => {
    const world = makeWorld();
    await press(taskCallback.done(TASK_ID), world);
    world.calls.completeTask.mockClear();

    const again = await press(taskCallback.done(TASK_ID), world);

    expect(world.calls.completeTask).not.toHaveBeenCalled();
    expect(again.status).toBe("noop");
    expect(again.note).toContain("Уже");
    expect(again.card.text).toContain("Уже");
  });

  it("«Вернуть в работу» снимает закрытие, а на открытой задаче ничего не делает", async () => {
    const world = makeWorld();
    await press(taskCallback.done(TASK_ID), world);

    const restored = await press(taskCallback.undone(TASK_ID), world);
    expect(world.calls.restoreTask).toHaveBeenCalledTimes(1);
    expect(restored.status).toBe("applied");
    expect(restored.card.text).not.toContain("✅");

    const again = await press(taskCallback.undone(TASK_ID), world);
    expect(world.calls.restoreTask).toHaveBeenCalledTimes(1);
    expect(again.status).toBe("noop");
  });
});

describe("срок", () => {
  beforeEach(() => vi.clearAllMocks());

  it("подменю открывается в том же сообщении, «Назад» возвращает исходную клавиатуру", async () => {
    const world = makeWorld();
    const card = await press(taskCallback.back(TASK_ID), world);
    const menu = await press(taskCallback.menu(TASK_ID, "due"), world);

    expect(labels(menu.card.replyMarkup)).toContain("Сегодня");
    expect(labels(menu.card.replyMarkup)).toContain("← Назад");
    expect(world.calls.updateTask).not.toHaveBeenCalled();

    const back = await press(taskCallback.back(TASK_ID), world);
    expect(back.card.replyMarkup).toEqual(card.card.replyMarkup);
    expect(labels(back.card.replyMarkup)).toContain("Срок");
  });

  it("выбор дня ставит срок и подписывает результат", async () => {
    const world = makeWorld();
    const result = await press(taskCallback.duePreset(TASK_ID, "friday"), world);

    expect(world.calls.updateTask).toHaveBeenCalledWith(TASK_ID, { plannedDate: "2026-08-28" });
    expect(result.status).toBe("applied");
    expect(result.note).toBe("✓ Срок 28 августа");
    expect(result.card.text).toContain("28 авг");
  });

  it("тот же срок второй раз ничего не пишет", async () => {
    const world = makeWorld();
    await press(taskCallback.dueDate(TASK_ID, "2026-09-01"), world);
    world.calls.updateTask.mockClear();

    const again = await press(taskCallback.dueDate(TASK_ID, "2026-09-01"), world);

    expect(world.calls.updateTask).not.toHaveBeenCalled();
    expect(again.status).toBe("noop");
  });

  it("«Убрать срок» обнуляет дату, а не ставит сегодняшнюю", async () => {
    const world = makeWorld();
    await press(taskCallback.dueDate(TASK_ID, "2026-09-01"), world);
    const cleared = await press(taskCallback.duePreset(TASK_ID, "clear"), world);

    expect(world.calls.updateTask).toHaveBeenLastCalledWith(TASK_ID, { plannedDate: null });
    expect(cleared.card.text).toContain("без срока");
  });

  it("«Другая дата» показывает календарь, не трогая задачу", async () => {
    const world = makeWorld();
    const calendar = await press(taskCallback.dueCalendar(TASK_ID, "2026-09"), world);

    expect(calendar.status).toBe("menu");
    expect(world.calls.updateTask).not.toHaveBeenCalled();
    expect(codes(calendar.card.replyMarkup)).toContain(taskCallback.dueDate(TASK_ID, "2026-09-15"));
  });
});

describe("эпик, приоритет, колонка", () => {
  beforeEach(() => vi.clearAllMocks());

  it("эпик ставится и снимается, повтор не пишет", async () => {
    const world = makeWorld();
    const set = await press(taskCallback.epicSet(TASK_ID, EPIC_1), world);
    expect(set.card.text).toContain("Техдолг");

    world.calls.updateTask.mockClear();
    const again = await press(taskCallback.epicSet(TASK_ID, EPIC_1), world);
    expect(world.calls.updateTask).not.toHaveBeenCalled();
    expect(again.status).toBe("noop");

    const cleared = await press(taskCallback.epicClear(TASK_ID), world);
    expect(world.calls.updateTask).toHaveBeenCalledWith(TASK_ID, { categoryId: null });
    expect(cleared.card.text).not.toContain("Техдолг");
  });

  it("подменю эпика листается кнопкой «Ещё»", async () => {
    const world = makeWorld();
    const many = Array.from({ length: 9 }, (_, i) => ({
      id: `dddddddd-dddd-4ddd-8ddd-00000000000${i}`,
      name: `Эпик ${i}`,
    }));
    world.deps.listEpics = async () => many;

    const first = await press(taskCallback.menu(TASK_ID, "epic"), world);
    expect(codes(first.card.replyMarkup)).toContain(taskCallback.page(TASK_ID, "epic", 2));

    const second = await press(taskCallback.page(TASK_ID, "epic", 2), world);
    expect(labels(second.card.replyMarkup)).toContain("Эпик 6");
    expect(labels(second.card.replyMarkup)).not.toContain("Эпик 0");
  });

  it("приоритет меняется один раз", async () => {
    const world = makeWorld();
    const set = await press(taskCallback.prioritySet(TASK_ID, "urgent"), world);
    expect(world.calls.updateTask).toHaveBeenCalledWith(TASK_ID, { priority: "urgent" });
    expect(set.card.text).toContain("🔴");

    world.calls.updateTask.mockClear();
    const again = await press(taskCallback.prioritySet(TASK_ID, "urgent"), world);
    expect(world.calls.updateTask).not.toHaveBeenCalled();
    expect(again.status).toBe("noop");
  });

  it("колонка меняется в пределах среды", async () => {
    const world = makeWorld();
    const moved = await press(taskCallback.columnSet(TASK_ID, COL_WORK), world);

    expect(world.calls.moveTaskToColumn).toHaveBeenCalledWith(TASK_ID, COL_WORK);
    expect(moved.card.text).toContain("В работе");

    world.calls.moveTaskToColumn.mockClear();
    const again = await press(taskCallback.columnSet(TASK_ID, COL_WORK), world);
    expect(world.calls.moveTaskToColumn).not.toHaveBeenCalled();
    expect(again.status).toBe("noop");
  });

  it("перенос в другую среду зовёт перенос, а не правку колонки", async () => {
    const world = makeWorld();
    const moved = await press(taskCallback.environmentSet(TASK_ID, ENV_B), world);

    expect(world.calls.moveTaskToEnvironment).toHaveBeenCalledWith(TASK_ID, ENV_B);
    expect(world.calls.moveTaskToColumn).not.toHaveBeenCalled();
    expect(moved.card.text).toContain("Дом");
    expect(moved.card.text).toContain("Входящие");

    const again = await press(taskCallback.environmentSet(TASK_ID, ENV_B), world);
    expect(world.calls.moveTaskToEnvironment).toHaveBeenCalledTimes(1);
    expect(again.status).toBe("noop");
  });
});

describe("удаление", () => {
  beforeEach(() => vi.clearAllMocks());

  it("сначала спрашивает, потом удаляет — и это разные коды", async () => {
    const world = makeWorld();
    const asked = await press(taskCallback.removeAsk(TASK_ID), world);

    expect(world.calls.deleteTask).not.toHaveBeenCalled();
    expect(asked.card.text).toContain("Удалить");
    expect(codes(asked.card.replyMarkup)).toEqual([
      taskCallback.removeConfirm(TASK_ID),
      taskCallback.removeCancel(TASK_ID),
    ]);

    const removed = await press(taskCallback.removeConfirm(TASK_ID), world);
    expect(world.calls.deleteTask).toHaveBeenCalledWith(TASK_ID);
    expect(removed.status).toBe("deleted");
    // Клавиатуры нет: правка сообщения без reply_markup снимет кнопки.
    expect(removed.card.replyMarkup).toBeUndefined();
  });

  it("«Нет» возвращает карточку, не тронув задачу", async () => {
    const world = makeWorld();
    await press(taskCallback.removeAsk(TASK_ID), world);
    const kept = await press(taskCallback.removeCancel(TASK_ID), world);

    expect(world.calls.deleteTask).not.toHaveBeenCalled();
    expect(world.tasks.has(TASK_ID)).toBe(true);
    expect(codes(kept.card.replyMarkup)).toContain(taskCallback.done(TASK_ID));
  });

  it("нажатие на карточке удалённой задачи ничего не воскрешает", async () => {
    const world = makeWorld();
    await press(taskCallback.removeConfirm(TASK_ID), world);

    const orphan = await press(taskCallback.done(TASK_ID), world);

    expect(orphan.status).toBe("gone");
    expect(orphan.card.text).toContain("больше нет");
    expect(orphan.card.replyMarkup).toBeUndefined();
    expect(world.calls.completeTask).not.toHaveBeenCalled();
  });
});

describe("название, описание и новый эпик", () => {
  beforeEach(() => vi.clearAllMocks());

  it("«Название» запоминает вопрос хендлом и ждёт следующего сообщения", async () => {
    const world = makeWorld();
    const asked = await press(taskCallback.askTitle(TASK_ID), world, 77);

    expect(asked.status).toBe("await");
    expect(world.calls.updateTask).not.toHaveBeenCalled();
    const [handle] = [...world.handles.values()];
    expect(handle.kind).toBe("await_input");
    expect(handle.payload).toEqual({ taskId: TASK_ID, field: "title" });
    // message_id нужен, чтобы ответ правил ту же карточку, а не плодил новую.
    expect(handle.messageId).toBe(77);
  });

  it("присланный текст становится названием", async () => {
    const world = makeWorld();
    await press(taskCallback.askTitle(TASK_ID), world);
    const result = await applyAwaitedInput(
      { taskId: TASK_ID, field: "title" },
      "  ответить по вэду до пятницы  ",
      world.deps
    );

    expect(world.calls.updateTask).toHaveBeenCalledWith(TASK_ID, {
      title: "ответить по вэду до пятницы",
    });
    expect(result.card.text).toContain("ответить по вэду до пятницы");
  });

  it("описание пишется в описание, а не в название", async () => {
    const world = makeWorld();
    await applyAwaitedInput({ taskId: TASK_ID, field: "description" }, "просила Маша", world.deps);

    expect(world.calls.updateTask).toHaveBeenCalledWith(TASK_ID, { description: "просила Маша" });
  });

  it("новый эпик заводится в среде задачи и сразу привязывается", async () => {
    const world = makeWorld();
    await applyAwaitedInput({ taskId: TASK_ID, field: "epic" }, "Телеграм-агент", world.deps);

    expect(world.calls.createEpic).toHaveBeenCalledWith("Телеграм-агент", ENV_A);
    expect(world.calls.updateTask).toHaveBeenCalledWith(
      TASK_ID,
      expect.objectContaining({ categoryId: expect.any(String) })
    );
  });

  it("пустой текст ничего не переписывает", async () => {
    const world = makeWorld();
    const result = await applyAwaitedInput({ taskId: TASK_ID, field: "title" }, "   ", world.deps);

    expect(world.calls.updateTask).not.toHaveBeenCalled();
    expect(result.status).toBe("noop");
  });

  it("любое другое нажатие снимает заданный вопрос", async () => {
    const world = makeWorld();
    await press(taskCallback.menu(TASK_ID, "due"), world);
    expect(world.calls.cancelAwaitInput).toHaveBeenCalledWith(CHAT);
  });

  it("битый payload хендла разбирается в null, а не роняет обработку", () => {
    expect(parseAwaitInput(null)).toBeNull();
    expect(parseAwaitInput({ taskId: 5, field: "title" })).toBeNull();
    expect(parseAwaitInput({ taskId: TASK_ID, field: "цвет" })).toBeNull();
    expect(parseAwaitInput({ taskId: TASK_ID, field: "title" })).toEqual({
      taskId: TASK_ID,
      field: "title",
    });
  });
});

describe("срок годности кнопок", () => {
  const secondsAgo = (days: number) =>
    Math.floor((NOW.getTime() - days * 24 * 60 * 60 * 1000) / 1000);

  it("свежее сообщение живо, недельной давности — уже нет", () => {
    expect(isExpiredButton({ date: secondsAgo(1) }, NOW)).toBe(false);
    expect(isExpiredButton({ date: secondsAgo(BUTTON_TTL_DAYS - 1) }, NOW)).toBe(false);
    expect(isExpiredButton({ date: secondsAgo(BUTTON_TTL_DAYS + 1) }, NOW)).toBe(true);
    expect(isExpiredButton({ date: secondsAgo(30) }, NOW)).toBe(true);
  });

  it("правка продлевает жизнь: подменю на старой карточке обязано работать", () => {
    expect(
      isExpiredButton({ date: secondsAgo(30), edit_date: secondsAgo(1) }, NOW)
    ).toBe(false);
  });

  it("сообщения без даты не считаются протухшими", () => {
    expect(isExpiredButton(undefined, NOW)).toBe(false);
    expect(isExpiredButton({}, NOW)).toBe(false);
  });
});

describe("поиск", () => {
  beforeEach(() => vi.clearAllMocks());

  const hit = (id: string, title: string): SearchHit => ({
    task: {
      id,
      title,
      priority: "normal",
      completedAt: null,
      createdAt: new Date("2026-08-23T09:00:00Z"),
    },
    column: { id: COL_BACKLOG, title: "Бэклог" },
    environment: { id: ENV_A, name: "Работа" },
  });

  const five = [
    hit(TASK_ID, "ответить по вэду"),
    hit(ENV_A, "Заполнить пилот по вэду"),
    hit(ENV_B, "Свести цены по вэду"),
    hit(COL_WORK, "Согласовать вэду"),
    hit(COL_DONE, "Проверить вэду"),
  ];

  it("показывает максимум три задачи с кнопкой на каждую и «Ещё»", async () => {
    const world = makeWorld();
    world.calls.searchTasks.mockResolvedValue(five);

    const result = await runSearch({ query: "вэду", chatId: CHAT }, world.deps);
    const done = codes(result.card.replyMarkup).filter(
      (code) => parseTaskCallback(code)?.kind === "done"
    );

    expect(world.calls.searchTasks).toHaveBeenCalledWith("вэду", expect.any(Number));
    expect(done).toHaveLength(3);
    expect(labels(result.card.replyMarkup)).toContain("✓ ответить по вэду");
    expect(labels(result.card.replyMarkup)).toContain("Ещё 2");
  });

  it("«Ещё» правит то же сообщение и показывает следующие", async () => {
    const world = makeWorld();
    world.calls.searchTasks.mockResolvedValue(five);
    await runSearch({ query: "вэду", chatId: CHAT }, world.deps);

    const [handleId] = [...world.handles.keys()];
    const next = await applyTaskCallback(
      parseTaskCallback(taskCallback.searchPage(handleId, 2))!,
      { chatId: CHAT, messageId: 3 },
      world.deps
    );

    expect(labels(next.card.replyMarkup)).toContain("✓ Согласовать вэду");
    expect(labels(next.card.replyMarkup)).not.toContain("✓ ответить по вэду");
  });

  it("протухший хендл не притворяется поиском", async () => {
    const world = makeWorld();
    const result = await applyTaskCallback(
      parseTaskCallback(taskCallback.searchPage("HANDLE9999", 2))!,
      { chatId: CHAT, messageId: 3 },
      world.deps
    );

    expect(result.status).toBe("gone");
    expect(result.card.text).toContain("старше недели");
    expect(world.calls.searchTasks).not.toHaveBeenCalled();
  });

  it("одна находка разворачивается в полную карточку", async () => {
    const world = makeWorld();
    world.calls.searchTasks.mockResolvedValue([five[0]]);

    const result = await runSearch({ query: "вэду", chatId: CHAT }, world.deps);
    const found = codes(result.card.replyMarkup);

    expect(found).toContain(taskCallback.done(TASK_ID));
    expect(found).toContain(taskCallback.menu(TASK_ID, "due"));
    expect(found).toContain(taskCallback.removeAsk(TASK_ID));
  });

  it("прошедшее время показывает найденное, а не закрывает задачу", async () => {
    const world = makeWorld();
    world.calls.searchTasks.mockResolvedValue([five[0]]);

    const result = await runSearch(
      { query: "вэду", chatId: CHAT, looksDone: true, createAnywayCallback: "cap:astask:42" },
      world.deps
    );

    expect(world.calls.completeTask).not.toHaveBeenCalled();
    expect(result.card.text).toContain("уже сделана");
    expect(codes(result.card.replyMarkup)).toContain(taskCallback.done(TASK_ID));
    expect(labels(result.card.replyMarkup)).toContain("Нет, это новая задача");
  });

  it("пустая выдача предлагает завести задачу, но сама её не заводит", async () => {
    const world = makeWorld();
    world.calls.searchTasks.mockResolvedValue([]);

    const result = await runSearch(
      { query: "вэду", chatId: CHAT, looksDone: true, createAnywayCallback: "cap:astask:42" },
      world.deps
    );

    expect(result.card.text).toContain("Ничего не нашёл");
    expect(labels(result.card.replyMarkup)).toContain("→ Задачей как есть");
  });
});
