import { captureItems as captureItemsWithModel } from "@/lib/llm/capture";
import { transcribeAudio, voiceFile, TRANSCRIBE_MAX_BYTES } from "@/lib/llm/transcribe";
import {
  captureCallback,
  captureMessage,
  createTaskFromText,
  parseCaptureCallback,
  renderCaptureCard,
  type CaptureBoardData,
  type CaptureDeps,
  type CaptureResult,
} from "@/lib/telegram/capture";
import { createTelegramClient, escapeHtml, TelegramApiError, type TelegramClient } from "@/lib/telegram/client";
import {
  applyAwaitedInput,
  applyTaskCallback,
  expiredCard,
  isExpiredButton,
  parseAwaitInput,
  runSearch,
  type ManageDeps,
} from "@/lib/telegram/manage";
import {
  parseTaskCallback,
  type TaskCallback,
  type TaskCard,
} from "@/lib/telegram/task-card";
import { BOT_COMMANDS } from "@/lib/telegram/commands";
import {
  updateChatId,
  updateMessage,
  updateText,
  type TelegramMessage,
  type TelegramUpdate,
} from "@/lib/telegram/types";
import { createCategory, getCategories } from "@/lib/services/categories";
import { getColumns } from "@/lib/services/columns";
import { getEnvironments } from "@/lib/services/environments";
import { searchTasks } from "@/lib/services/search";
import {
  completeTask,
  createTask,
  deleteTask,
  getTaskDetails,
  moveTaskToColumn,
  moveTaskToEnvironment,
  restoreTask,
  updateTask,
} from "@/lib/services/tasks";
import {
  cancelAwaitInput,
  createHandle,
  getHandle,
  takeAwaitInput,
} from "@/lib/services/tg-handles";
import {
  getUpdate,
  markUpdateFailed,
  markUpdateProcessed,
  recordUpdate,
} from "@/lib/services/tg-updates";

/**
 * Приём и обработка апдейта. Живут отдельно от роута намеренно: роут — шим
 * вокруг after(), который в тестах не исполняется, а логика должна быть
 * проверяема.
 *
 * Приём (фильтр чужих чатов и запись в журнал) и обработка разведены не по
 * вкусу, а по времени жизни: приём обязан завершиться ДО ответа 200, потому
 * что с этого момента Telegram считает апдейт доставленным и не повторит его;
 * обработка идёт после ответа, в after().
 */

/** Зависимости приёма: журнал и белый список чатов. */
export type ReceiveUpdateDeps = {
  recordUpdate: typeof recordUpdate;
  /** Единственный разрешённый чат. Не задан — бот молчит для всех. */
  allowedChatId?: number;
};

/** Зависимости обработки: Bot API, отметки в журнале, доска и модель. */
export type HandleUpdateDeps = CaptureDeps & ManageDeps & {
  client: Pick<
    TelegramClient,
    | "sendMessage"
    | "editMessageText"
    | "answerCallbackQuery"
    | "getFile"
    | "downloadFile"
  >;
  markProcessed: typeof markUpdateProcessed;
  markFailed: typeof markUpdateFailed;
  /**
   * Апдейт из журнала. Кнопка «разобрать заново» восстанавливает по нему
   * исходное сообщение целиком — вместе с голосовым, у которого текста в
   * журнале нет вовсе.
   */
  loadUpdate: (updateId: number) => Promise<TelegramUpdate | null>;
  transcribe: (file: File) => Promise<string>;
  /**
   * Забирает ожидание ввода для чата. Ответ на «пришлите новое название»
   * приходит обычным сообщением, в котором про карточку нет ничего.
   */
  takeAwaitInput: (
    chatId: number
  ) => Promise<{ payload: unknown; messageId: number | null } | null>;
};

export type TelegramDeps = ReceiveUpdateDeps & HandleUpdateDeps;

export type ReceiveUpdateResult =
  | { status: "ignored"; reason: "no_chat" | "foreign_chat" }
  | { status: "duplicate"; chatId: number }
  | { status: "accepted"; chatId: number };

export type UpdateAction =
  | "start"
  | "help"
  | "capture"
  | "search"
  | "edit"
  | "voice"
  | "callback"
  | "unsupported";

export type HandleUpdateResult =
  | { status: "processed"; action: UpdateAction }
  | { status: "failed"; error: string };

/** Ответ обработчика: что сделали и что при этом не сложилось. */
type RespondOutcome = { action: UpdateAction; error?: string };

/** Bot API не отдаёт файлы больше 20 МБ, сколько бы Whisper ни принимал. */
const TELEGRAM_FILE_LIMIT = 20 * 1024 * 1024;

/**
 * Приём апдейта: зовётся из тела роута до ответа 200.
 *
 * accepted — апдейт наш и записан впервые, его нужно обработать; duplicate —
 * Telegram доставил его повторно, работать по нему нельзя; ignored — чужой
 * чат, ни записи, ни ответа (не-2xx здесь вызвал бы сутки ретраев, поэтому
 * роут всё равно отвечает 200 — молчание и есть реакция).
 */
export async function receiveUpdate(
  update: TelegramUpdate,
  deps: ReceiveUpdateDeps
): Promise<ReceiveUpdateResult> {
  const chatId = updateChatId(update);
  if (chatId === undefined) return { status: "ignored", reason: "no_chat" };

  if (deps.allowedChatId === undefined || chatId !== deps.allowedChatId) {
    return { status: "ignored", reason: "foreign_chat" };
  }

  const isNew = await deps.recordUpdate({
    updateId: update.update_id,
    chatId,
    rawText: updateText(update),
    payload: update,
  });

  return isNew ? { status: "accepted", chatId } : { status: "duplicate", chatId };
}

/**
 * Обработка принятого апдейта: ответ пользователю и отметка в журнале.
 * chatId приходит из receiveUpdate — он уже проверен по белому списку.
 */
export async function handleUpdate(
  update: TelegramUpdate,
  chatId: number,
  deps: HandleUpdateDeps
): Promise<HandleUpdateResult> {
  try {
    const outcome = await respond(update, chatId, deps);

    // Пользователю ответили, но разбор не удался: в журнале это failed с
    // причиной, иначе сбои модели видно только в чате.
    if (outcome.error) {
      await deps.markFailed(update.update_id, outcome.error);
      return { status: "failed", error: outcome.error };
    }

    await deps.markProcessed(update.update_id);
    return { status: "processed", action: outcome.action };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Внутренняя ошибка";
    await deps.markFailed(update.update_id, message);
    return { status: "failed", error: message };
  }
}

async function respond(
  update: TelegramUpdate,
  chatId: number,
  deps: HandleUpdateDeps
): Promise<RespondOutcome> {
  // Спиннер на кнопке протухает за ~10 секунд, поэтому отвечаем первым делом:
  // до базы, до модели, до правки сообщения.
  if (update.callback_query) {
    await deps.client.answerCallbackQuery({ callbackQueryId: update.callback_query.id });
    return respondToCallback(update.callback_query, chatId, deps);
  }

  const message = updateMessage(update);
  const command = parseCommand(message?.text);

  // Любая команда обрывает начатый вопрос: «/start» — это уже другое действие,
  // и текст после него ушёл бы в название задачи вместо новой записи на доску.
  // Проверка на все команды, а не на две известные: незнакомая команда — тем
  // более не ответ на «пришлите новое название».
  if (command) await deps.cancelAwaitInput(chatId);

  if (command === "start" || command === "help") {
    const text = command === "start" ? await startText(deps) : helpText();
    await deps.client.sendMessage({ chatId, text });
    return { action: command };
  }

  if (!message) return { action: "unsupported" };

  const awaited = await respondToAwaitedInput(message, chatId, deps);
  if (awaited) return awaited;

  return capture(update.update_id, message, chatId, deps);
}

/**
 * Ответ на «пришлите новое название следующим сообщением».
 *
 * null — ожидания не было, сообщение идёт обычным путём в захват. Проверка
 * стоит перед моделью намеренно: ответ на заданный вопрос разбирать нечем,
 * это готовое значение поля.
 */
async function respondToAwaitedInput(
  message: TelegramMessage,
  chatId: number,
  deps: HandleUpdateDeps
): Promise<RespondOutcome | null> {
  const text = message.text?.trim();
  if (!text) {
    // Голосовое, картинка, пересылка — ответом на «пришлите новое название»
    // они быть не могут, а вопрос при этом снимают: иначе ожидание досталось бы
    // следующему тексту, который к той карточке уже никакого отношения не имеет.
    await deps.cancelAwaitInput(chatId);
    return null;
  }

  const pending = await deps.takeAwaitInput(chatId);
  if (!pending) return null;

  const input = parseAwaitInput(pending.payload);
  if (!input) return null;

  const outcome = await applyAwaitedInput(input, text, deps);
  await showCard(chatId, pending.messageId ?? undefined, outcome.card, deps);
  return { action: "edit" };
}

/**
 * Основной путь: текст или голосовое → задачи на доске.
 *
 * Разбор не бросает: модель может не ответить, и тогда пользователь получает
 * карточку «сохранил, но не разобрал» с кнопкой повтора, а апдейт помечается
 * в журнале как failed.
 */
async function capture(
  updateId: number,
  message: TelegramMessage,
  chatId: number,
  deps: HandleUpdateDeps
): Promise<RespondOutcome> {
  const read = await readMessage(message, deps);

  if (read.error) {
    await sendRetryCard(chatId, updateId, read.error, deps);
    return { action: "voice", error: read.error };
  }

  if (!read.text) {
    await deps.client.sendMessage({
      chatId,
      text:
        "Пока понимаю только текст и голосовые.\n" +
        "Сообщение сохранено — картинки, файлы и пересылки разберу позже.",
    });
    return { action: "unsupported" };
  }

  const result = await captureMessage(read.text, deps);

  /*
   * Вопрос и рассказ о сделанном уводят в поиск, а не в создание.
   * «ответил по вэду» обязано показать существующую задачу с кнопкой: завести
   * из этой фразы вторую такую же — значит насорить на доске ровно там, где
   * человек хотел прибраться. Закрывает задачу всё равно кнопка, а не фраза.
   */
  if (result.status === "captured" && result.tasks.length === 0) {
    const question = result.questions[0];
    if (question) {
      const outcome = await runSearch(
        {
          query: question.text,
          chatId,
          looksDone: question.done,
          // «Нет, это новая задача» — та же кнопка, что и у карточки захвата:
          // она заводит задачу из исходного текста без разбора.
          createAnywayCallback: captureCallback("astask", updateId),
        },
        deps
      );
      await showCard(chatId, undefined, outcome.card, deps);
      return { action: "search", error: failureReason(result) };
    }
  }

  const card = renderCaptureCard(result, { updateId, transcript: read.transcript });
  await deps.client.sendMessage({
    chatId,
    text: card.text,
    replyMarkup: card.replyMarkup,
  });

  return {
    action: read.transcript ? "voice" : "capture",
    error: failureReason(result),
  };
}

async function respondToCallback(
  query: NonNullable<TelegramUpdate["callback_query"]>,
  chatId: number,
  deps: HandleUpdateDeps
): Promise<RespondOutcome> {
  const action = parseTaskCallback(query.data);
  if (action) return respondToTaskCallback(action, query, chatId, deps);

  const pressed = parseCaptureCallback(query.data);

  if (!pressed) {
    await deps.client.sendMessage({
      chatId,
      text:
        "Эта кнопка мне незнакома — возможно, она из старой версии бота.\n" +
        "Найдите задачу заново: напишите, например, «найди задачи по вэду».",
    });
    return { action: "callback" };
  }

  const stored = await deps.loadUpdate(pressed.updateId);
  const message = stored ? updateMessage(stored) : undefined;

  if (!message) {
    await deps.client.sendMessage({
      chatId,
      text: "Не нашёл исходное сообщение в журнале — пришлите его ещё раз.",
    });
    return { action: "callback" };
  }

  if (pressed.action === "retry") {
    const outcome = await capture(pressed.updateId, message, chatId, deps);
    return { ...outcome, action: "callback" };
  }

  // «Задачей как есть»: разбор пропускается целиком, в заголовок идёт текст
  // сообщения. Для голосового его всё же приходится расшифровать.
  const read = await readMessage(message, deps);
  if (read.error || !read.text) {
    const reason = read.error ?? "в сообщении нет текста";
    await sendRetryCard(chatId, pressed.updateId, reason, deps);
    return { action: "callback", error: read.error };
  }

  const result = await createTaskFromText(read.text, deps);
  const card = renderCaptureCard(result, {
    updateId: pressed.updateId,
    transcript: read.transcript,
  });
  await deps.client.sendMessage({
    chatId,
    text: card.text,
    replyMarkup: card.replyMarkup,
  });

  return { action: "callback", error: failureReason(result) };
}

/**
 * Нажатие на карточке задачи.
 *
 * Подменю и результат правки уходят в ТО ЖЕ сообщение: серия новых сообщений
 * на каждый тап забивает чат, а Telegram пускает в него одно сообщение в
 * секунду — правка ещё и быстрее.
 */
async function respondToTaskCallback(
  action: TaskCallback,
  query: NonNullable<TelegramUpdate["callback_query"]>,
  chatId: number,
  deps: HandleUpdateDeps
): Promise<RespondOutcome> {
  // Пустая клетка календаря: спиннер уже погашен, делать больше нечего.
  if (action.kind === "noop") return { action: "callback" };

  const messageId = query.message?.message_id;
  const now = deps.now?.() ?? new Date();

  // Инлайн-кнопки не исчезают сами. Нажатие на карточке месячной давности не
  // должно ничего менять: показываем это прямо и снимаем клавиатуру, чтобы
  // мёртвых кнопок в чате не осталось.
  if (isExpiredButton(query.message, now)) {
    await showCard(chatId, messageId, expiredCard(), deps);
    return { action: "callback" };
  }

  const outcome = await applyTaskCallback(action, { chatId, messageId }, deps);
  await showCard(chatId, messageId, outcome.card, deps);
  return { action: "callback" };
}

/**
 * Показать карточку: правкой сообщения, если известно какого, иначе новым.
 *
 * Отсутствие `reply_markup` в editMessageText снимает клавиатуру — на этом
 * держится снятие кнопок у удалённой задачи и у протухшего сообщения.
 */
async function showCard(
  chatId: number,
  messageId: number | undefined,
  card: TaskCard,
  deps: HandleUpdateDeps
): Promise<void> {
  if (messageId === undefined) {
    await deps.client.sendMessage({
      chatId,
      text: card.text,
      replyMarkup: card.replyMarkup,
    });
    return;
  }

  try {
    await deps.client.editMessageText({
      chatId,
      messageId,
      text: card.text,
      replyMarkup: card.replyMarkup,
    });
  } catch (error) {
    // «Message is not modified» — не сбой: пользователь нажал кнопку,
    // которая ничего не изменила. Ронять из-за неё обработку апдейта нельзя.
    if (!isNotModified(error)) throw error;
  }
}

function isNotModified(error: unknown): boolean {
  return (
    error instanceof TelegramApiError &&
    error.status === 400 &&
    /message is not modified/i.test(error.description)
  );
}

/** Текст сообщения: у голосового — расшифровка, у остального — text или caption. */
async function readMessage(
  message: TelegramMessage,
  deps: HandleUpdateDeps
): Promise<{ text?: string; transcript?: string; error?: string }> {
  const voice = message.voice;
  if (!voice) {
    const text = (message.text ?? message.caption)?.trim();
    return { text: text || undefined };
  }

  if (voice.file_size !== undefined && voice.file_size > TELEGRAM_FILE_LIMIT) {
    return { error: "голосовое длиннее 20 МБ — столько Telegram скачать не даёт" };
  }

  try {
    const file = await deps.client.getFile(voice.file_id);
    if (!file.file_path) return { error: "Telegram не отдал путь к файлу" };

    const bytes = await deps.client.downloadFile(file.file_path);
    if (bytes.byteLength > TRANSCRIBE_MAX_BYTES) {
      return { error: "голосовое слишком большое для расшифровки" };
    }

    // Имя файла обязательно: Whisper определяет контейнер по расширению,
    // безымянный Blob получает 400 «could not process file».
    const transcript = (await deps.transcribe(voiceFile(bytes))).trim();
    if (!transcript) return { error: "в голосовом не разобрал ни слова" };

    return { text: transcript, transcript };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "не смог расшифровать голосовое" };
  }
}

async function sendRetryCard(
  chatId: number,
  updateId: number,
  reason: string,
  deps: HandleUpdateDeps
): Promise<void> {
  await deps.client.sendMessage({
    chatId,
    text: `Сохранил сообщение, но не разобрал: ${escapeHtml(reason)}.`,
    replyMarkup: {
      inline_keyboard: [
        [{ text: "↻ Попробовать ещё раз", callback_data: captureCallback("retry", updateId) }],
      ],
    },
  });
}

/** Причина, из-за которой апдейт нужно пометить в журнале как failed. */
function failureReason(result: CaptureResult): string | undefined {
  if (result.status === "failed") return result.reason;
  if (result.status === "captured") return result.warning;
  return undefined;
}

/** «/start@constance_bot arg» → «start». Не команда — undefined. */
export function parseCommand(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const match = /^\/([a-z_]+)(?:@[\w]+)?(?:\s|$)/i.exec(text.trim());
  return match?.[1].toLowerCase();
}

async function startText(deps: HandleUpdateDeps): Promise<string> {
  const board = await deps.loadBoard();
  const project = board
    ? `Активный проект: <b>${escapeHtml(board.environment.name)}</b>` +
      (board.columns[0] ? `, задачи кладу в «${escapeHtml(board.columns[0].title)}»` : "")
    : "Проектов пока нет — создайте первый на доске.";

  return [
    "Привет! Я складываю задачи в Constance.",
    "",
    project,
    "",
    "Пришлите текст или голосовое — разберу на задачи и положу на доску.",
    "Несколько дел в одном сообщении — несколько задач; срок и «срочно» понимаю.",
    "",
    "Спросите «найди задачи по вэду» — покажу найденное с кнопками:",
    "закрыть, поставить срок, сменить эпик, приоритет, колонку или проект.",
    "Сам я задачи не закрываю: только по нажатию кнопки.",
  ].join("\n");
}

function helpText(): string {
  return [
    "Команды:",
    ...BOT_COMMANDS.map((c) => `/${c.command} — ${c.description}`),
    "",
    "Обычное сообщение или голосовое я разбираю на задачи сам.",
    "Примеры: «сходить к суровцеву, заполнить итмо» — две задачи;",
    "«контроль за ВШЭ кейсы до 25.08» — задача со сроком.",
    "",
    "«найди задачи по вэду» — покажу найденное с кнопками.",
    "«ответил по вэду» — тоже поиск: закрою только по нажатию кнопки.",
  ].join("\n");
}

/** Разрешённый чат из окружения. Не задан или мусор — бот молчит для всех. */
export function allowedChatIdFromEnv(): number | undefined {
  const raw = process.env.TELEGRAM_ALLOWED_CHAT_ID;
  if (!raw) return undefined;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

/**
 * Доска для захвата. Активной средой у бота считается первая по позиции:
 * cookie с выбранной средой есть только у браузера.
 */
export async function loadCaptureBoard(): Promise<CaptureBoardData | null> {
  const environments = await getEnvironments();
  const environment = environments[0];
  if (!environment) return null;

  const [columns, epics] = await Promise.all([
    getColumns(environment.id),
    getCategories(environment.id),
  ]);

  return {
    environment: { id: environment.id, name: environment.name },
    environmentNames: environments.map((e) => e.name),
    columns: columns.map((c) => ({ id: c.id, title: c.title })),
    epics: epics.map((e) => ({ id: e.id, name: e.name })),
  };
}

/**
 * Зависимости по умолчанию — настоящие клиент, база и настройки.
 *
 * deadlineAt — момент, когда платформа убьёт функцию: клиент Bot API не станет
 * ждать флуд-лимит дольше, чем ей осталось жить. Клиент создаётся на запрос,
 * а не берётся из синглтона, именно из-за этого: дедлайн у каждого свой.
 */
export function defaultDeps(options: { deadlineAt?: number } = {}): TelegramDeps {
  return {
    client: createTelegramClient({ deadlineAt: options.deadlineAt }),
    recordUpdate,
    markProcessed: markUpdateProcessed,
    markFailed: markUpdateFailed,
    loadUpdate: async (updateId) => {
      const row = await getUpdate(updateId);
      return (row?.payload as TelegramUpdate | undefined) ?? null;
    },
    loadBoard: loadCaptureBoard,
    captureItems: (text, board) => captureItemsWithModel({ text, board }),
    createTask: (input) => createTask(input),
    transcribe: (file) => transcribeAudio(file),
    allowedChatId: allowedChatIdFromEnv(),

    // Управление задачами: найти → показать → нажать кнопку.
    getTask: (taskId) => getTaskDetails(taskId),
    listEpics: async (environmentId) =>
      (await getCategories(environmentId)).map((epic) => ({ id: epic.id, name: epic.name })),
    listColumns: async (environmentId) =>
      (await getColumns(environmentId)).map((column) => ({
        id: column.id,
        title: column.title,
      })),
    listEnvironments: async () =>
      (await getEnvironments()).map((environment) => ({
        id: environment.id,
        name: environment.name,
      })),
    searchTasks: (query, limit) => searchTasks(query, { limit }),
    completeTask: (taskId) => completeTask(taskId),
    restoreTask: (taskId) => restoreTask(taskId),
    updateTask: (taskId, patch) => updateTask(taskId, patch),
    deleteTask: (taskId) => deleteTask(taskId),
    moveTaskToColumn: (taskId, columnId) => moveTaskToColumn(taskId, columnId),
    moveTaskToEnvironment: (taskId, environmentId) =>
      moveTaskToEnvironment(taskId, environmentId),
    createEpic: (name, environmentId) => createCategory(name, undefined, environmentId),
    createHandle: (input) => createHandle(input),
    getHandle: (id) => getHandle(id),
    cancelAwaitInput: (chatId) => cancelAwaitInput(chatId),
    takeAwaitInput: (chatId) => takeAwaitInput(chatId),
    boardUrl: boardUrlFromEnv(),
  };
}

/**
 * Корень приложения для кнопки «Открыть на доске».
 *
 * На Vercel адрес известен из окружения, локально задаётся явно. Ничего не
 * нашли — кнопки не будет: ссылка «в никуда» хуже её отсутствия.
 */
export function boardUrlFromEnv(): string | undefined {
  const raw =
    process.env.APP_BASE_URL ??
    process.env.NEXT_PUBLIC_APP_URL ??
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : undefined);
  if (!raw) return undefined;

  try {
    return new URL(raw).origin;
  } catch {
    return undefined;
  }
}
