import { createTelegramClient, escapeHtml, type TelegramClient } from "@/lib/telegram/client";
import { BOT_COMMANDS } from "@/lib/telegram/commands";
import {
  updateChatId,
  updateText,
  type TelegramUpdate,
} from "@/lib/telegram/types";
import { getActiveEnvironment } from "@/lib/services/environments";
import {
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

/** Зависимости обработки: Bot API, отметки в журнале, доска. */
export type HandleUpdateDeps = {
  client: Pick<TelegramClient, "sendMessage" | "answerCallbackQuery">;
  markProcessed: typeof markUpdateProcessed;
  markFailed: typeof markUpdateFailed;
  /** Проект, в который бот складывает задачи. */
  getActiveEnvironment: () => Promise<{ name: string } | null>;
};

export type TelegramDeps = ReceiveUpdateDeps & HandleUpdateDeps;

export type ReceiveUpdateResult =
  | { status: "ignored"; reason: "no_chat" | "foreign_chat" }
  | { status: "duplicate"; chatId: number }
  | { status: "accepted"; chatId: number };

export type HandleUpdateResult =
  | { status: "processed"; action: "start" | "help" | "callback" | "unsupported" }
  | { status: "failed"; error: string };

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
    const action = await respond(update, chatId, deps);
    await deps.markProcessed(update.update_id);
    return { status: "processed", action };
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
): Promise<"start" | "help" | "callback" | "unsupported"> {
  // Спиннер на кнопке протухает за ~10 секунд, поэтому отвечаем первым делом.
  if (update.callback_query) {
    await deps.client.answerCallbackQuery({ callbackQueryId: update.callback_query.id });
    await deps.client.sendMessage({
      chatId,
      text: "Кнопки появятся вместе с карточками задач.",
    });
    return "callback";
  }

  const command = parseCommand(updateText(update));

  if (command === "start") {
    await deps.client.sendMessage({ chatId, text: await startText(deps) });
    return "start";
  }

  if (command === "help") {
    await deps.client.sendMessage({ chatId, text: helpText() });
    return "help";
  }

  await deps.client.sendMessage({
    chatId,
    text:
      "Пока я умею только /start и /help.\n\n" +
      "Сообщение сохранено — разбирать его в задачи научусь следующим шагом.",
  });
  return "unsupported";
}

/** «/start@constance_bot arg» → «start». Не команда — undefined. */
export function parseCommand(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const match = /^\/([a-z_]+)(?:@[\w]+)?(?:\s|$)/i.exec(text.trim());
  return match?.[1].toLowerCase();
}

async function startText(deps: HandleUpdateDeps): Promise<string> {
  const environment = await deps.getActiveEnvironment();
  const project = environment
    ? `Активный проект: <b>${escapeHtml(environment.name)}</b>`
    : "Проектов пока нет — создайте первый на доске.";

  return [
    "Привет! Я складываю задачи в Constance.",
    "",
    project,
    "",
    "Сейчас умею /start и /help. Дальше научусь превращать сообщения в задачи.",
  ].join("\n");
}

function helpText(): string {
  return [
    "Команды:",
    ...BOT_COMMANDS.map((c) => `/${c.command} — ${c.description}`),
    "",
    "Разбор сообщений, карточки задач и кнопки появятся следующими шагами.",
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
    // У бота нет cookie с активной средой, поэтому берётся первая по порядку.
    getActiveEnvironment: () => getActiveEnvironment(undefined),
    allowedChatId: allowedChatIdFromEnv(),
  };
}
