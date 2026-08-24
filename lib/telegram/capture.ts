import type { CaptureBoard, CapturedItem, CapturePriority } from "@/lib/llm/capture";
import { sanitizeTitle } from "@/lib/llm/capture";
import { escapeHtml } from "@/lib/telegram/client";

/**
 * Захват в терминах доски: элементы от модели → задачи в первой колонке
 * активного проекта, и карточка ответа.
 *
 * Почему первая колонка, а не «умный выбор»: колонку модель не выбирает (см.
 * промпт). Задача с бегу — это всегда входящее, а не «в работе»; ошибиться
 * колонкой хуже, чем положить туда, где пользователь и так ищет новое.
 */

/** Доска для захвата: имена уходят в промпт, идентификаторы — в запись. */
export type CaptureBoardData = {
  environment: { id: string; name: string };
  environmentNames: string[];
  columns: { id: string; title: string }[];
  epics: { id: string; name: string }[];
};

export type CreateTaskArgs = {
  title: string;
  columnId: string;
  categoryId?: string;
  priority?: CapturePriority;
  plannedDate?: string;
};

export type CreatedTask = {
  title: string;
  priority: CapturePriority;
  plannedDate?: string;
  epic?: string;
};

/** Вопрос к доске: поисковый запрос и признак «дело уже сделано». */
export type CaptureQuestion = { text: string; done?: boolean };

export type CaptureDeps = {
  loadBoard: () => Promise<CaptureBoardData | null>;
  captureItems: (text: string, board: CaptureBoard) => Promise<CapturedItem[]>;
  createTask: (input: CreateTaskArgs) => Promise<unknown>;
};

export type CaptureResult =
  /** Проектов или колонок нет — складывать некуда. */
  | { status: "no_board" }
  /** Модель не ответила. Сообщение при этом уже в журнале. */
  | { status: "failed"; reason: string }
  /** Модель ответила, но ничего не распознала. */
  | { status: "empty" }
  | {
      status: "captured";
      environmentName: string;
      columnTitle: string;
      tasks: CreatedTask[];
      /**
       * Вопросы и рассказы о сделанном. Задачами они не становятся: их
       * обрабатывает поиск — «ответил по вэду» обязано показать существующую
       * задачу с кнопкой, а не завести вторую такую же.
       */
      questions: CaptureQuestion[];
      others: CapturedItem[];
      /** Часть задач не записалась: база отвалилась посреди списка. */
      warning?: string;
    };

/**
 * Сообщение → задачи на доске.
 *
 * Функция не бросает вообще: любой сбой — квота модели, упавшая база — это
 * результат со статусом, потому что на том конце ждёт человек. Молчание бота
 * в ответ на брошенное на бегу сообщение выглядит как потеря сообщения.
 */
export async function captureMessage(
  text: string,
  deps: CaptureDeps
): Promise<CaptureResult> {
  let board: CaptureBoardData | null;
  try {
    board = await deps.loadBoard();
  } catch (error) {
    return { status: "failed", reason: reasonOf(error) };
  }
  if (!board || board.columns.length === 0) return { status: "no_board" };

  let items: CapturedItem[];
  try {
    items = await deps.captureItems(text, toPromptBoard(board));
  } catch (error) {
    // Квота Groq, авария OpenRouter, обрыв связи. Сообщение не теряется: оно
    // записано в журнал до обработки, а в карточке будет кнопка повтора.
    return { status: "failed", reason: reasonOf(error) };
  }

  if (items.length === 0) return { status: "empty" };

  const target = board.columns[0];
  const tasks: CreatedTask[] = [];
  let warning: string | undefined;

  try {
    // Последовательно, а не Promise.all: createTask считает позицию от максимума
    // в колонке, и параллельные вставки получили бы одинаковую.
    for (const item of items) {
      if (item.kind !== "task") continue;

      const epic = item.epic ? board.epics.find((e) => e.name === item.epic) : undefined;
      await deps.createTask({
        title: item.text,
        columnId: target.id,
        categoryId: epic?.id,
        priority: item.priority ?? "normal",
        plannedDate: item.plannedDate,
      });

      tasks.push({
        title: item.text,
        priority: item.priority ?? "normal",
        plannedDate: item.plannedDate,
        epic: epic?.name,
      });
    }
  } catch (error) {
    // Часть задач уже на доске. Соврать «ничего не вышло» нельзя — иначе
    // повтор создаст их второй раз, поэтому показываем, что успели.
    warning = reasonOf(error);
  }

  const questions = items
    .filter((item) => item.kind === "question")
    .map((item) => ({ text: item.text, done: item.done }));
  const others = items.filter(
    (item) => item.kind !== "task" && item.kind !== "question"
  );

  return {
    status: "captured",
    environmentName: board.environment.name,
    columnTitle: target.title,
    tasks,
    questions,
    others,
    warning,
  };
}

/** «Задачей как есть»: текст сообщения без разбора — в первую колонку. */
export async function createTaskFromText(
  text: string,
  deps: Pick<CaptureDeps, "loadBoard" | "createTask">
): Promise<CaptureResult> {
  const title = sanitizeTitle(text);
  if (!title) return { status: "empty" };

  let board: CaptureBoardData | null;
  let target: { id: string; title: string };
  try {
    board = await deps.loadBoard();
    if (!board || board.columns.length === 0) return { status: "no_board" };

    target = board.columns[0];
    await deps.createTask({ title, columnId: target.id, priority: "normal" });
  } catch (error) {
    return { status: "failed", reason: reasonOf(error) };
  }

  return {
    status: "captured",
    environmentName: board.environment.name,
    columnTitle: target.title,
    tasks: [{ title, priority: "normal" }],
    questions: [],
    others: [],
  };
}

export function toPromptBoard(board: CaptureBoardData): CaptureBoard {
  return {
    environmentName: board.environment.name,
    environmentNames: board.environmentNames,
    columnTitles: board.columns.map((c) => c.title),
    epicNames: board.epics.map((e) => e.name),
  };
}

/* ── кнопки ───────────────────────────────────────────────────────────────── */

/**
 * `callback_data` ограничен 64 байтами, поэтому в кнопке лежит не состояние, а
 * ссылка на него: номер апдейта. Сам апдейт целиком есть в журнале — по нему
 * повтор разбора восстанавливает и текст, и голосовое.
 */
export type CaptureAction = "retry" | "astask";

export function captureCallback(action: CaptureAction, updateId: number): string {
  return `cap:${action}:${updateId}`;
}

export function parseCaptureCallback(
  data: string | undefined
): { action: CaptureAction; updateId: number } | null {
  if (!data) return null;
  const match = /^cap:(retry|astask):(-?\d+)$/.exec(data);
  if (!match) return null;
  return { action: match[1] as CaptureAction, updateId: Number(match[2]) };
}

export type InlineKeyboard = {
  inline_keyboard: { text: string; callback_data: string }[][];
};

/* ── карточка ответа ──────────────────────────────────────────────────────── */

const PRIORITY_LABEL: Record<CapturePriority, string> = {
  urgent: "срочно",
  high: "важно",
  normal: "",
};

const KIND_LABEL: Record<CapturedItem["kind"], string> = {
  task: "задача",
  note: "мысль",
  read: "материал",
  question: "вопрос",
  raw: "не разобрал",
};

export type CaptureCard = { text: string; replyMarkup?: InlineKeyboard };

/*
 * Пределы карточки. В сообщение Telegram влезает 4096 символов, и решать, чем
 * жертвовать, обязана карточка: расшифровка стоит первой строкой, а
 * подтверждение созданных задач — последней, поэтому слепая обрезка с хвоста
 * (она есть в клиенте как страховка) выкинула бы ровно то, ради чего
 * пользователь сообщение и слал.
 */

/** Расшифровка голосового: показываем начало, целиком она нужна редко. */
const TRANSCRIPT_LIMIT = 600;
/** Заголовок в карточке. В самой задаче он сохраняется целиком. */
const TITLE_LIMIT = 200;
/** Сколько задач перечислять поимённо; остальные считаются числом. */
const MAX_LISTED_TASKS = 15;

/**
 * Карточка ответа. Первая строка — подтверждение: её видно в списке чатов, не
 * открывая бота, и по ней сразу понятно, сработало или нет.
 */
export function renderCaptureCard(
  result: CaptureResult,
  options: { updateId: number; transcript?: string }
): CaptureCard {
  const prefix = options.transcript
    ? `🎤 <i>${escapeHtml(truncate(options.transcript, TRANSCRIPT_LIMIT))}</i>\n\n`
    : "";

  if (result.status === "no_board") {
    return {
      text:
        prefix +
        "Складывать некуда: на доске нет проекта с колонками.\n" +
        "Создайте проект в приложении — и я начну класть задачи в первую колонку.",
    };
  }

  if (result.status === "failed" || result.status === "empty") {
    const first =
      result.status === "failed"
        ? `Сохранил сообщение, но не разобрал: ${escapeHtml(result.reason)}.`
        : "Сохранил сообщение, но не понял, что с ним делать.";

    return {
      text:
        prefix +
        first +
        "\n\nМогу попробовать ещё раз или завести задачу из текста как есть.",
      replyMarkup: {
        inline_keyboard: [
          [{ text: "↻ Разобрать заново", callback_data: captureCallback("retry", options.updateId) }],
          [{ text: "→ Задачей как есть", callback_data: captureCallback("astask", options.updateId) }],
        ],
      },
    };
  }

  const lines: string[] = [];
  const { tasks, others } = result;

  if (tasks.length === 0) {
    lines.push(`Задач не нашёл · ${escapeHtml(result.environmentName)}`);
  } else if (tasks.length === 1) {
    lines.push(
      `✅ Задача · ${escapeHtml(result.environmentName)} · ${escapeHtml(result.columnTitle)}`,
      "",
      `<b>${escapeHtml(truncate(tasks[0].title, TITLE_LIMIT))}</b>${details(tasks[0])}`
    );
  } else {
    lines.push(
      `✅ ${tasks.length} ${plural(tasks.length, ["задача", "задачи", "задач"])} · ${escapeHtml(result.environmentName)} · ${escapeHtml(result.columnTitle)}`,
      ""
    );
    tasks.slice(0, MAX_LISTED_TASKS).forEach((task, index) => {
      lines.push(
        `${index + 1}. <b>${escapeHtml(truncate(task.title, TITLE_LIMIT))}</b>${details(task)}`
      );
    });

    // Задачи созданы все до одной, поэтому про скрытые говорим вслух: молчание
    // выглядело бы как «остальные потерялись».
    const hidden = tasks.length - MAX_LISTED_TASKS;
    if (hidden > 0) {
      lines.push(`…и ещё ${hidden} ${plural(hidden, ["задача", "задачи", "задач"])} — все на доске`);
    }
  }

  if (result.warning) {
    lines.push("", `⚠️ Часть задач сохранить не удалось: ${escapeHtml(result.warning)}`);
  }

  // Вопрос в сообщении с задачами: задачи созданы, а вопрос молча потерять
  // нельзя — иначе человек решит, что бот его прочитал и что-то нашёл.
  if (result.questions.length > 0 && tasks.length > 0) {
    lines.push(
      "",
      `Про «${escapeHtml(truncate(result.questions[0].text, 80))}» ничего не менял — ` +
        "спросите отдельным сообщением, покажу найденное с кнопками."
    );
  }

  if (others.length > 0) {
    lines.push("", "Остальное сохранил как есть — тетради и читалка появятся позже:");
    for (const item of others) {
      lines.push(`• ${KIND_LABEL[item.kind]}: ${escapeHtml(truncate(item.text, 120))}`);
    }
  }

  const card: CaptureCard = { text: prefix + lines.join("\n") };

  // Кнопка нужна там, где задач не появилось: иначе повтор наплодит дубли.
  if (tasks.length === 0) {
    card.replyMarkup = {
      inline_keyboard: [
        [{ text: "→ Задачей как есть", callback_data: captureCallback("astask", options.updateId) }],
      ],
    };
  }

  return card;
}

function details(task: CreatedTask): string {
  const parts = [
    PRIORITY_LABEL[task.priority],
    task.plannedDate ? `до ${formatShortDate(task.plannedDate)}` : "",
    task.epic ? `эпик «${escapeHtml(task.epic)}»` : "",
  ].filter(Boolean);

  return parts.length > 0 ? `\n<i>${parts.join(" · ")}</i>` : "";
}

/** «2026-08-25» → «25.08», а в другом году — «25.08.2027». */
export function formatShortDate(iso: string, today: Date = new Date()): string {
  const [year, month, day] = iso.split("-");
  const sameYear = Number(year) === today.getUTCFullYear();
  return sameYear ? `${day}.${month}` : `${day}.${month}.${year}`;
}

export function plural(count: number, forms: [string, string, string]): string {
  const mod100 = Math.abs(count) % 100;
  const mod10 = mod100 % 10;
  if (mod100 >= 11 && mod100 <= 14) return forms[2];
  if (mod10 === 1) return forms[0];
  if (mod10 >= 2 && mod10 <= 4) return forms[1];
  return forms[2];
}

function truncate(value: string, limit: number): string {
  return value.length > limit ? `${value.slice(0, limit - 1)}…` : value;
}

function reasonOf(error: unknown): string {
  const message = error instanceof Error ? error.message : "неизвестная ошибка";
  return truncate(message, 160);
}
