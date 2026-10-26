import { applyAgentCalls } from "@/lib/agent/apply";
import { runAgent } from "@/lib/agent/loop";
import { askJev } from "@/lib/llm/jev";
import { extractSearchQuery } from "@/lib/llm/search-query";
import { transcribeAudio } from "@/lib/llm/transcribe";
import { answerBoardQuestion } from "@/lib/telegram/ask-board";
import { buildDraft, captureTools } from "@/lib/telegram/capture-agent";
import { loadPromptBoard, type PromptBoard } from "@/lib/telegram/board-snapshot";
import { createTelegramClient, escapeHtml, type TelegramClient } from "@/lib/telegram/client";
import {
  draftSummary,
  parseCaptureContext,
  parseDraftCallback,
  parseDraftFix,
  type DraftCallback,
} from "@/lib/telegram/draft";
import {
  askWhatToCapture,
  captureDraft,
  correctDraft,
  loadDraft,
  loadOpenDraft,
  loadSnapshot,
  NO_PROJECTS,
  resendDraft,
  respondToDraftButton,
  retryCard,
  type BotBoard,
  type DraftFlowDeps,
  type MessageContext,
} from "@/lib/telegram/draft-flow";
import { field } from "@/lib/telegram/format";
import {
  asksAboutAttachment,
  attachmentMemory,
  parseAttachmentMemory,
  readInbound,
  type Inbound,
} from "@/lib/telegram/inbound";
import { unsupportedAttachmentWarning } from "@/lib/telegram/capture-agent";
import { fetchLinkPreview } from "@/lib/telegram/link-preview";
import {
  applyAwaitedInput,
  applyTaskCallback,
  expiredCard,
  isExpiredButton,
  parseAwaitInput,
  runSearch,
  type ManageDeps,
} from "@/lib/telegram/manage";
import { showCard } from "@/lib/telegram/reply";
import { decideRoute, type RouteDecision } from "@/lib/telegram/route";
import { parseTaskCallback, type TaskCallback } from "@/lib/telegram/task-card";
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
import { searchTasksByWords } from "@/lib/services/search";
import {
  completeTask,
  deleteTask,
  getTaskDetails,
  moveTaskToColumn,
  moveTaskToEnvironment,
  restoreTask,
  updateTask,
} from "@/lib/services/tasks";
import {
  cancelAwaitInput,
  cancelHandle,
  claimHandle,
  createHandle,
  findActiveHandle,
  getHandle,
  takeAwaitInput,
  updateHandle,
} from "@/lib/services/tg-handles";
import {
  getUpdate,
  markUpdateFailed,
  markUpdateProcessed,
  recordUpdate,
  type ParsedSummary,
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
 *
 * Проход сообщения: вход (`inbound.ts`) → маршрут Jev (`route.ts`) → агент
 * захвата собирает черновик (`capture-agent.ts`), и на доску он попадает
 * только по кнопке «✅ Отправить» (`draft.ts`). До неё бот пишет в базу лишь
 * журнал апдейтов и `tg_handles`.
 */

/** Зависимости приёма: журнал и белый список чатов. */
export type ReceiveUpdateDeps = {
  recordUpdate: typeof recordUpdate;
  /** Единственный разрешённый чат. Не задан — бот молчит для всех. */
  allowedChatId?: number;
};

export type { BotBoard };

type OpenDraftHint = { summary: string; createdAt: Date };

/** Зависимости обработки: Bot API, журнал, хендлы, маршрут и агенты. */
export type HandleUpdateDeps = ManageDeps & DraftFlowDeps & {
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
   * Апдейт из журнала. Кнопка «Попробовать ещё раз» восстанавливает по нему
   * исходное сообщение целиком — вместе с голосовым, у которого текста в
   * журнале нет вовсе.
   */
  loadUpdate: (updateId: number) => Promise<TelegramUpdate | null>;
  /**
   * Забирает ожидание ввода для чата. Ответ на «пришлите новое название» или
   * на «что поправить?» приходит обычным сообщением, в котором про карточку
   * нет ничего.
   */
  takeAwaitInput: (
    chatId: number
  ) => Promise<{ payload: unknown; messageId: number | null } | null>;

  readInbound: (message: TelegramMessage) => ReturnType<typeof readInbound>;
  decideRoute: (inbound: Inbound, openDraft: OpenDraftHint | null) => Promise<RouteDecision>;
  answerBoardQuestion: (
    text: string,
    input: { environmentId: string; today: string; board?: PromptBoard }
  ) => ReturnType<typeof answerBoardQuestion>;
  extractSearchQuery: (text: string) => Promise<{ query: string; done: boolean }>;
};

export type TelegramDeps = ReceiveUpdateDeps & HandleUpdateDeps;

export type ReceiveUpdateResult =
  | { status: "ignored"; reason: "no_chat" | "foreign_chat" }
  | { status: "duplicate"; chatId: number }
  | { status: "accepted"; chatId: number };

export type UpdateAction =
  | "start"
  | "help"
  | "draft"
  | "correction"
  | "confirm"
  | "intent"
  | "ask_board"
  | "find_task"
  | "smalltalk"
  | "edit"
  | "callback"
  | "unsupported";

export type HandleUpdateResult =
  | { status: "processed"; action: UpdateAction }
  | { status: "failed"; error: string };

/** Ответ обработчика: что сделали и что при этом не сложилось. */
type RespondOutcome = {
  action: UpdateAction;
  error?: string;
  parsed?: ParsedSummary;
};

const PLACEHOLDER_TEXT = "⏳ Разбираю…";
const INTERNAL_ERROR = "внутренняя ошибка";
/**
 * Столько оставляем от дедлайна функции на карточку и отметку в журнале:
 * агенты обязаны закончить раньше, иначе черновик не успеет попасть в чат.
 */
const REPLY_RESERVE_MS = 10_000;
const REASON_LIMIT = 500;

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

    await deps.markProcessed(update.update_id, outcome.parsed);
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
    // Ответ на нажатие — только чтобы погасить спиннер. Протухший query
    // («query is too old») или сбой сети не должны отменять само нажатие:
    // иначе кнопка молча ничего не делает.
    try {
      await deps.client.answerCallbackQuery({ callbackQueryId: update.callback_query.id });
    } catch (error) {
      console.warn("[telegram] answerCallbackQuery не прошёл", error);
    }
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
  if (awaited?.kind === "answered") return awaited.outcome;

  return processMessage(update.update_id, message, chatId, deps, {
    fixDraftId: awaited?.kind === "draft_fix" ? awaited.draftHandleId : undefined,
    captureContext: awaited?.kind === "capture_context" ? awaited.captureContext : undefined,
  });
}

type AwaitedInput =
  | { kind: "answered"; outcome: RespondOutcome }
  /** После «✏️ Исправить»: сообщение — поправка к этому черновику. */
  | { kind: "draft_fix"; draftHandleId: string }
  /** После «Что именно записать?»: сообщение — сама запись к этому намерению. */
  | { kind: "capture_context"; captureContext: string };

/**
 * Ответ на заданный вопрос: «пришлите новое название» или «что поправить?».
 *
 * null — ожидания не было, сообщение идёт обычным путём. Проверка стоит перед
 * моделью намеренно: ответ на заданный вопрос разбирать нечем, это готовое
 * значение поля.
 */
async function respondToAwaitedInput(
  message: TelegramMessage,
  chatId: number,
  deps: HandleUpdateDeps
): Promise<AwaitedInput | null> {
  const text = message.text?.trim();
  const audio = Boolean(message.voice ?? message.audio);

  if (!text && !audio) {
    // Картинка, файл — ответом они быть не могут, а вопрос при этом снимают:
    // иначе ожидание досталось бы следующему тексту, который к той карточке
    // уже никакого отношения не имеет.
    await deps.cancelAwaitInput(chatId);
    return null;
  }

  const pending = await deps.takeAwaitInput(chatId);
  if (!pending) return null;

  // Поправку можно надиктовать — голос здесь принимается.
  const fix = parseDraftFix(pending.payload);
  if (fix) return { kind: "draft_fix", draftHandleId: fix.draftHandleId };

  // Ответ на «что записать?» тоже можно надиктовать.
  const intent = parseCaptureContext(pending.payload);
  if (intent) return { kind: "capture_context", captureContext: intent.captureContext };

  // Новое название голосом не принимаем: ожидание уже забрано (то есть
  // погашено), а голосовое идёт обычным путём, в черновик.
  const input = parseAwaitInput(pending.payload);
  if (!input || !text) return null;

  const outcome = await applyAwaitedInput(input, text, deps);
  await showCard(chatId, pending.messageId ?? undefined, outcome.card, deps);
  return { kind: "answered", outcome: { action: "edit" } };
}

/* ── сообщение: вход → маршрут → ответ ────────────────────────────────────── */

/**
 * Основной путь. Сначала заглушка — модель отвечает секунды, и без неё
 * кажется, что бот молчит. Дальше она правится в ответ: карточку черновика,
 * ответ по доске, карточку поиска.
 *
 * Сбои модели не бросают: заглушка становится «не разобрал» с кнопкой
 * повтора, а апдейт помечается в журнале как failed.
 */
async function processMessage(
  updateId: number,
  message: TelegramMessage,
  chatId: number,
  deps: HandleUpdateDeps,
  options: { placeholderId?: number; fixDraftId?: string; captureContext?: string } = {}
): Promise<RespondOutcome> {
  const placeholderId = await showPlaceholder(chatId, options.placeholderId, deps);

  try {
    return await routeMessage(updateId, message, chatId, placeholderId, deps, options);
  } catch (error) {
    // Заглушка уже в чате: необработанное исключение оставило бы «Разбираю…»
    // висеть навсегда. Повтор берёт апдейт из журнала, так что кнопка рабочая.
    const reason = error instanceof Error ? error.message : INTERNAL_ERROR;
    try {
      await showCard(chatId, placeholderId, retryCard(updateId, INTERNAL_ERROR), deps);
    } catch {
      // Bot API недоступен — сказать нечем; апдейт всё равно помечается failed.
    }
    return { action: "draft", error: reason };
  }
}

async function routeMessage(
  updateId: number,
  message: TelegramMessage,
  chatId: number,
  placeholderId: number,
  deps: HandleUpdateDeps,
  options: { fixDraftId?: string; captureContext?: string }
): Promise<RespondOutcome> {
  const read = await deps.readInbound(message);
  if (!read.ok) {
    await showCard(chatId, placeholderId, retryCard(updateId, read.error), deps);
    return { action: "draft", error: read.error };
  }

  let inbound = read.inbound;
  if (inbound.attachments?.length && message.document) {
    await rememberAttachment(chatId, message, deps);
  } else if (!options.fixDraftId) {
    inbound = await withRecentAttachment(inbound, chatId, deps);
  }

  if (!inbound.text && !inbound.attachments?.length) {
    await showCard(
      chatId,
      placeholderId,
      {
        text: inbound.unsupportedAttachment
          ? field(unsupportedAttachmentWarning(inbound.unsupportedAttachment).replace(/^⚠️ /u, ""), REASON_LIMIT)
          : inbound.hasUnreadableMedia
            ? "Картинки и файлы пока не читаю — добавьте подпись."
            : "Пока понимаю текст, голосовые, пересылки и ссылки.",
      },
      deps
    );
    return { action: "unsupported" };
  }

  const base = (route: RouteDecision, captureContext?: string): MessageContext => ({
    updateId,
    chatId,
    placeholderId,
    inbound,
    parsed: {
      route,
      ...(inbound.transcript ? { transcript: inbound.transcript } : {}),
      ...(captureContext ? { captureContext } : {}),
    },
  });

  // «✏️ Исправить» уже сказал, что это поправка: Jev не спрашиваем.
  if (options.fixDraftId) {
    const open = await loadDraft(options.fixDraftId, deps);
    if (open) {
      return correctDraft(open, base({ route: "capture", correction: true, source: "rule" }), deps);
    }
  }

  // Ответ на «что записать?»: это запись, Jev не спрашиваем. Агент видит
  // объявленное намерение контекстом — эпик из него, заголовок из ответа.
  if (options.captureContext) {
    return captureDraft(
      {
        ...base({ route: "capture", correction: false, source: "rule" }, options.captureContext),
        captureContext: options.captureContext,
      },
      deps
    );
  }

  const open = await loadOpenDraft(chatId, deps);
  const route = await deps.decideRoute(
    inbound,
    open ? { summary: draftSummary(open.draft), createdAt: new Date(open.draft.createdAt) } : null
  );
  const context = base(route);

  // «Отправляй» — черновик заново внизу чата, с кнопками. Ничего не применяется.
  if (route.confirm) return resendDraft(open, context, deps);

  // Поправка без открытого черновика (его уже отправили или отменили) —
  // обычная новая запись: править нечего.
  if (route.correction && open) return correctDraft(open, context, deps);

  // «Хочу создать задачу» без самого дела: агента не зовём, спрашиваем, что записать.
  if (route.intentOnly) return askWhatToCapture(context, deps);

  switch (route.route) {
    case "capture":
    case "forward":
      // Открытый черновик остаётся как есть: его кнопки работают до срока.
      return captureDraft(context, deps);
    case "ask_board":
      return askBoard(context, deps);
    case "find_task":
      return findTask(context, deps);
    case "smalltalk":
      await showCard(chatId, placeholderId, { text: helpText() }, deps);
      return { action: "smalltalk", parsed: context.parsed };
  }
}

/**
 * Текстовый файл прочитан — помним его 15 минут: следующее сообщение может
 * быть «проанализируй файл». Сбой базы здесь не мешает разобрать сам файл.
 */
async function rememberAttachment(
  chatId: number,
  message: TelegramMessage,
  deps: HandleUpdateDeps
): Promise<void> {
  try {
    await deps.createHandle({
      kind: "attachment",
      payload: attachmentMemory(message.document!),
      chatId,
      // Срок — 15 минут, по виду хендла (ttlMinutesFor).
    });
  } catch (error) {
    console.warn("[telegram] не запомнил вложение", error);
  }
}

/**
 * «Проанализируй файлы, выцепи оттуда задачи» сразу после файла: в самом
 * сообщении файла нет, поэтому перечитываем последний текстовый файл чата
 * (хендл `attachment`, 15 минут) и разбираем его с этим сообщением как
 * подписью. Файла нет или он не перечитался — сообщение идёт как есть.
 */
async function withRecentAttachment(
  inbound: Inbound,
  chatId: number,
  deps: HandleUpdateDeps
): Promise<Inbound> {
  if (inbound.attachments?.length || !asksAboutAttachment(inbound.text)) return inbound;
  try {
    const handle = await deps.findActiveHandle(chatId, "attachment");
    const document = handle ? parseAttachmentMemory(handle.payload) : null;
    if (!document) return inbound;
    const reread = await deps.readInbound({
      message_id: 0,
      date: 0,
      chat: { id: chatId, type: "private" },
      document,
    });
    if (!reread.ok || !reread.inbound.attachments?.length) return inbound;
    return { ...inbound, attachments: reread.inbound.attachments };
  } catch (error) {
    console.warn("[telegram] не перечитал вложение", error);
    return inbound;
  }
}

/** Вопрос о доске: агент только с читающими инструментами, ответ — текстом. */
async function askBoard(context: MessageContext, deps: HandleUpdateDeps): Promise<RespondOutcome> {
  const { chatId, placeholderId } = context;

  const board = await deps.loadBoard();
  if (!board) {
    await showCard(chatId, placeholderId, { text: NO_PROJECTS }, deps);
    return { action: "ask_board", parsed: context.parsed };
  }

  const snapshot = await loadSnapshot(board.environment.id, deps);
  const answer = await deps.answerBoardQuestion(context.inbound.text, {
    environmentId: board.environment.id,
    today: deps.today(),
    ...(snapshot ? { board: snapshot } : {}),
  });
  if (!answer.ok) {
    await showCard(
      chatId,
      placeholderId,
      { text: `Не получилось ответить: ${field(answer.error, REASON_LIMIT)}` },
      deps
    );
    return { action: "ask_board", error: answer.error, parsed: context.parsed };
  }

  await showCard(chatId, placeholderId, { text: answer.html }, deps);
  return { action: "ask_board", parsed: context.parsed };
}

/**
 * Про одну задачу: найти → показать → нажать кнопку. Закрыть или перенести по
 * фразе бот не может — только показать карточку с кнопками.
 */
async function findTask(context: MessageContext, deps: HandleUpdateDeps): Promise<RespondOutcome> {
  const { query, done } = await deps.extractSearchQuery(context.inbound.text);
  const outcome = await runSearch({ query, chatId: context.chatId, looksDone: done }, deps);
  await showCard(context.chatId, context.placeholderId, outcome.card, deps);
  return { action: "find_task", parsed: { ...context.parsed, query } };
}

/* ── кнопки ───────────────────────────────────────────────────────────────── */

async function respondToCallback(
  query: NonNullable<TelegramUpdate["callback_query"]>,
  chatId: number,
  deps: HandleUpdateDeps
): Promise<RespondOutcome> {
  const action = parseTaskCallback(query.data);
  if (action) return respondToTaskCallback(action, query, chatId, deps);

  const pressed = parseDraftCallback(query.data);
  if (pressed) return respondToDraftCallback(pressed, query, chatId, deps);

  await deps.client.sendMessage({
    chatId,
    text:
      "Эта кнопка мне незнакома — возможно, она из старой версии бота.\n" +
      "Пришлите сообщение заново или напишите, например, «найди задачу про вэд».",
  });
  return { action: "callback" };
}

/**
 * Кнопки черновика. «Попробовать ещё раз» заново проводит сообщение из
 * журнала; «Отправить», «Исправить» и «Отмена» — в `draft-flow.ts`.
 */
async function respondToDraftCallback(
  pressed: DraftCallback,
  query: NonNullable<TelegramUpdate["callback_query"]>,
  chatId: number,
  deps: HandleUpdateDeps
): Promise<RespondOutcome> {
  const messageId = query.message?.message_id;

  if (pressed.action === "retry") {
    const stored = await deps.loadUpdate(pressed.updateId);
    const message = stored ? updateMessage(stored) : undefined;
    if (!message) {
      await deps.client.sendMessage({
        chatId,
        text: "Не нашёл исходное сообщение в журнале — пришлите его ещё раз.",
      });
      return { action: "callback" };
    }
    // Повтор идёт в той же карточке: она снова становится заглушкой.
    return processMessage(pressed.updateId, message, chatId, deps, { placeholderId: messageId });
  }

  return respondToDraftButton(pressed, query.message, chatId, deps);
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

/* ── сообщения ────────────────────────────────────────────────────────────── */

/** Заглушка: новым сообщением или (при повторе) правкой той же карточки. */
async function showPlaceholder(
  chatId: number,
  messageId: number | undefined,
  deps: HandleUpdateDeps
): Promise<number> {
  if (messageId !== undefined) {
    await showCard(chatId, messageId, { text: PLACEHOLDER_TEXT }, deps);
    return messageId;
  }
  const sent = await deps.client.sendMessage({ chatId, text: PLACEHOLDER_TEXT });
  return sent.message_id;
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
      (board.columns[0] ? `, новые задачи кладу в «${escapeHtml(board.columns[0].title)}»` : "")
    : NO_PROJECTS;

  return [
    "Привет! Я записываю дела и мысли в Constance.",
    "",
    project,
    "",
    "Присылайте что угодно — текст, голосовое, пересылку, ссылку. Я покажу черновик:",
    "задачи, подзадачи, заметки. На доску ничего не попадёт, пока не нажмёте «Отправить»;",
    "«Исправить» — поправить словами или голосом.",
    "",
    "Спросите «что у меня на сегодня» — отвечу по доске.",
    "«найди задачу про слайды» — покажу задачу с кнопками. Закрываю только по нажатию.",
  ].join("\n");
}

function helpText(): string {
  return [
    "Команды:",
    ...BOT_COMMANDS.map((c) => `/${c.command} — ${c.description}`),
    "",
    "Текст, голосовое, пересылка или ссылка → черновик с кнопками",
    "«Отправить», «Исправить», «Отмена». Без «Отправить» ничего не пишу.",
    "",
    "«что у меня на сегодня» — отвечу по доске.",
    "«найди задачу про …» — покажу задачу с кнопками.",
  ].join("\n");
}

/**
 * «Сегодня» для агентов бота — по Москве, где живёт владелец. Сервер в UTC, и
 * с полуночи до трёх ночи «на сегодня» и «до завтра» считались бы от вчера.
 */
export function botToday(now: Date = new Date()): string {
  // en-CA форматирует дату как YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Разрешённый чат из окружения. Не задан или мусор — бот молчит для всех. */
export function allowedChatIdFromEnv(): number | undefined {
  const raw = process.env.TELEGRAM_ALLOWED_CHAT_ID;
  if (!raw) return undefined;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

/** Активная среда бота: первая по позиции. */
export async function loadBotBoard(): Promise<BotBoard | null> {
  const environments = await getEnvironments();
  const environment = environments[0];
  if (!environment) return null;

  const columns = await getColumns(environment.id);
  return {
    environment: { id: environment.id, name: environment.name },
    columns: columns.map((c) => ({ id: c.id, title: c.title })),
  };
}

/**
 * Зависимости по умолчанию — настоящие клиент, база и модели.
 *
 * deadlineAt — момент, когда платформа убьёт функцию: клиент Bot API не станет
 * ждать флуд-лимит дольше, чем ей осталось жить. Клиент создаётся на запрос,
 * а не берётся из синглтона, именно из-за этого: дедлайн у каждого свой.
 * Агенты захвата и вопроса к доске получают тот же дедлайн минус запас на
 * ответ: не успели — отдают успетое, а не умирают вместе с функцией.
 */
export function defaultDeps(options: { deadlineAt?: number } = {}): TelegramDeps {
  const client = createTelegramClient({ deadlineAt: options.deadlineAt });
  const agentDeadlineAt =
    options.deadlineAt === undefined ? undefined : options.deadlineAt - REPLY_RESERVE_MS;

  return {
    client,
    recordUpdate,
    markProcessed: markUpdateProcessed,
    markFailed: markUpdateFailed,
    loadUpdate: async (updateId) => {
      const row = await getUpdate(updateId);
      return (row?.payload as TelegramUpdate | undefined) ?? null;
    },
    loadBoard: loadBotBoard,
    loadBoardSnapshot: (environmentId) => loadPromptBoard(environmentId),
    allowedChatId: allowedChatIdFromEnv(),

    // Проход сообщения: вход → маршрут → черновик / ответ / поиск.
    readInbound: (message) =>
      readInbound(message, {
        client,
        transcribe: (file) => transcribeAudio(file),
        fetchPreview: (url) => fetchLinkPreview(url),
      }),
    decideRoute: (inbound, openDraft) => decideRoute(inbound, openDraft, { askJev }),
    buildDraft: (input) => buildDraft(input, { runAgent, deadlineAt: agentDeadlineAt }),
    answerBoardQuestion: (text, input) =>
      answerBoardQuestion(text, input, { runAgent, deadlineAt: agentDeadlineAt }),
    extractSearchQuery: (text) => extractSearchQuery(text),
    // Тот же набор, что был у агента захвата: подменённый или устаревший
    // payload не исполнит инструмент, которого агенту не выдавали.
    applyCalls: (calls) => applyAgentCalls(calls, captureTools()),
    findActiveHandle: (chatId, kind) => findActiveHandle(chatId, kind),
    updateHandle: (id, patch) => updateHandle(id, patch),
    claimHandle: (id) => claimHandle(id),
    cancelHandle: (id) => cancelHandle(id),
    today: () => botToday(),

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
    searchTasks: (query, limit) => searchTasksByWords(query, { limit }),
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
