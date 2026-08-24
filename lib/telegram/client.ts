import type {
  TelegramBotCommand,
  TelegramFile,
  TelegramMessage,
} from "@/lib/telegram/types";

/**
 * Клиент Bot API.
 *
 * Разметка — HTML, а не MarkdownV2: экранировать нужно три символа вместо
 * восемнадцати. Каждое доменное значение (название задачи, имя проекта)
 * обязано пройти через escapeHtml — иначе символ «<» в тексте пользователя
 * уронит отправку.
 */

const API_ORIGIN = "https://api.telegram.org";

/** Ошибка Bot API: не-2xx или ok: false. */
export class TelegramApiError extends Error {
  constructor(
    readonly method: string,
    readonly status: number,
    readonly description: string,
    readonly retryAfter?: number
  ) {
    super(`Telegram ${method}: ${status} ${description}`);
    this.name = "TelegramApiError";
  }
}

/** Экранирует символы, ломающие parse_mode: HTML. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export type TelegramClientOptions = {
  token?: string;
  /** Подменяется в тестах; по умолчанию глобальный fetch. */
  fetchFn?: typeof fetch;
  /** Подменяется в тестах, чтобы ретрай не спал по-настоящему. */
  sleep?: (ms: number) => Promise<void>;
  /** Сколько раз повторить запрос при 429 и 5xx. */
  maxRetries?: number;
  /**
   * Момент (epoch ms), после которого платформа убьёт функцию. Задаётся явно
   * тем, кто этот дедлайн знает (роут вебхука — из maxDuration): угадывать его
   * внутри клиента не из чего.
   *
   * Не задан — ждём столько, сколько просит Telegram: у скриптов из командной
   * строки дедлайна нет.
   */
  deadlineAt?: number;
  /** Часы; в тестах подменяются вместе со sleep, чтобы время «шло». */
  now?: () => number;
};

export type SendMessageInput = {
  chatId: number;
  text: string;
  replyMarkup?: unknown;
  disableWebPagePreview?: boolean;
};

export type EditMessageTextInput = SendMessageInput & { messageId: number };

const defaultSleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Пауза перед повтором, когда Telegram не сказал retry_after. */
const DEFAULT_RETRY_MS = 1000;

/**
 * Запас, который должен остаться после сна: проснуться мало — нужно ещё успеть
 * сделать повторный запрос и дописать результат в журнал.
 */
const DEADLINE_RESERVE_MS = 2000;

export function createTelegramClient(options: TelegramClientOptions = {}) {
  const token = options.token ?? process.env.TELEGRAM_BOT_TOKEN;
  const fetchFn = options.fetchFn ?? fetch;
  const sleep = options.sleep ?? defaultSleep;
  const maxRetries = options.maxRetries ?? 2;
  const now = options.now ?? Date.now;
  const deadlineAt = options.deadlineAt;

  async function call<T>(method: string, payload: Record<string, unknown> = {}): Promise<T> {
    if (!token) throw new Error("TELEGRAM_BOT_TOKEN не задан");

    for (let attempt = 0; ; attempt++) {
      const response = await fetchFn(`${API_ORIGIN}/bot${token}/${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const body = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        result?: T;
        description?: string;
        parameters?: { retry_after?: number };
      };

      if (response.ok && body.ok) return body.result as T;

      const description = body.description ?? `HTTP ${response.status}`;
      const retryAfter = body.parameters?.retry_after;
      const retriable = response.status === 429 || response.status >= 500;

      if (retriable && attempt < maxRetries) {
        // Telegram сам говорит, сколько ждать: свой бэкофф здесь только навредит.
        const waitMs = retryAfter != null ? retryAfter * 1000 : DEFAULT_RETRY_MS;
        const leftMs = deadlineAt === undefined ? undefined : deadlineAt - now();

        if (leftMs === undefined || waitMs + DEADLINE_RESERVE_MS <= leftMs) {
          await sleep(waitMs);
          continue;
        }

        // Спать дольше, чем живёт функция, — молчаливая потеря: нас убьют во
        // сне, апдейт останется в журнале со статусом received, и Telegram его
        // не повторит. Лучше упасть сейчас: обработчик пометит failed.
        throw new TelegramApiError(
          method,
          response.status,
          `${description} — ждать ${Math.round(waitMs / 1000)} с, а функции жить ${Math.max(0, Math.round(leftMs / 1000))} с`,
          retryAfter
        );
      }

      throw new TelegramApiError(method, response.status, description, retryAfter);
    }
  }

  async function sendMessage(input: SendMessageInput): Promise<TelegramMessage> {
    const payload = {
      chat_id: input.chatId,
      text: input.text,
      reply_markup: input.replyMarkup,
      link_preview_options: input.disableWebPagePreview ? { is_disabled: true } : undefined,
    };

    try {
      return await call<TelegramMessage>("sendMessage", { ...payload, parse_mode: "HTML" });
    } catch (error) {
      if (isParseError(error)) {
        // Разметка битая — отправляем как есть. Кривой текст лучше молчания.
        return call<TelegramMessage>("sendMessage", payload);
      }
      throw error;
    }
  }

  async function editMessageText(input: EditMessageTextInput): Promise<TelegramMessage | true> {
    const payload = {
      chat_id: input.chatId,
      message_id: input.messageId,
      text: input.text,
      reply_markup: input.replyMarkup,
    };

    try {
      return await call<TelegramMessage | true>("editMessageText", {
        ...payload,
        parse_mode: "HTML",
      });
    } catch (error) {
      if (isParseError(error)) return call<TelegramMessage | true>("editMessageText", payload);
      throw error;
    }
  }

  /**
   * Зовётся первым делом на любое нажатие кнопки: до ответа у пользователя
   * крутится спиннер, и через ~10 секунд запрос протухает.
   */
  async function answerCallbackQuery(input: {
    callbackQueryId: string;
    text?: string;
    showAlert?: boolean;
  }): Promise<true> {
    return call<true>("answerCallbackQuery", {
      callback_query_id: input.callbackQueryId,
      text: input.text,
      show_alert: input.showAlert,
    });
  }

  /** Файл до 20 МБ; для большего Bot API ссылку не отдаёт. */
  async function getFile(fileId: string): Promise<TelegramFile> {
    return call<TelegramFile>("getFile", { file_id: fileId });
  }

  async function setMyCommands(commands: TelegramBotCommand[]): Promise<true> {
    return call<true>("setMyCommands", { commands });
  }

  async function getMyCommands(): Promise<TelegramBotCommand[]> {
    return call<TelegramBotCommand[]>("getMyCommands");
  }

  return { call, sendMessage, editMessageText, answerCallbackQuery, getFile, setMyCommands, getMyCommands };
}

export type TelegramClient = ReturnType<typeof createTelegramClient>;

function isParseError(error: unknown): boolean {
  return (
    error instanceof TelegramApiError &&
    error.status === 400 &&
    /can't parse entities/i.test(error.description)
  );
}
