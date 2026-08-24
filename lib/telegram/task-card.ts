import { escapeHtml } from "@/lib/telegram/client";
import { plural } from "@/lib/telegram/capture";
import { packUuid, unpackUuid, isHandleId } from "@/lib/telegram/ids";

/**
 * Карточка задачи в телеграме: текст, клавиатура и коды кнопок.
 *
 * Модуль намеренно чистый — ни базы, ни Bot API. Всё, что он делает, — из
 * данных задачи собирает сообщение, а из нажатия разбирает намерение.
 * Выполняет действия `lib/telegram/manage.ts`.
 *
 * Форма кодов задана лимитом Telegram: `callback_data` — от 1 до 64 байт.
 * Отсюда `t:<действие>:<id22>[:<аргумент>]`, где id упакован в base64url
 * (22 символа вместо 36). Самый длинный код — перенос в колонку:
 * `t:cl:<id22>:<col22>` = 51 байт.
 */

/* ── коды кнопок ──────────────────────────────────────────────────────────── */

/** Заглушка для клеток календаря, на которые нечего вешать. */
export const NOOP_CALLBACK = "noop";

export type TaskMenu = "due" | "epic" | "priority" | "column" | "environment";

/** Двухбуквенный код меню в кнопке. Развёрнутые имена в 64 байта не влезут. */
const MENU_CODE: Record<TaskMenu, string> = {
  due: "du",
  epic: "ep",
  priority: "pr",
  column: "cl",
  environment: "en",
};

const MENU_BY_CODE = Object.fromEntries(
  Object.entries(MENU_CODE).map(([menu, code]) => [code, menu as TaskMenu])
) as Record<string, TaskMenu>;

export type DuePreset = "today" | "tomorrow" | "friday" | "monday" | "clear";

const DUE_CODE: Record<DuePreset, string> = {
  today: "0",
  tomorrow: "1",
  friday: "fri",
  monday: "mon",
  clear: "x",
};

const DUE_BY_CODE = Object.fromEntries(
  Object.entries(DUE_CODE).map(([preset, code]) => [code, preset as DuePreset])
) as Record<string, DuePreset>;

export type TaskPriority = "urgent" | "high" | "normal";

const PRIORITY_CODE: Record<TaskPriority, string> = {
  urgent: "u",
  high: "h",
  normal: "n",
};

const PRIORITY_BY_CODE = Object.fromEntries(
  Object.entries(PRIORITY_CODE).map(([p, code]) => [code, p as TaskPriority])
) as Record<string, TaskPriority>;

export type AskField = "title" | "description" | "epic";

/** Разобранное нажатие. Всё, что не разобралось, — null у `parseTaskCallback`. */
export type TaskCallback =
  | { kind: "done"; taskId: string }
  | { kind: "undone"; taskId: string }
  | { kind: "menu"; taskId: string; menu: TaskMenu }
  | { kind: "page"; taskId: string; menu: TaskMenu; page: number }
  | { kind: "due-preset"; taskId: string; preset: DuePreset }
  | { kind: "due-date"; taskId: string; date: string }
  | { kind: "due-calendar"; taskId: string; month: string }
  | { kind: "epic-set"; taskId: string; epicId: string }
  | { kind: "epic-clear"; taskId: string }
  | { kind: "priority-set"; taskId: string; priority: TaskPriority }
  | { kind: "column-set"; taskId: string; columnId: string }
  | { kind: "environment-set"; taskId: string; environmentId: string }
  | { kind: "ask"; taskId: string; field: AskField }
  | { kind: "remove-ask"; taskId: string }
  | { kind: "remove-confirm"; taskId: string }
  | { kind: "remove-cancel"; taskId: string }
  | { kind: "back"; taskId: string }
  | { kind: "search-page"; handleId: string; page: number }
  | { kind: "noop" };

const YEAR_MONTH = /^\d{4}-\d{2}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const taskCallback = {
  done: (taskId: string) => `t:dn:${packUuid(taskId)}`,
  undone: (taskId: string) => `t:un:${packUuid(taskId)}`,
  menu: (taskId: string, menu: TaskMenu) => `t:${MENU_CODE[menu]}:${packUuid(taskId)}`,
  page: (taskId: string, menu: TaskMenu, page: number) =>
    `t:${MENU_CODE[menu]}:${packUuid(taskId)}:p:${page}`,
  duePreset: (taskId: string, preset: DuePreset) =>
    `t:du:${packUuid(taskId)}:${DUE_CODE[preset]}`,
  dueDate: (taskId: string, date: string) => `t:du:${packUuid(taskId)}:${date}`,
  dueCalendar: (taskId: string, month: string) =>
    `t:du:${packUuid(taskId)}:cal:${month}`,
  epicSet: (taskId: string, epicId: string) =>
    `t:ep:${packUuid(taskId)}:${packUuid(epicId)}`,
  epicClear: (taskId: string) => `t:ep:${packUuid(taskId)}:x`,
  epicNew: (taskId: string) => `t:ep:${packUuid(taskId)}:new`,
  prioritySet: (taskId: string, priority: TaskPriority) =>
    `t:pr:${packUuid(taskId)}:${PRIORITY_CODE[priority]}`,
  columnSet: (taskId: string, columnId: string) =>
    `t:cl:${packUuid(taskId)}:${packUuid(columnId)}`,
  environmentSet: (taskId: string, environmentId: string) =>
    `t:en:${packUuid(taskId)}:${packUuid(environmentId)}`,
  askTitle: (taskId: string) => `t:tt:${packUuid(taskId)}`,
  askDescription: (taskId: string) => `t:ds:${packUuid(taskId)}`,
  removeAsk: (taskId: string) => `t:rm:${packUuid(taskId)}`,
  removeConfirm: (taskId: string) => `t:rm:${packUuid(taskId)}:y`,
  removeCancel: (taskId: string) => `t:rm:${packUuid(taskId)}:n`,
  back: (taskId: string) => `t:bk:${packUuid(taskId)}`,
  searchPage: (handleId: string, page: number) => `s:pg:${handleId}:${page}`,
};

/**
 * Нажатие → намерение. Возвращает null на всё чужое: сюда приходит содержимое
 * кнопки, то есть данные снаружи, и «незнакомый код» — обычное дело
 * (карточка захвата из T-0005 ходит по своим кодам `cap:`).
 */
export function parseTaskCallback(data: string | undefined): TaskCallback | null {
  if (!data) return null;
  if (data === NOOP_CALLBACK) return { kind: "noop" };

  const parts = data.split(":");

  if (parts[0] === "s" && parts[1] === "pg" && parts.length === 4) {
    const page = Number(parts[3]);
    if (!isHandleId(parts[2]) || !Number.isInteger(page) || page < 1) return null;
    return { kind: "search-page", handleId: parts[2], page };
  }

  if (parts[0] !== "t" || parts.length < 3) return null;

  const taskId = unpackUuid(parts[2]);
  if (!taskId) return null;

  const code = parts[1];
  const rest = parts.slice(3);

  if (code === "dn" && rest.length === 0) return { kind: "done", taskId };
  if (code === "un" && rest.length === 0) return { kind: "undone", taskId };
  if (code === "bk" && rest.length === 0) return { kind: "back", taskId };
  if (code === "tt" && rest.length === 0) return { kind: "ask", taskId, field: "title" };
  if (code === "ds" && rest.length === 0) {
    return { kind: "ask", taskId, field: "description" };
  }

  const menu = MENU_BY_CODE[code];
  if (menu && rest.length === 0) return { kind: "menu", taskId, menu };
  if (menu && rest.length === 2 && rest[0] === "p") {
    const page = Number(rest[1]);
    if (!Number.isInteger(page) || page < 1) return null;
    return { kind: "page", taskId, menu, page };
  }

  if (code === "rm") {
    if (rest.length === 0) return { kind: "remove-ask", taskId };
    if (rest.length === 1 && rest[0] === "y") return { kind: "remove-confirm", taskId };
    if (rest.length === 1 && rest[0] === "n") return { kind: "remove-cancel", taskId };
    return null;
  }

  if (code === "du") {
    if (rest.length === 2 && rest[0] === "cal" && YEAR_MONTH.test(rest[1])) {
      return { kind: "due-calendar", taskId, month: rest[1] };
    }
    if (rest.length !== 1) return null;
    const preset = DUE_BY_CODE[rest[0]];
    if (preset) return { kind: "due-preset", taskId, preset };
    if (ISO_DATE.test(rest[0])) return { kind: "due-date", taskId, date: rest[0] };
    return null;
  }

  if (code === "ep" && rest.length === 1) {
    if (rest[0] === "x") return { kind: "epic-clear", taskId };
    if (rest[0] === "new") return { kind: "ask", taskId, field: "epic" };
    const epicId = unpackUuid(rest[0]);
    return epicId ? { kind: "epic-set", taskId, epicId } : null;
  }

  if (code === "pr" && rest.length === 1) {
    const priority = PRIORITY_BY_CODE[rest[0]];
    return priority ? { kind: "priority-set", taskId, priority } : null;
  }

  if (code === "cl" && rest.length === 1) {
    const columnId = unpackUuid(rest[0]);
    return columnId ? { kind: "column-set", taskId, columnId } : null;
  }

  if (code === "en" && rest.length === 1) {
    const environmentId = unpackUuid(rest[0]);
    return environmentId ? { kind: "environment-set", taskId, environmentId } : null;
  }

  return null;
}

/* ── данные карточки ──────────────────────────────────────────────────────── */

export type InlineButton =
  | { text: string; callback_data: string }
  | { text: string; url: string };

export type Keyboard = { inline_keyboard: InlineButton[][] };

export type TaskCard = { text: string; replyMarkup?: Keyboard };

export type TaskCardData = {
  id: string;
  title: string;
  description?: string | null;
  priority: TaskPriority;
  plannedDate?: string | null;
  completedAt?: Date | null;
  createdAt: Date;
  column: { id: string; title: string };
  environment: { id: string; name: string };
  epicName?: string | null;
};

export type NamedOption = { id: string; name: string };

export type CardOptions = {
  /** Строка подтверждения над карточкой: «✓ Срок 29 августа». */
  note?: string;
  /** Ссылка «Открыть на доске». Не задана — кнопки не будет. */
  boardUrl?: string;
  /** Сегодня. Параметром, чтобы тесты не зависели от системных часов. */
  today?: Date;
};

/* ── пределы ──────────────────────────────────────────────────────────────── */

/** Заголовок в тексте карточки. В самой задаче он хранится целиком. */
const TITLE_LIMIT = 200;
/** Заголовок на кнопке: длинная надпись переносится и ломает клавиатуру. */
const BUTTON_TITLE_LIMIT = 40;
/** Описание показываем началом: карточка — не редактор. */
const DESCRIPTION_LIMIT = 300;
/** Сколько задач показывать в выдаче поиска. Больше — клавиатура нечитаема. */
export const SEARCH_CARD_SIZE = 3;
/** Сколько вариантов в подменю на страницу, дальше — «Ещё N». */
export const MENU_PAGE_SIZE = 6;

const PRIORITY_EMOJI: Record<TaskPriority, string> = {
  urgent: "🔴",
  high: "🟡",
  normal: "⚪️",
};

const PRIORITY_LABEL: Record<TaskPriority, string> = {
  urgent: "🔴 Срочный",
  high: "🟡 Высокий",
  normal: "⚪️ Обычный",
};

const MONTHS_SHORT = [
  "янв", "фев", "мар", "апр", "мая", "июн",
  "июл", "авг", "сен", "окт", "ноя", "дек",
];

const MONTHS_FULL = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря",
];

const MONTHS_NOMINATIVE = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];

const WEEKDAY_SHORT = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

/* ── карточка задачи ──────────────────────────────────────────────────────── */

/**
 * Полный набор кнопок. Появляется там, где задача одна: сразу после создания
 * или когда поиск нашёл ровно одну. В списке из нескольких у каждой задачи
 * только «✓ ‹название›» — семь кнопок на задачу превратили бы выдачу в стену.
 */
export function renderTaskCard(task: TaskCardData, options: CardOptions = {}): TaskCard {
  const done = task.completedAt != null;

  const rows: InlineButton[][] = [];
  rows.push([
    done
      ? { text: "↶ Вернуть в работу", callback_data: taskCallback.undone(task.id) }
      : { text: "✓ Готово", callback_data: taskCallback.done(task.id) },
    { text: "Срок", callback_data: taskCallback.menu(task.id, "due") },
    { text: "Эпик", callback_data: taskCallback.menu(task.id, "epic") },
  ]);
  rows.push([
    { text: "Приоритет", callback_data: taskCallback.menu(task.id, "priority") },
    { text: "Колонка", callback_data: taskCallback.menu(task.id, "column") },
  ]);
  rows.push([
    { text: "Название", callback_data: taskCallback.askTitle(task.id) },
    { text: "Описание", callback_data: taskCallback.askDescription(task.id) },
    { text: "Среда", callback_data: taskCallback.menu(task.id, "environment") },
  ]);

  const last: InlineButton[] = [
    { text: "🗑 Удалить", callback_data: taskCallback.removeAsk(task.id) },
  ];
  if (options.boardUrl) last.unshift({ text: "Открыть на доске", url: options.boardUrl });
  rows.push(last);

  return { text: taskText(task, options), replyMarkup: { inline_keyboard: rows } };
}

/** Текст карточки без клавиатуры — общий для карточки и всех подменю. */
function taskText(task: TaskCardData, options: CardOptions = {}): string {
  const done = task.completedAt != null;
  const emoji = done ? "✅" : PRIORITY_EMOJI[task.priority];

  const meta = [
    escapeHtml(task.environment.name),
    escapeHtml(task.column.title),
    done ? `висела ${lifetimeWord(lifetimeDays(task))}` : dueLabel(task.plannedDate, options.today ?? new Date()),
  ].filter(Boolean);

  const lines = [
    `${emoji} <b>${escapeHtml(truncate(task.title, TITLE_LIMIT))}</b>`,
    `<i>${meta.join(" · ")}</i>`,
  ];

  if (task.epicName) lines.push(`<i>эпик «${escapeHtml(task.epicName)}»</i>`);
  if (task.description) {
    lines.push("", escapeHtml(truncate(task.description, DESCRIPTION_LIMIT)));
  }

  const note = options.note ? `${escapeHtml(options.note)}\n\n` : "";
  return note + lines.join("\n");
}

/** Заголовок подменю: та же карточка, но вопросом вместо описания. */
function menuText(task: TaskCardData, question: string, options: CardOptions): string {
  const head = taskText({ ...task, description: null }, options);
  return `${head}\n\n<b>${escapeHtml(question)}</b>`;
}

/* ── подменю ──────────────────────────────────────────────────────────────── */

export function renderDueMenu(task: TaskCardData, options: CardOptions = {}): TaskCard {
  const today = options.today ?? new Date();

  return {
    text: menuText(task, "Когда сделать?", options),
    replyMarkup: {
      inline_keyboard: [
        [
          { text: "Сегодня", callback_data: taskCallback.duePreset(task.id, "today") },
          { text: "Завтра", callback_data: taskCallback.duePreset(task.id, "tomorrow") },
          { text: "Пт", callback_data: taskCallback.duePreset(task.id, "friday") },
          { text: "Пн", callback_data: taskCallback.duePreset(task.id, "monday") },
        ],
        [
          {
            text: "Другая дата",
            callback_data: taskCallback.dueCalendar(task.id, monthKey(today)),
          },
          { text: "Убрать срок", callback_data: taskCallback.duePreset(task.id, "clear") },
        ],
        [backButton(task.id)],
      ],
    },
  };
}

/**
 * Календарь месяца. Пустые клетки до первого числа — заглушки `noop`:
 * без них дни разъезжаются по неделям и в календаре не узнать календарь.
 */
export function renderCalendar(
  task: TaskCardData,
  month: string,
  options: CardOptions = {}
): TaskCard {
  const [year, monthNumber] = month.split("-").map(Number);
  const first = new Date(Date.UTC(year, monthNumber - 1, 1));
  const daysInMonth = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  // getUTCDay(): воскресенье — 0, а неделя у нас с понедельника.
  const leading = (first.getUTCDay() + 6) % 7;

  const rows: InlineButton[][] = [
    [
      { text: "‹", callback_data: taskCallback.dueCalendar(task.id, shiftMonth(month, -1)) },
      {
        text: `${MONTHS_NOMINATIVE[monthNumber - 1]} ${year}`,
        callback_data: NOOP_CALLBACK,
      },
      { text: "›", callback_data: taskCallback.dueCalendar(task.id, shiftMonth(month, 1)) },
    ],
    WEEKDAY_SHORT.map((day) => ({ text: day, callback_data: NOOP_CALLBACK })),
  ];

  const cells: InlineButton[] = [];
  for (let i = 0; i < leading; i++) cells.push({ text: "·", callback_data: NOOP_CALLBACK });
  for (let day = 1; day <= daysInMonth; day++) {
    const iso = `${month}-${String(day).padStart(2, "0")}`;
    cells.push({ text: String(day), callback_data: taskCallback.dueDate(task.id, iso) });
  }
  while (cells.length % 7 !== 0) cells.push({ text: "·", callback_data: NOOP_CALLBACK });

  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
  rows.push([backButton(task.id)]);

  return { text: menuText(task, "Какая дата?", options), replyMarkup: { inline_keyboard: rows } };
}

export function renderEpicMenu(
  task: TaskCardData,
  epics: NamedOption[],
  page: number,
  options: CardOptions = {}
): TaskCard {
  const rows = optionRows(task.id, "epic", epics, page, (epic) =>
    taskCallback.epicSet(task.id, epic.id)
  );

  rows.push([
    { text: "+ Новый эпик", callback_data: taskCallback.epicNew(task.id) },
    { text: "Без эпика", callback_data: taskCallback.epicClear(task.id) },
  ]);
  rows.push([backButton(task.id)]);

  return {
    text: menuText(task, epics.length > 0 ? "В какой эпик?" : "Эпиков в этом проекте нет", options),
    replyMarkup: { inline_keyboard: rows },
  };
}

export function renderPriorityMenu(task: TaskCardData, options: CardOptions = {}): TaskCard {
  return {
    text: menuText(task, "Насколько срочно?", options),
    replyMarkup: {
      inline_keyboard: [
        (["urgent", "high", "normal"] as TaskPriority[]).map((priority) => ({
          text: PRIORITY_LABEL[priority],
          callback_data: taskCallback.prioritySet(task.id, priority),
        })),
        [backButton(task.id)],
      ],
    },
  };
}

export function renderColumnMenu(
  task: TaskCardData,
  boardColumns: { id: string; title: string }[],
  page: number,
  options: CardOptions = {}
): TaskCard {
  const named = boardColumns.map((column) => ({ id: column.id, name: column.title }));
  const rows = optionRows(task.id, "column", named, page, (column) =>
    taskCallback.columnSet(task.id, column.id)
  );
  rows.push([backButton(task.id)]);

  return {
    text: menuText(task, "В какую колонку?", options),
    replyMarkup: { inline_keyboard: rows },
  };
}

export function renderEnvironmentMenu(
  task: TaskCardData,
  environments: NamedOption[],
  page: number,
  options: CardOptions = {}
): TaskCard {
  const rows = optionRows(task.id, "environment", environments, page, (environment) =>
    taskCallback.environmentSet(task.id, environment.id)
  );
  rows.push([backButton(task.id)]);

  return {
    text: menuText(task, "В какой проект перенести?", options),
    replyMarkup: { inline_keyboard: rows },
  };
}

/**
 * Удаление спрашивается всегда и поимённо: это единственное необратимое
 * действие в карточке, а кнопка живёт неделю после того, как о ней забыли.
 * Коды у вопроса и у ответа разные — иначе «спросить» и «удалить» не различить.
 */
export function renderDeleteConfirm(task: TaskCardData, options: CardOptions = {}): TaskCard {
  return {
    text: menuText(task, `Удалить «${truncate(task.title, 80)}»?`, options),
    replyMarkup: {
      inline_keyboard: [
        [
          { text: "Да, удалить", callback_data: taskCallback.removeConfirm(task.id) },
          { text: "Нет", callback_data: taskCallback.removeCancel(task.id) },
        ],
      ],
    },
  };
}

/** Ожидание текста следующим сообщением: название, описание, новый эпик. */
export function renderAskInput(
  task: TaskCardData,
  field: AskField,
  options: CardOptions = {}
): TaskCard {
  const question = {
    title: "Пришлите новое название следующим сообщением",
    description: "Пришлите описание следующим сообщением",
    epic: "Пришлите название нового эпика следующим сообщением",
  }[field];

  return {
    text: menuText(task, question, options),
    replyMarkup: { inline_keyboard: [[backButton(task.id)]] },
  };
}

/* ── выдача поиска ────────────────────────────────────────────────────────── */

export type SearchCardItem = {
  id: string;
  title: string;
  priority: TaskPriority;
  completedAt?: Date | null;
  createdAt: Date;
  column: { title: string };
  environment: { name: string };
};

export type SearchCardOptions = {
  query: string;
  total: number;
  page: number;
  handleId?: string;
  boardUrl?: string;
  /** true — сообщение написано прошедшим временем: похоже, дело уже сделано. */
  looksDone?: boolean;
  /** Кнопка «Нет, это новая задача»: код кнопки захвата из T-0005. */
  createAnywayCallback?: string;
  note?: string;
  now?: Date;
};

/**
 * Результаты поиска. На каждую задачу — одна кнопка «✓ ‹название›» с названием
 * прямо на кнопке, а не номером: сверять номер со списком глазами дороже, чем
 * прочитать надпись.
 */
export function renderSearchCard(
  items: SearchCardItem[],
  options: SearchCardOptions
): TaskCard {
  const now = options.now ?? new Date();
  const shown = items.slice(0, SEARCH_CARD_SIZE);

  const head = options.looksDone
    ? "🔍 Похоже, задача уже сделана"
    : options.total > shown.length
      ? `🔍 Нашёл ${options.total} — показываю ${shown.length}`
      : `🔍 Нашёл ${options.total}`;

  const lines = [head, ""];
  for (const item of shown) {
    const done = item.completedAt != null;
    const emoji = done ? "✅" : PRIORITY_EMOJI[item.priority];
    const meta = done
      ? `Готово · висела ${lifetimeWord(lifetimeDays(item))}`
      : `${escapeHtml(item.environment.name)} · ${escapeHtml(item.column.title)} · ${daysWord(ageDays(item.createdAt, now))}`;

    lines.push(`${emoji} <b>${escapeHtml(truncate(item.title, TITLE_LIMIT))}</b>`);
    lines.push(`<i>${meta}</i>`);
  }

  const rows: InlineButton[][] = [];
  for (const item of shown) {
    // Закрытой задаче кнопка «✓» не нужна: нажимать второй раз нечего.
    if (item.completedAt != null) continue;
    rows.push([
      {
        text: `✓ ${truncate(item.title, BUTTON_TITLE_LIMIT)}`,
        callback_data: taskCallback.done(item.id),
      },
    ]);
  }

  const rest = options.total - options.page * SEARCH_CARD_SIZE;
  if (rest > 0 && options.handleId) {
    rows.push([
      {
        text: `Ещё ${rest}`,
        callback_data: taskCallback.searchPage(options.handleId, options.page + 1),
      },
    ]);
  }

  if (options.createAnywayCallback) {
    rows.push([
      { text: "Нет, это новая задача", callback_data: options.createAnywayCallback },
    ]);
  }

  if (options.boardUrl) rows.push([{ text: "Открыть на доске", url: options.boardUrl }]);

  const note = options.note ? `${escapeHtml(options.note)}\n\n` : "";
  const card: TaskCard = { text: note + lines.join("\n") };
  if (rows.length > 0) card.replyMarkup = { inline_keyboard: rows };
  return card;
}

/** Задача удалена: клавиатуры больше нет, нажимать нечего. */
export function renderDeletedCard(title: string): TaskCard {
  return { text: `🗑 Удалил «${escapeHtml(truncate(title, TITLE_LIMIT))}»` };
}

/** Ничего не нашлось. Кнопка «завести задачей» — только для прошедшего времени. */
export function renderEmptySearch(options: {
  query: string;
  createAnywayCallback?: string;
  boardUrl?: string;
}): TaskCard {
  const rows: InlineButton[][] = [];
  if (options.createAnywayCallback) {
    rows.push([
      { text: "→ Задачей как есть", callback_data: options.createAnywayCallback },
    ]);
  }
  if (options.boardUrl) rows.push([{ text: "Открыть на доске", url: options.boardUrl }]);

  const card: TaskCard = {
    text: `🔍 Ничего не нашёл по «${escapeHtml(truncate(options.query, 100))}».`,
  };
  if (rows.length > 0) card.replyMarkup = { inline_keyboard: rows };
  return card;
}

/* ── даты ─────────────────────────────────────────────────────────────────── */

/**
 * Кнопки «Пт» и «Пн» дают строго будущую дату. Если бы «Пт» в пятницу означал
 * сегодня, он повторял бы соседнюю кнопку «Сегодня» — четыре кнопки в ряду
 * обязаны давать четыре разных дня.
 */
export function resolveDuePreset(preset: DuePreset, today: Date): string | null {
  if (preset === "clear") return null;

  const base = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())
  );

  if (preset === "today") return toIso(base);
  if (preset === "tomorrow") {
    base.setUTCDate(base.getUTCDate() + 1);
    return toIso(base);
  }

  const target = preset === "friday" ? 5 : 1; // getUTCDay: пн=1 … пт=5
  const shift = ((target - base.getUTCDay() + 7) % 7) || 7;
  base.setUTCDate(base.getUTCDate() + shift);
  return toIso(base);
}

/** «Срок 29 августа» — строка подтверждения над карточкой. */
export function dueNote(date: string | null): string {
  if (!date) return "✓ Срок убран";
  const [, month, day] = date.split("-").map(Number);
  return `✓ Срок ${day} ${MONTHS_FULL[month - 1]}`;
}

export function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function shiftMonth(month: string, delta: number): string {
  const [year, monthNumber] = month.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, monthNumber - 1 + delta, 1));
  return monthKey(shifted);
}

function toIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function dueLabel(plannedDate: string | null | undefined, today: Date): string {
  if (!plannedDate) return "без срока";
  const [year, month, day] = plannedDate.split("-").map(Number);
  const sameYear = year === today.getUTCFullYear();
  return sameYear
    ? `до ${day} ${MONTHS_SHORT[month - 1]}`
    : `до ${day} ${MONTHS_SHORT[month - 1]} ${year}`;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function ageDays(from: Date, to: Date): number {
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / DAY_MS));
}

function lifetimeDays(task: { createdAt: Date; completedAt?: Date | null }): number {
  return ageDays(task.createdAt, task.completedAt ?? new Date());
}

function daysWord(days: number): string {
  if (days === 0) return "сегодня";
  return `${days} ${plural(days, ["день", "дня", "дней"])}`;
}

/** «висела 2 дня». Отдельно от возраста: «висела сегодня» — не по-русски. */
function lifetimeWord(days: number): string {
  if (days === 0) return "меньше дня";
  return `${days} ${plural(days, ["день", "дня", "дней"])}`;
}

/* ── мелочи ───────────────────────────────────────────────────────────────── */

function backButton(taskId: string): InlineButton {
  return { text: "← Назад", callback_data: taskCallback.back(taskId) };
}

/**
 * Строки со списком вариантов: по кнопке на вариант, страницами по шесть.
 * «Ещё N» правит то же сообщение — новых сообщений подменю не порождает.
 */
function optionRows(
  taskId: string,
  menu: TaskMenu,
  options: NamedOption[],
  page: number,
  callback: (option: NamedOption) => string
): InlineButton[][] {
  const start = (page - 1) * MENU_PAGE_SIZE;
  const slice = options.slice(start, start + MENU_PAGE_SIZE);
  const rows: InlineButton[][] = [];

  for (let i = 0; i < slice.length; i += 2) {
    rows.push(
      slice.slice(i, i + 2).map((option) => ({
        text: truncate(option.name, BUTTON_TITLE_LIMIT),
        callback_data: callback(option),
      }))
    );
  }

  const rest = options.length - (start + slice.length);
  if (rest > 0) {
    rows.push([
      { text: `Ещё ${rest}`, callback_data: taskCallback.page(taskId, menu, page + 1) },
    ]);
  }

  return rows;
}

function truncate(value: string, limit: number): string {
  return value.length > limit ? `${value.slice(0, limit - 1)}…` : value;
}
