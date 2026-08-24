import type { CaptureBoard, CapturedItem, CapturePriority } from "@/lib/llm/capture";
import { sanitizeTitle } from "@/lib/llm/capture";
import { escapeHtml, safeCutIndex, TELEGRAM_MESSAGE_LIMIT } from "@/lib/telegram/client";

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
 * Пределы карточки.
 *
 * На всё длиннее 4096 символов Telegram отвечает 400 «message is too long» —
 * это не 429 и не ошибка разметки, поэтому ни ретрай, ни фолбэк без parse_mode
 * такую отправку не спасают: пользователь не получает ничего, хотя задачи уже
 * на доске. Значит, укладываться обязана сама карточка, а страховка в клиенте
 * остаётся тем, чем и была, — последней.
 *
 * Пределов на каждое поле для этого мало: пятнадцать заголовков у потолка дают
 * больше четырёх тысяч, да и сам потолок поля ничего не обещает — escapeHtml
 * растит «&» впятеро. Поэтому карточка собирается по бюджету: место сперва
 * занимают строки, которые видно всегда (подтверждение, предупреждение о
 * частичной записи, «…и ещё N — все на доске»), а перечисления добавляются,
 * пока влезают. Чем жертвовать, решает порядок: расшифровка стоит первой
 * строкой, подтверждение — последней, и слепая обрезка с хвоста выкинула бы
 * ровно то, ради чего пользователь сообщение и слал.
 */

/** Расшифровка голосового: показываем начало, целиком она нужна редко. */
const TRANSCRIPT_LIMIT = 600;
/** Короче — уже не цитата, а огрызок: такую расшифровку лучше не показывать. */
const TRANSCRIPT_MIN = 40;
/** Заголовок в карточке. В самой задаче он сохраняется целиком. */
const TITLE_LIMIT = 200;
/** Имя проекта, колонки, эпика — такие же пользовательские строки. */
const NAME_LIMIT = 64;
/** Текст не-задачи в списке «остального». */
const OTHER_LIMIT = 120;
/** Вопрос, который в этом сообщении остался без ответа: цитируем коротко. */
const QUESTION_LIMIT = 80;
/** Причина сбоя: чужие сообщения об ошибках бывают многословными. */
const REASON_LIMIT = 160;
/** Сколько задач перечислять поимённо; остальные считаются числом. */
const MAX_LISTED_TASKS = 15;
/** Сколько не-задач перечислять; остальные так же считаются числом. */
const MAX_LISTED_OTHERS = 5;

const ELLIPSIS = "…";
const TRANSCRIPT_OPEN = "🎤 <i>";
const TRANSCRIPT_CLOSE = "</i>\n\n";

const TASK_FORMS: [string, string, string] = ["задача", "задачи", "задач"];
const ITEM_FORMS: [string, string, string] = ["элемент", "элемента", "элементов"];

/**
 * Карточка ответа. Первая строка — подтверждение: её видно в списке чатов, не
 * открывая бота, и по ней сразу понятно, сработало или нет.
 */
export function renderCaptureCard(
  result: CaptureResult,
  options: { updateId: number; transcript?: string }
): CaptureCard {
  const card = renderBody(result, options.updateId);
  return { ...card, text: withTranscript(card.text, options.transcript) };
}

/** Карточка без расшифровки: расшифровка приписывается сверху тем, что осталось. */
function renderBody(result: CaptureResult, updateId: number): CaptureCard {
  if (result.status === "no_board") {
    return {
      text:
        "Складывать некуда: на доске нет проекта с колонками.\n" +
        "Создайте проект в приложении — и я начну класть задачи в первую колонку.",
    };
  }

  if (result.status === "failed" || result.status === "empty") {
    const first =
      result.status === "failed"
        ? `Сохранил сообщение, но не разобрал: ${field(result.reason, REASON_LIMIT)}.`
        : "Сохранил сообщение, но не понял, что с ним делать.";

    return {
      text: first + "\n\nМогу попробовать ещё раз или завести задачу из текста как есть.",
      replyMarkup: {
        inline_keyboard: [
          [{ text: "↻ Разобрать заново", callback_data: captureCallback("retry", updateId) }],
          [{ text: "→ Задачей как есть", callback_data: captureCallback("astask", updateId) }],
        ],
      },
    };
  }

  const card: CaptureCard = { text: renderCaptured(result) };

  // Кнопка нужна там, где задач не появилось: иначе повтор наплодит дубли.
  if (result.tasks.length === 0) {
    card.replyMarkup = {
      inline_keyboard: [
        [{ text: "→ Задачей как есть", callback_data: captureCallback("astask", updateId) }],
      ],
    };
  }

  return card;
}

function renderCaptured(result: Extract<CaptureResult, { status: "captured" }>): string {
  const { tasks, others } = result;
  const environment = field(result.environmentName, NAME_LIMIT);
  const column = field(result.columnTitle, NAME_LIMIT);

  const head =
    tasks.length === 0
      ? `Задач не нашёл · ${environment}`
      : tasks.length === 1
        ? `✅ Задача · ${environment} · ${column}`
        : `✅ ${tasks.length} ${plural(tasks.length, TASK_FORMS)} · ${environment} · ${column}`;

  // Про частичную запись говорим всегда: без этой строки пользователь решит,
  // что на доске лежит весь список. Место под неё занимаем сразу.
  const warning = result.warning
    ? `\n\n⚠️ Часть задач сохранить не удалось: ${field(result.warning, REASON_LIMIT)}`
    : "";

  const chunks = [head];
  let left = TELEGRAM_MESSAGE_LIMIT - head.length - warning.length;

  /** Кусок вместе с его отступом: не влез — не добавляем, бюджет не трогаем. */
  const add = (chunk: string): boolean => {
    if (chunk.length > left) return false;
    chunks.push(chunk);
    left -= chunk.length;
    return true;
  };

  if (tasks.length === 1) {
    add(`\n\n<b>${field(tasks[0].title, TITLE_LIMIT)}</b>${details(tasks[0])}`);
  } else if (tasks.length > 1) {
    // Место под «…и ещё N» занимаем до списка: задачи созданы все до одной, и
    // молчание про непоказанные выглядело бы как «остальные потерялись».
    const reserve = hiddenTasksLine(tasks.length, longestForm(TASK_FORMS)).length;
    left -= reserve;

    let shown = 0;
    for (const task of tasks.slice(0, MAX_LISTED_TASKS)) {
      const gap = shown === 0 ? "\n\n" : "\n";
      const line = `${gap}${shown + 1}. <b>${field(task.title, TITLE_LIMIT)}</b>${details(task)}`;
      if (!add(line)) break;
      shown++;
    }

    left += reserve;
    const hidden = tasks.length - shown;
    if (hidden > 0) add(hiddenTasksLine(hidden));
  }

  // Вопрос в сообщении с задачами: сам он уходит в поиск только когда задач
  // не нашлось, а здесь их создали — и промолчать про вопрос нельзя, иначе
  // человек решит, что бот его прочитал и что-то по нему нашёл. Строка идёт
  // через бюджет: подтверждение созданных задач важнее подсказки.
  if (tasks.length > 0 && result.questions.length > 0) {
    add(
      `\n\nПро «${field(result.questions[0].text, QUESTION_LIMIT)}» ничего не менял — ` +
        "спросите отдельным сообщением, покажу найденное с кнопками."
    );
  }

  if (others.length > 0) {
    let shown = 0;
    for (const item of others.slice(0, MAX_LISTED_OTHERS)) {
      // Заголовок блока идёт вместе с первым пунктом: без пунктов он ни о чём.
      const intro =
        shown === 0 ? "\n\nОстальное сохранил как есть — тетради и читалка появятся позже:" : "";
      if (!add(`${intro}\n• ${KIND_LABEL[item.kind]}: ${field(item.text, OTHER_LIMIT)}`)) break;
      shown++;
    }

    const hidden = others.length - shown;
    if (shown > 0 && hidden > 0) add(`\n…и ещё ${hidden} ${plural(hidden, ITEM_FORMS)}`);
  }

  return chunks.join("") + warning;
}

/**
 * Обещание, что непоказанные задачи всё равно на доске.
 *
 * Форма слова — отдельным параметром, чтобы место под строку можно было занять
 * заранее, ещё не зная, сколько задач не поместится: от этого числа зависит и
 * склонение, и длина строки.
 */
function hiddenTasksLine(count: number, form = plural(count, TASK_FORMS)): string {
  return `\n…и ещё ${count} ${form} — все на доске`;
}

/** Самая длинная из форм склонения: под неё и резервируется место. */
function longestForm(forms: [string, string, string]): string {
  return forms.reduce((longest, form) => (form.length > longest.length ? form : longest));
}

/**
 * Расшифровка над карточкой. Сколько её показать, решает то, что осталось от
 * лимита: она первая в сообщении и первая же под нож — подтверждение созданных
 * задач важнее цитаты из голосового.
 */
function withTranscript(body: string, transcript: string | undefined): string {
  if (!transcript) return body;

  const room =
    TELEGRAM_MESSAGE_LIMIT - body.length - TRANSCRIPT_OPEN.length - TRANSCRIPT_CLOSE.length;
  const limit = Math.min(TRANSCRIPT_LIMIT, room);
  if (limit < TRANSCRIPT_MIN) return body;

  return `${TRANSCRIPT_OPEN}${field(transcript, limit)}${TRANSCRIPT_CLOSE}${body}`;
}

function details(task: CreatedTask): string {
  const parts = [
    PRIORITY_LABEL[task.priority],
    // Срок доезжает сюда только через normalizeDate («lib/llm/capture.ts»):
    // /^\d{4}-\d{2}-\d{2}$/ плюс сверка с Date — экранировать в нём нечего.
    // Но карточка отвечает за разметку последней, а renderCaptureCard
    // экспортирована: держать её целость на валидаторе тремя слоями выше
    // дороже, чем прогнать дату через тот же field, что и всё остальное.
    task.plannedDate ? `до ${field(formatShortDate(task.plannedDate), NAME_LIMIT)}` : "",
    task.epic ? `эпик «${field(task.epic, NAME_LIMIT)}»` : "",
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

/**
 * Пользовательская строка → готовый кусок HTML не длиннее `limit`.
 *
 * Экспортируется и используется карточкой задачи: два экземпляра одного
 * правила разной аккуратности — ровно тот способ, которым ошибка с разрезанным
 * эмодзи и появилась.
 *
 * Экранируем до обрезки, а меряем после: escapeHtml растит «&» впятеро
 * («&amp;»), поэтому предел, посчитанный по сырому тексту, длину сообщения не
 * ограничивает вовсе.
 *
 * Резать готовый HTML можно не в любом месте. Разрезанная пополам сущность
 * («&am») — такая же ошибка разметки, как разрезанный тег, а половина
 * суррогатной пары вообще не UTF-8: на неё Telegram отвечает 400, которую
 * клиент не ретраит и не понижает до plain text. Тегов здесь быть не может —
 * они уже экранированы.
 */
export function field(value: string, limit: number): string {
  if (limit <= 0) return "";

  const html = escapeHtml(value);
  if (html.length <= limit) return html;

  let cut = limit - ELLIPSIS.length;

  // Каждая «&» в экранированном тексте начинает сущность, поэтому «& без ;»
  // слева от разреза значит, что разрез пришёлся внутрь неё.
  const amp = html.lastIndexOf("&", cut - 1);
  const semi = html.lastIndexOf(";", cut - 1);
  if (amp > semi) cut = amp;

  return html.slice(0, safeCutIndex(html, cut)) + ELLIPSIS;
}

/** Обрезка сырого текста — без экранирования, но по тому же законному месту. */
function truncate(value: string, limit: number): string {
  if (value.length <= limit) return value;
  return value.slice(0, safeCutIndex(value, limit - ELLIPSIS.length)) + ELLIPSIS;
}

function reasonOf(error: unknown): string {
  const message = error instanceof Error ? error.message : "неизвестная ошибка";
  return truncate(message, REASON_LIMIT);
}
