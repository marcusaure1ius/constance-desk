import {
  renderAskInput,
  renderCalendar,
  renderColumnMenu,
  renderDeleteConfirm,
  renderDueMenu,
  renderEmptySearch,
  renderEnvironmentMenu,
  renderEpicMenu,
  renderPriorityMenu,
  renderSearchCard,
  renderTaskCard,
  resolveDuePreset,
  dueNote,
  renderDeletedCard,
  SEARCH_CARD_SIZE,
  type AskField,
  type NamedOption,
  type TaskCallback,
  type TaskCard,
  type TaskCardData,
  type TaskPriority,
} from "@/lib/telegram/task-card";

/**
 * Выполнение нажатий на карточке задачи.
 *
 * Единственный путь правки задачи из телеграма: найти → показать → нажать
 * кнопку. Бот не закрывает и не меняет задачу по фразе — нечёткий поиск
 * ошибается, и цена ошибки «закрыл не ту задачу» несопоставима с ценой
 * лишнего тапа.
 *
 * Функции возвращают карточку, а не отправляют её: отправка и правка
 * сообщения — дело `handle-update`, а сюда не должен просачиваться Bot API.
 */

/** Задача с окружением — ровно то, что отдаёт `getTaskDetails`. */
export type TaskDetails = {
  task: {
    id: string;
    title: string;
    description: string | null;
    priority: TaskPriority;
    plannedDate: string | null;
    completedAt: Date | null;
    createdAt: Date;
    columnId: string;
    categoryId: string | null;
  };
  column: { id: string; title: string };
  environment: { id: string; name: string };
  epic: { id: string; name: string } | null;
};

export type SearchHit = {
  task: {
    id: string;
    title: string;
    priority: TaskPriority;
    completedAt: Date | null;
    createdAt: Date;
  };
  column: { id: string; title: string };
  environment: { id: string; name: string };
};

export type ManageDeps = {
  getTask: (taskId: string) => Promise<TaskDetails | null>;
  listEpics: (environmentId: string) => Promise<NamedOption[]>;
  listColumns: (environmentId: string) => Promise<{ id: string; title: string }[]>;
  listEnvironments: () => Promise<NamedOption[]>;
  searchTasks: (query: string, limit: number) => Promise<SearchHit[]>;
  completeTask: (taskId: string) => Promise<unknown>;
  restoreTask: (taskId: string) => Promise<unknown>;
  updateTask: (
    taskId: string,
    patch: Partial<{
      title: string;
      description: string | null;
      categoryId: string | null;
      priority: TaskPriority;
      plannedDate: string | null;
    }>
  ) => Promise<unknown>;
  deleteTask: (taskId: string) => Promise<unknown>;
  moveTaskToColumn: (taskId: string, columnId: string) => Promise<unknown>;
  moveTaskToEnvironment: (taskId: string, environmentId: string) => Promise<unknown>;
  createEpic: (name: string, environmentId: string) => Promise<{ id: string }>;
  /** Хендлы: за кнопкой «Ещё N» и за ожиданием ввода стоит запись в базе. */
  createHandle: (input: {
    kind: "search" | "await_input";
    payload: unknown;
    chatId?: number;
    messageId?: number;
  }) => Promise<string>;
  getHandle: (id: string) => Promise<{ payload: unknown } | null>;
  cancelAwaitInput: (chatId: number) => Promise<void>;
  /**
   * Корень приложения, например `https://constance.example`. Не задан —
   * кнопки «Открыть на доске» не будет: ссылка «в никуда» хуже её отсутствия.
   */
  boardUrl?: string;
  now?: () => Date;
};

export type ManageContext = { chatId: number; messageId?: number };

export type ManageOutcome = {
  card: TaskCard;
  /**
   * Что случилось. `noop` — кнопка нажата повторно и второго действия не
   * последовало; на этом держится безопасность вечных инлайн-кнопок.
   */
  status: "applied" | "noop" | "menu" | "await" | "deleted" | "gone" | "ignored";
  note?: string;
};

/**
 * Сколько живут кнопки. Инлайн-клавиатура не исчезает сама: без срока годности
 * нажатие на карточке месячной давности удалило бы задачу, о которой уже никто
 * не помнит. Неделя совпадает с `HANDLE_TTL_MINUTES` — за кнопками и так стоят
 * хендлы. Ожидание ввода живёт отдельным, куда более коротким сроком: там между
 * вопросом и ответом секунды, а не дни.
 */
export const BUTTON_TTL_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Устарела ли кнопка. Считается по дате сообщения из самого апдейта —
 * положить время в `callback_data` негде: там 64 байта, и они заняты.
 *
 * Правка учитывается: карточка живёт правками, и подменю, открытое сегодня на
 * сообщении недельной давности, обязано работать.
 */
export function isExpiredButton(
  message: { date?: number; edit_date?: number } | undefined,
  now: Date,
  ttlDays = BUTTON_TTL_DAYS
): boolean {
  const seconds = Math.max(message?.date ?? 0, message?.edit_date ?? 0);
  if (!seconds) return false;
  return now.getTime() - seconds * 1000 > ttlDays * DAY_MS;
}

/** Сообщение вместо карточки, когда кнопки протухли. Клавиатура снимается. */
export function expiredCard(): TaskCard {
  return {
    text:
      "Эти кнопки устарели — сообщению больше недели.\n" +
      "Найдите задачу заново: напишите, например, «найди задачи по вэду».",
  };
}

/**
 * Ссылка на задачу в приложении. Параметры `?task=` и `?q=` доска пока не
 * читает — их разбор это отдельная задача спеки (S-16) вместе с вопросом,
 * как проходить PIN-стену из встроенного браузера Telegram. Кнопка при этом
 * уже полезна: она открывает доску, а параметр не мешает.
 */
function taskUrl(deps: ManageDeps, taskId: string): string | undefined {
  return deps.boardUrl ? `${deps.boardUrl}/?task=${taskId}` : undefined;
}

function searchUrl(deps: ManageDeps, query: string): string | undefined {
  return deps.boardUrl ? `${deps.boardUrl}/?q=${encodeURIComponent(query)}` : undefined;
}

function toCardData(details: TaskDetails): TaskCardData {
  return {
    id: details.task.id,
    title: details.task.title,
    description: details.task.description,
    priority: details.task.priority,
    plannedDate: details.task.plannedDate,
    completedAt: details.task.completedAt,
    createdAt: details.task.createdAt,
    column: details.column,
    environment: details.environment,
    epicName: details.epic?.name ?? null,
  };
}

function goneCard(): ManageOutcome {
  return {
    status: "gone",
    card: { text: "Задачи больше нет — похоже, её уже удалили." },
  };
}

/**
 * Нажатие → новая карточка.
 *
 * Задача перечитывается после каждой правки: карточка обязана показывать
 * состояние базы, а не то, что мы собирались записать. Иначе «Готово» на
 * задаче, удалённой в приложении минуту назад, отрисовало бы выполненной
 * несуществующую задачу.
 */
export async function applyTaskCallback(
  action: TaskCallback,
  context: ManageContext,
  deps: ManageDeps
): Promise<ManageOutcome> {
  const now = deps.now?.() ?? new Date();

  if (action.kind === "noop") {
    return { status: "ignored", card: { text: "" } };
  }

  if (action.kind === "search-page") {
    return searchPage(action.handleId, action.page, deps, now);
  }

  const details = await deps.getTask(action.taskId);
  if (!details) return goneCard();

  const task = toCardData(details);
  const cardOptions = { boardUrl: taskUrl(deps, action.taskId), today: now };

  // Любое нажатие отменяет заданный вопрос: иначе следующее сообщение молча
  // ушло бы в название задачи вместо новой записи на доску.
  if (action.kind !== "ask") await deps.cancelAwaitInput(context.chatId);

  switch (action.kind) {
    case "back":
      return { status: "menu", card: renderTaskCard(task, cardOptions) };

    case "menu":
    case "page":
      return openMenu(action.menu, "page" in action ? action.page : 1, task, details, deps, cardOptions);

    case "due-calendar":
      return {
        status: "menu",
        card: renderCalendar(task, action.month, cardOptions),
      };

    case "remove-ask":
      return { status: "menu", card: renderDeleteConfirm(task, cardOptions) };

    case "remove-cancel":
      return {
        status: "noop",
        note: "Не удаляю",
        card: renderTaskCard(task, { ...cardOptions, note: "Не удаляю" }),
      };

    case "remove-confirm":
      await deps.deleteTask(task.id);
      return {
        status: "deleted",
        note: "Удалено",
        card: renderDeletedCard(task.title),
      };

    case "ask":
      return ask(action.field, task, context, deps, cardOptions);

    case "done":
      if (details.task.completedAt) {
        return applied(task, deps, "Уже готово", "noop", cardOptions);
      }
      await deps.completeTask(task.id);
      return applied(task, deps, "✓ Готово", "applied", cardOptions);

    case "undone":
      if (!details.task.completedAt) {
        return applied(task, deps, "Задача и так в работе", "noop", cardOptions);
      }
      await deps.restoreTask(task.id);
      return applied(task, deps, "↶ Вернул в работу", "applied", cardOptions);

    case "due-preset":
    case "due-date": {
      const date =
        action.kind === "due-date"
          ? action.date
          : resolveDuePreset(action.preset, now);

      if ((details.task.plannedDate ?? null) === date) {
        return applied(task, deps, "Срок уже такой", "noop", cardOptions);
      }
      await deps.updateTask(task.id, { plannedDate: date });
      return applied(task, deps, dueNote(date), "applied", cardOptions);
    }

    case "priority-set":
      if (details.task.priority === action.priority) {
        return applied(task, deps, "Приоритет уже такой", "noop", cardOptions);
      }
      await deps.updateTask(task.id, { priority: action.priority });
      return applied(task, deps, "✓ Приоритет обновлён", "applied", cardOptions);

    case "epic-set":
      if (details.task.categoryId === action.epicId) {
        return applied(task, deps, "Эпик уже такой", "noop", cardOptions);
      }
      await deps.updateTask(task.id, { categoryId: action.epicId });
      return applied(task, deps, "✓ Эпик обновлён", "applied", cardOptions);

    case "epic-clear":
      if (details.task.categoryId === null) {
        return applied(task, deps, "Эпика и так нет", "noop", cardOptions);
      }
      await deps.updateTask(task.id, { categoryId: null });
      return applied(task, deps, "✓ Эпик снят", "applied", cardOptions);

    case "column-set":
      if (details.task.columnId === action.columnId) {
        return applied(task, deps, "Задача уже в этой колонке", "noop", cardOptions);
      }
      await deps.moveTaskToColumn(task.id, action.columnId);
      return applied(task, deps, "✓ Перенёс", "applied", cardOptions);

    case "environment-set":
      if (details.environment.id === action.environmentId) {
        return applied(task, deps, "Задача уже в этом проекте", "noop", cardOptions);
      }
      await deps.moveTaskToEnvironment(task.id, action.environmentId);
      return applied(task, deps, "✓ Перенёс в другой проект", "applied", cardOptions);
  }
}

/** Перечитать задачу и отрисовать карточку с подписью о том, что произошло. */
async function applied(
  previous: TaskCardData,
  deps: ManageDeps,
  note: string,
  status: "applied" | "noop",
  cardOptions: { boardUrl?: string; today: Date }
): Promise<ManageOutcome> {
  const fresh = await deps.getTask(previous.id);
  if (!fresh) return goneCard();

  return {
    status,
    note,
    card: renderTaskCard(toCardData(fresh), { ...cardOptions, note }),
  };
}

async function openMenu(
  menu: "due" | "epic" | "priority" | "column" | "environment",
  page: number,
  task: TaskCardData,
  details: TaskDetails,
  deps: ManageDeps,
  cardOptions: { boardUrl?: string; today: Date }
): Promise<ManageOutcome> {
  // Срок и приоритет страниц не имеют: вариантов у них ровно столько, сколько
  // помещается в один экран.
  if (menu === "due") return { status: "menu", card: renderDueMenu(task, cardOptions) };
  if (menu === "priority") {
    return { status: "menu", card: renderPriorityMenu(task, cardOptions) };
  }
  if (menu === "epic") {
    const epics = await deps.listEpics(details.environment.id);
    return { status: "menu", card: renderEpicMenu(task, epics, page, cardOptions) };
  }
  if (menu === "column") {
    const boardColumns = await deps.listColumns(details.environment.id);
    return { status: "menu", card: renderColumnMenu(task, boardColumns, page, cardOptions) };
  }

  const environments = await deps.listEnvironments();
  return { status: "menu", card: renderEnvironmentMenu(task, environments, page, cardOptions) };
}

/**
 * Вопрос «пришлите текст следующим сообщением».
 *
 * Ответ придёт отдельным апдейтом, в котором про эту карточку ничего нет,
 * поэтому ожидание записывается хендлом: по чату его найдёт следующее
 * сообщение, а `message_id` вернёт правку в ту же карточку.
 */
async function ask(
  field: AskField,
  task: TaskCardData,
  context: ManageContext,
  deps: ManageDeps,
  cardOptions: { boardUrl?: string; today: Date }
): Promise<ManageOutcome> {
  await deps.cancelAwaitInput(context.chatId);
  await deps.createHandle({
    kind: "await_input",
    payload: { taskId: task.id, field },
    chatId: context.chatId,
    messageId: context.messageId,
  });

  return { status: "await", card: renderAskInput(task, field, cardOptions) };
}

/* ── ответ на присланный текст ────────────────────────────────────────────── */

export type AwaitInputPayload = { taskId: string; field: AskField };

/** Разбор payload хендла: в базе лежит jsonb, то есть данные без гарантий. */
export function parseAwaitInput(payload: unknown): AwaitInputPayload | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  const taskId = record.taskId;
  const field = record.field;
  if (typeof taskId !== "string") return null;
  if (field !== "title" && field !== "description" && field !== "epic") return null;
  return { taskId, field };
}

/** Присланный текст → правка задачи, о которой спрашивали. */
export async function applyAwaitedInput(
  input: AwaitInputPayload,
  text: string,
  deps: ManageDeps
): Promise<ManageOutcome> {
  const now = deps.now?.() ?? new Date();
  const cardOptions = { boardUrl: taskUrl(deps, input.taskId), today: now };

  const details = await deps.getTask(input.taskId);
  if (!details) return goneCard();

  const value = text.trim();
  if (!value) {
    return {
      status: "noop",
      note: "Пустой текст",
      card: renderTaskCard(toCardData(details), { ...cardOptions, note: "Пустой текст — ничего не менял" }),
    };
  }

  if (input.field === "title") {
    await deps.updateTask(input.taskId, { title: value });
    return applied(toCardData(details), deps, "✓ Название обновлено", "applied", cardOptions);
  }

  if (input.field === "description") {
    await deps.updateTask(input.taskId, { description: value });
    return applied(toCardData(details), deps, "✓ Описание обновлено", "applied", cardOptions);
  }

  // Новый эпик заводится в среде задачи: категории принадлежат среде, и
  // создать его «вообще» нельзя.
  const epic = await deps.createEpic(value, details.environment.id);
  await deps.updateTask(input.taskId, { categoryId: epic.id });
  return applied(toCardData(details), deps, "✓ Эпик создан", "applied", cardOptions);
}

/* ── поиск ────────────────────────────────────────────────────────────────── */

export type SearchRequest = {
  query: string;
  chatId: number;
  /** Сообщение написано прошедшим временем: похоже, дело уже сделано. */
  looksDone?: boolean;
  /** Код кнопки «Нет, это новая задача» — из карточки захвата T-0005. */
  createAnywayCallback?: string;
};

/**
 * Сколько результатов тянем за раз: хватает и на страницы, и на счётчик.
 * Упёрлись в это число — счётчик в карточке становится «30+»: сколько там на
 * самом деле, мы не знаем, а точное «30» на сотне совпадений было бы неправдой.
 */
export const SEARCH_FETCH_LIMIT = 30;

/**
 * Запрос → карточка результатов.
 *
 * Тянем сразу целую пачку, а не страницу: чтобы написать «Ещё 4», надо знать,
 * сколько всего нашлось, а отдельного COUNT у поиска нет. Тридцати хватает —
 * дальше третьей страницы в телеграме всё равно не листают.
 */
export async function runSearch(
  request: SearchRequest,
  deps: ManageDeps
): Promise<ManageOutcome> {
  const now = deps.now?.() ?? new Date();
  const hits = await deps.searchTasks(request.query, SEARCH_FETCH_LIMIT);

  if (hits.length === 0) {
    return {
      status: "gone",
      card: renderEmptySearch({
        query: request.query,
        createAnywayCallback: request.createAnywayCallback,
        boardUrl: searchUrl(deps, request.query),
      }),
    };
  }

  // Ровно одна находка — полный набор кнопок: выбирать не из чего, значит
  // можно сразу дать всё, что с задачей делают.
  if (hits.length === 1 && !request.looksDone) {
    const details = await deps.getTask(hits[0].task.id);
    if (details) {
      return {
        status: "menu",
        card: renderTaskCard(toCardData(details), {
          boardUrl: taskUrl(deps, details.task.id),
          today: now,
          note: "🔍 Нашёл одну",
        }),
      };
    }
  }

  const handleId = await deps.createHandle({
    kind: "search",
    payload: { query: request.query },
    chatId: request.chatId,
  });

  return {
    status: "menu",
    card: renderSearchCard(hits.map(toSearchItem), {
      query: request.query,
      total: hits.length,
      capped: hits.length >= SEARCH_FETCH_LIMIT,
      page: 1,
      handleId,
      boardUrl: searchUrl(deps, request.query),
      looksDone: request.looksDone,
      createAnywayCallback: request.createAnywayCallback,
      now,
    }),
  };
}

/** «Ещё N»: тот же запрос, следующая тройка, то же сообщение. */
async function searchPage(
  handleId: string,
  page: number,
  deps: ManageDeps,
  now: Date
): Promise<ManageOutcome> {
  const handle = await deps.getHandle(handleId);
  const query =
    handle && typeof handle.payload === "object" && handle.payload !== null
      ? (handle.payload as Record<string, unknown>).query
      : undefined;

  if (typeof query !== "string") {
    return {
      status: "gone",
      card: { text: "Этот поиск уже не найти — он старше недели. Спросите заново." },
    };
  }

  const hits = await deps.searchTasks(query, SEARCH_FETCH_LIMIT);
  const offset = (page - 1) * SEARCH_CARD_SIZE;
  const slice = hits.slice(offset, offset + SEARCH_CARD_SIZE);

  if (slice.length === 0) {
    return {
      status: "noop",
      card: renderSearchCard(hits.slice(0, SEARCH_CARD_SIZE).map(toSearchItem), {
        query,
        total: hits.length,
        capped: hits.length >= SEARCH_FETCH_LIMIT,
        page: 1,
        handleId,
        boardUrl: searchUrl(deps, query),
        note: "Дальше ничего нет",
        now,
      }),
    };
  }

  return {
    status: "menu",
    card: renderSearchCard(slice.map(toSearchItem), {
      query,
      total: hits.length,
      capped: hits.length >= SEARCH_FETCH_LIMIT,
      page,
      handleId,
      boardUrl: searchUrl(deps, query),
      now,
    }),
  };
}

function toSearchItem(hit: SearchHit) {
  return {
    id: hit.task.id,
    title: hit.task.title,
    priority: hit.task.priority,
    completedAt: hit.task.completedAt,
    createdAt: hit.task.createdAt,
    column: { title: hit.column.title },
    environment: { name: hit.environment.name },
  };
}
