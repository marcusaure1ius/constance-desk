import type { DeferredCall } from "@/lib/agent/apply";
import type { ToolOutcome } from "@/lib/agent/tool-registry";
import type { BuildDraftInput, BuildDraftResult } from "@/lib/telegram/capture-agent";
import type { PromptBoard } from "@/lib/telegram/board-snapshot";
import {
  captureContextPayload,
  draftCallback,
  findMentionedEpic,
  intentQuestion,
  parseDraftPayload,
  renderAppliedCard,
  renderClosedCard,
  renderDraftCard,
  type DraftPayload,
} from "@/lib/telegram/draft";
import { clampMessageText } from "@/lib/telegram/client";
import { field } from "@/lib/telegram/format";
import type { Inbound } from "@/lib/telegram/inbound";
import { isExpiredButton, type ManageDeps } from "@/lib/telegram/manage";
import { showCard, tryEdit, type ReplyDeps } from "@/lib/telegram/reply";
import type { RouteDecision } from "@/lib/telegram/route";
import type { TaskCard } from "@/lib/telegram/task-card";
import type { TelegramMessage } from "@/lib/telegram/types";
import type { StoredHandle } from "@/lib/services/tg-handles";

/**
 * Поток черновика: новая запись → черновик в `tg_handles` и карточка;
 * поправка → тот же черновик заново и та же карточка; кнопки «Отправить»,
 * «Исправить», «Отмена». До «Отправить» на доску не пишется ничего — агент
 * работает с `deferAll`, а вызовы лежат в payload хендла.
 */

/**
 * Активная среда бота и её колонки. Активной считается первая по позиции:
 * cookie с выбранной средой есть только у браузера.
 */
export type BotBoard = {
  environment: { id: string; name: string };
  columns: { id: string; title: string }[];
};

export type DraftFlowDeps = ReplyDeps &
  Pick<
    ManageDeps,
    "createHandle" | "getHandle" | "cancelAwaitInput" | "now" | "listEpics" | "listEnvironments"
  > & {
    loadBoard: () => Promise<BotBoard | null>;
    /**
     * Снимок всех сред для промпта агента (активная — первой). Не задан или
     * упал — агент читает доску инструментами сам, только медленнее.
     */
    loadBoardSnapshot?: (activeEnvironmentId: string) => Promise<PromptBoard | null>;
    buildDraft: (input: BuildDraftInput) => Promise<BuildDraftResult>;
    /** Применение черновика по «Отправить». */
    applyCalls: (calls: DeferredCall[]) => Promise<ToolOutcome[]>;
    findActiveHandle: (chatId: number, kind: "draft") => Promise<StoredHandle | null>;
    /** false — хендл уже не активен (отправлен, отменён, протух). */
    updateHandle: (id: string, patch: { payload?: unknown; messageId?: number }) => Promise<boolean>;
    claimHandle: (id: string) => Promise<StoredHandle | null>;
    cancelHandle: (id: string) => Promise<void>;
    /** «Сегодня» для агентов, YYYY-MM-DD. */
    today: () => string;
  };

/** Что бот понял из сообщения — для журнала апдейтов. */
export type ParsedMessage = {
  route: RouteDecision;
  transcript?: string;
  /** Подписи вызовов черновика. */
  calls?: string[];
  agentText?: string;
  /** Поисковый запрос маршрута find_task. */
  query?: string;
  /** Намерение, на которое это сообщение — ответ («что записать?»). */
  captureContext?: string;
};

export type DraftFlowOutcome = {
  action: "draft" | "correction" | "confirm" | "intent" | "callback";
  error?: string;
  parsed?: ParsedMessage;
};

/** Сообщение, уже разобранное и показанное заглушкой. */
export type MessageContext = {
  updateId: number;
  chatId: number;
  /** Заглушка «⏳ Разбираю…»: она и превращается в ответ. */
  placeholderId: number;
  inbound: Inbound;
  parsed: ParsedMessage;
  /** Намерение, на которое бот спросил «что записать?»; сообщение — ответ на него. */
  captureContext?: string;
};

export type OpenDraft = { id: string; messageId: number | null; draft: DraftPayload };

export const NO_PROJECTS = "Проектов пока нет — создайте первый на доске.";
const REASON_LIMIT = 500;
const CARD_NOT_UPDATED = "не получилось обновить карточку черновика";
export const NOTHING_TO_SEND = "Нечего отправлять — открытого черновика нет.";
const EMPTY_DRAFT = "Нечего отправлять — в черновике нет пунктов. Напишите, что записать.";
const CHECK_AND_SEND = "Проверьте и нажмите «✅ Отправить»:";
const DRAFT_BELOW = "Черновик ниже ↓";
const CLOSED_WHILE_CORRECTING = "Черновик выше уже закрыт — разобрал сообщение как новую запись.";

/** Новая запись → черновик в `tg_handles` и карточка на месте заглушки. */
export async function captureDraft(
  context: MessageContext,
  deps: DraftFlowDeps,
  /** Строка над карточкой: почему это новая запись, а не поправка. */
  note?: string
): Promise<DraftFlowOutcome> {
  const { chatId, placeholderId, inbound, captureContext } = context;

  const board = await deps.loadBoard();
  if (!board) {
    await showCard(chatId, placeholderId, { text: NO_PROJECTS }, deps);
    return { action: "draft", parsed: context.parsed };
  }

  const snapshot = await loadSnapshot(board.environment.id, deps);
  const built = await deps.buildDraft({
    inbound,
    environmentId: board.environment.id,
    today: deps.today(),
    ...(captureContext ? { captureContext } : {}),
    ...(snapshot ? { board: snapshot } : {}),
  });
  if (!built.ok) {
    await showCard(chatId, placeholderId, retryCard(context.updateId, built.error), deps);
    return { action: "draft", error: built.error, parsed: context.parsed };
  }

  const draft: DraftPayload = {
    source: inbound,
    corrections: [],
    calls: built.calls,
    agentText: built.agentText,
    environmentId: board.environment.id,
    createdAt: (deps.now?.() ?? new Date()).toISOString(),
    ...(captureContext ? { captureContext } : {}),
  };
  const handleId = await deps.createHandle({
    kind: "draft",
    payload: draft,
    chatId,
    messageId: placeholderId,
  });

  const card = renderDraftCard(draft, handleId);
  if (note) card.text = clampMessageText(`${field(note, REASON_LIMIT)}\n\n${card.text}`);
  await showCard(chatId, placeholderId, card, deps);
  return { action: "draft", parsed: withDraft(context.parsed, draft) };
}

/**
 * «Хочу создать задачу в блоке ML» — намерение без содержания. Агента не
 * зовём (иначе фраза становится заголовком задачи), а спрашиваем, что
 * записать: заглушка становится вопросом, а ожидание ввода (15 минут) держит
 * исходную фразу. Следующее сообщение — текст или голос — уходит агенту
 * вместе с ней (`captureContext`), так что задача ляжет в названный эпик.
 * В базу пишется только ожидание в `tg_handles`.
 */
export async function askWhatToCapture(
  context: MessageContext,
  deps: DraftFlowDeps
): Promise<DraftFlowOutcome> {
  const { chatId, placeholderId, inbound } = context;

  const epic = await mentionedEpic(inbound.text, deps);
  // Старый вопрос («новое название?», «что поправить?») этим снимается:
  // ответ теперь ждёт только «что записать».
  await deps.cancelAwaitInput(chatId);
  await deps.createHandle({
    kind: "await_input",
    payload: captureContextPayload(inbound.text),
    chatId,
    messageId: placeholderId,
  });
  await showCard(chatId, placeholderId, { text: intentQuestion(epic) }, deps);
  return { action: "intent", parsed: context.parsed };
}

/**
 * Эпик из сообщения — по названиям эпиков всех сред, активная первой. Сбой
 * базы здесь не повод молчать: вопрос просто выйдет без эпика.
 */
async function mentionedEpic(
  text: string,
  deps: DraftFlowDeps
): Promise<{ name: string } | null> {
  try {
    const board = await deps.loadBoard();
    const environments = await deps.listEnvironments();
    const ordered = board
      ? [
          ...environments.filter((e) => e.id === board.environment.id),
          ...environments.filter((e) => e.id !== board.environment.id),
        ]
      : environments;
    const epics = (await Promise.all(ordered.map((e) => deps.listEpics(e.id)))).flat();
    return findMentionedEpic(text, epics);
  } catch {
    return null;
  }
}

/**
 * Поправка: агент собирает черновик заново целиком, правится ТА ЖЕ карточка,
 * новый хендл не заводится. Заглушка становится стрелкой на карточку выше.
 */
export async function correctDraft(
  open: OpenDraft,
  context: MessageContext,
  deps: DraftFlowDeps
): Promise<DraftFlowOutcome> {
  const { chatId, placeholderId, inbound } = context;

  const snapshot = await loadSnapshot(open.draft.environmentId, deps);
  const built = await deps.buildDraft({
    inbound,
    environmentId: open.draft.environmentId,
    today: deps.today(),
    previous: open.draft,
    correction: inbound.text,
    ...(snapshot ? { board: snapshot } : {}),
  });
  if (!built.ok) {
    // Черновик не трогаем: прошлая версия на карточке остаётся рабочей.
    await showCard(chatId, placeholderId, retryCard(context.updateId, built.error), deps);
    return { action: "correction", error: built.error, parsed: context.parsed };
  }

  const draft: DraftPayload = {
    ...open.draft,
    corrections: [...open.draft.corrections, inbound.text],
    calls: built.calls,
    agentText: built.agentText,
    correctionTranscript: inbound.transcript,
  };
  // Текстовая поправка снимает расшифровку прошлой голосовой: она уже не про эту версию.
  if (!draft.correctionTranscript) delete draft.correctionTranscript;

  // Сначала хендл, потом карточка. Пока агент думал, черновик могли отправить
  // или отменить: тогда старую карточку не трогаем (на ней уже отчёт), а
  // сообщение разбираем как новую запись. И наоборот, карточка никогда не
  // показывает вызовы, которых нет в хендле, — «Отправить» применит то, что видно.
  const stored = await deps.updateHandle(open.id, { payload: draft });
  if (!stored) return captureDraft(context, deps, CLOSED_WHILE_CORRECTING);

  const card = renderDraftCard(draft, open.id);
  let edited: boolean;
  try {
    edited = open.messageId !== null && (await tryEdit(chatId, open.messageId, card, deps));
  } catch (error) {
    // Карточка на месте, но обновить её не вышло (сеть, флуд-лимит, отказ
    // Telegram): на ней прежние вызовы, а «Отправить» применяет хендл. Хендл
    // откатываем к прежней версии — кнопка применит то, что видно, — а
    // поправку предлагаем повторить.
    await deps.updateHandle(open.id, { payload: open.draft });
    if (open.messageId !== null) {
      // Ответ мог потеряться уже после правки: возвращаем карточке прежний
      // вид, чтобы она снова совпала с хендлом. Не вышло — не беда.
      await tryEdit(chatId, open.messageId, renderDraftCard(open.draft, open.id), deps).catch(
        () => false
      );
    }
    const reason = error instanceof Error ? error.message : "сбой Telegram";
    await showCard(chatId, placeholderId, retryCard(context.updateId, CARD_NOT_UPDATED), deps);
    return { action: "correction", error: `${CARD_NOT_UPDATED}: ${reason}`, parsed: context.parsed };
  }

  if (edited) {
    // Черновик уже обновлён и виден; стрелка — только подсказка, её сбой
    // не повод показывать «не разобрал» и звать повтор той же поправки.
    await showCard(chatId, placeholderId, { text: "Поправил черновик выше ↑" }, deps).catch(
      () => {}
    );
  } else {
    // Карточку удалили из чата (или её не было) — черновик переезжает в заглушку.
    await deps.updateHandle(open.id, { messageId: placeholderId });
    await showCard(chatId, placeholderId, card, deps);
  }

  return { action: "correction", parsed: withDraft(context.parsed, draft) };
}

/**
 * «Отправляй», «да, записывай» при открытом черновике. По фразе бот ничего не
 * применяет: черновик переезжает вниз чата (в заглушку) — свежей карточкой с
 * кнопками, а у старой клавиатура снимается. На доску он попадает только по
 * нажатию «Отправить» — тому же `claimHandle`, что и раньше.
 */
export async function resendDraft(
  open: OpenDraft | null,
  context: MessageContext,
  deps: DraftFlowDeps
): Promise<DraftFlowOutcome> {
  const { chatId, placeholderId } = context;
  const parsed = context.parsed;

  if (!open) {
    await showCard(chatId, placeholderId, { text: NOTHING_TO_SEND }, deps);
    return { action: "confirm", parsed };
  }
  if (open.draft.calls.length === 0) {
    await showCard(chatId, placeholderId, { text: EMPTY_DRAFT }, deps);
    return { action: "confirm", parsed };
  }

  // Сначала хендл: черновик могли отправить или отменить, пока решал Jev.
  // Тогда показывать нечего, а старую карточку (с отчётом) не трогаем.
  const moved = await deps.updateHandle(open.id, { messageId: placeholderId });
  if (!moved) {
    await showCard(chatId, placeholderId, { text: NOTHING_TO_SEND }, deps);
    return { action: "confirm", parsed };
  }

  const card = renderDraftCard(open.draft, open.id);
  card.text = clampMessageText(`${CHECK_AND_SEND}

${card.text}`);
  await showCard(chatId, placeholderId, card, deps);

  // Старая карточка — без кнопок, со стрелкой вниз. Не вышло (удалена, сеть) —
  // не беда: её кнопки ведут на тот же хендл, и «Отправить» всё равно
  // применит черновик ровно один раз.
  if (open.messageId !== null && open.messageId !== placeholderId) {
    await tryEdit(chatId, open.messageId, { text: DRAFT_BELOW }, deps).catch(() => false);
  }

  return { action: "confirm", parsed: withDraft(parsed, open.draft) };
}

/**
 * Кнопки «Отправить», «Исправить», «Отмена». Отправка держится на
 * `claimHandle`: условный переход active → used, поэтому двойное нажатие
 * применяет черновик ровно один раз.
 */
export async function respondToDraftButton(
  pressed: { action: "send" | "fix" | "cancel"; handleId: string },
  message: TelegramMessage | undefined,
  chatId: number,
  deps: DraftFlowDeps
): Promise<DraftFlowOutcome> {
  const messageId = message?.message_id;
  const done: DraftFlowOutcome = { action: "callback" };

  if (isExpiredButton(message, deps.now?.() ?? new Date())) {
    await showCard(chatId, messageId, renderClosedCard("expired"), deps);
    return done;
  }

  const { handleId } = pressed;

  if (pressed.action === "send") {
    await deps.cancelAwaitInput(chatId);
    const claimed = await deps.claimHandle(handleId);
    if (!claimed) {
      await showCard(chatId, messageId, renderClosedCard("already_sent"), deps);
      return done;
    }
    const draft = claimed.kind === "draft" ? parseDraftPayload(claimed.payload) : null;
    if (!draft) {
      await showCard(chatId, messageId, renderClosedCard("expired"), deps);
      return done;
    }
    const results = await deps.applyCalls(draft.calls);
    await showCard(chatId, messageId, renderAppliedCard(draft, results), deps);
    return done;
  }

  // «Отмена» и «Исправить» сначала проверяют, что черновик ещё жив: иначе
  // отмена отправленного черновика написала бы «отменён» — неправду.
  const open = await loadDraft(handleId, deps);
  if (!open) {
    await showCard(chatId, messageId, renderClosedCard("expired"), deps);
    return done;
  }

  await deps.cancelAwaitInput(chatId);

  if (pressed.action === "cancel") {
    await deps.cancelHandle(handleId);
    await showCard(chatId, messageId, renderClosedCard("cancelled"), deps);
    return done;
  }

  // «Исправить»: следующее сообщение — текст или голос — поправка к этому
  // черновику, без вопроса к Jev.
  await deps.createHandle({
    kind: "await_input",
    payload: { draftHandleId: handleId },
    chatId,
    messageId,
  });
  await deps.client.sendMessage({ chatId, text: "Что поправить? Напишите или надиктуйте." });
  return done;
}

/**
 * Снимок доски для агента. Сбой базы здесь — не повод отказать в черновике:
 * без снимка агент прочитает доску инструментами.
 */
export async function loadSnapshot(
  environmentId: string,
  deps: Pick<DraftFlowDeps, "loadBoardSnapshot">
): Promise<PromptBoard | undefined> {
  if (!deps.loadBoardSnapshot) return undefined;
  try {
    return (await deps.loadBoardSnapshot(environmentId)) ?? undefined;
  } catch {
    return undefined;
  }
}

/** Последний открытый черновик чата. Битый payload — как будто черновика нет. */
export async function loadOpenDraft(
  chatId: number,
  deps: DraftFlowDeps
): Promise<OpenDraft | null> {
  return toOpenDraft(await deps.findActiveHandle(chatId, "draft"));
}

/** Живой черновик по id: протухший, отправленный, отменённый и чужой вид — null. */
export async function loadDraft(id: string, deps: DraftFlowDeps): Promise<OpenDraft | null> {
  const handle = await deps.getHandle(id);
  return toOpenDraft(handle ? { id, ...handle } : null);
}

function toOpenDraft(
  handle: { id: string; kind?: string; payload: unknown; messageId?: number | null } | null
): OpenDraft | null {
  if (!handle || handle.kind !== "draft") return null;
  const draft = parseDraftPayload(handle.payload);
  return draft ? { id: handle.id, messageId: handle.messageId ?? null, draft } : null;
}

function withDraft(parsed: ParsedMessage, draft: DraftPayload): ParsedMessage {
  return {
    ...parsed,
    calls: draft.calls.map((call) => call.label?.trim() || call.tool),
    agentText: draft.agentText,
  };
}

/** «Не разобрал» с кнопкой повтора: повтор берёт апдейт из журнала. */
export function retryCard(updateId: number, reason: string): TaskCard {
  return {
    text: `Не разобрал: ${field(reason, REASON_LIMIT)}`,
    replyMarkup: {
      inline_keyboard: [
        [{ text: "↻ Попробовать ещё раз", callback_data: draftCallback.retry(updateId) }],
      ],
    },
  };
}
