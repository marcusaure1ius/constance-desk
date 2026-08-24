import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  allowedChatIdFromEnv,
  handleUpdate,
  parseCommand,
  type HandleUpdateDeps,
} from "@/lib/telegram/handle-update";
import type { TelegramUpdate } from "@/lib/telegram/types";

const CHAT = 555;

function makeDeps(overrides: Partial<HandleUpdateDeps> = {}) {
  const sendMessage = vi.fn().mockResolvedValue({ message_id: 1 });
  const answerCallbackQuery = vi.fn().mockResolvedValue(true);
  const recordUpdate = vi.fn().mockResolvedValue(true);
  const markProcessed = vi.fn().mockResolvedValue(undefined);
  const markFailed = vi.fn().mockResolvedValue(undefined);
  const getActiveEnvironment = vi.fn().mockResolvedValue({ name: "Работа" });

  const deps: HandleUpdateDeps = {
    client: { sendMessage, answerCallbackQuery },
    recordUpdate,
    markProcessed,
    markFailed,
    getActiveEnvironment,
    allowedChatId: CHAT,
    ...overrides,
  };

  return { deps, sendMessage, answerCallbackQuery, recordUpdate, markProcessed, markFailed };
}

const textUpdate = (text: string, chatId = CHAT, updateId = 1): TelegramUpdate => ({
  update_id: updateId,
  message: {
    message_id: 10,
    date: 1_700_000_000,
    chat: { id: chatId, type: "private" },
    text,
  },
});

describe("чужие и пустые апдейты", () => {
  it("чужой чат: ни записи, ни ответа", async () => {
    const { deps, recordUpdate, sendMessage } = makeDeps();
    const result = await handleUpdate(textUpdate("/start", 999), deps);

    expect(result).toEqual({ status: "ignored", reason: "foreign_chat" });
    expect(recordUpdate).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("разрешённый чат не настроен — молчим для всех", async () => {
    const { deps, recordUpdate, sendMessage } = makeDeps({ allowedChatId: undefined });
    const result = await handleUpdate(textUpdate("/start"), deps);

    expect(result).toEqual({ status: "ignored", reason: "foreign_chat" });
    expect(recordUpdate).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("апдейт без чата пропускается", async () => {
    const { deps, recordUpdate } = makeDeps();
    const result = await handleUpdate({ update_id: 3 }, deps);

    expect(result).toEqual({ status: "ignored", reason: "no_chat" });
    expect(recordUpdate).not.toHaveBeenCalled();
  });
});

describe("журнал апдейтов", () => {
  beforeEach(() => vi.clearAllMocks());

  it("сырой текст пишется до отправки ответа", async () => {
    const { deps, recordUpdate, sendMessage } = makeDeps();
    await handleUpdate(textUpdate("/start"), deps);

    expect(recordUpdate).toHaveBeenCalledWith({
      updateId: 1,
      chatId: CHAT,
      rawText: "/start",
      payload: textUpdate("/start"),
    });
    expect(recordUpdate.mock.invocationCallOrder[0]).toBeLessThan(
      sendMessage.mock.invocationCallOrder[0]
    );
  });

  it("повторная доставка не обрабатывается второй раз", async () => {
    const { deps, sendMessage, markProcessed } = makeDeps({
      recordUpdate: vi.fn().mockResolvedValue(false),
    });
    const result = await handleUpdate(textUpdate("/start"), deps);

    expect(result).toEqual({ status: "duplicate" });
    expect(sendMessage).not.toHaveBeenCalled();
    expect(markProcessed).not.toHaveBeenCalled();
  });

  it("успешная обработка помечается в журнале", async () => {
    const { deps, markProcessed, markFailed } = makeDeps();
    await handleUpdate(textUpdate("/help"), deps);

    expect(markProcessed).toHaveBeenCalledWith(1);
    expect(markFailed).not.toHaveBeenCalled();
  });

  it("сбой отправки помечается ошибкой, а не теряется", async () => {
    const { deps, markFailed, markProcessed } = makeDeps({
      client: {
        sendMessage: vi.fn().mockRejectedValue(new Error("Telegram недоступен")),
        answerCallbackQuery: vi.fn(),
      },
    });
    const result = await handleUpdate(textUpdate("/start"), deps);

    expect(result).toEqual({ status: "failed", error: "Telegram недоступен" });
    expect(markFailed).toHaveBeenCalledWith(1, "Telegram недоступен");
    expect(markProcessed).not.toHaveBeenCalled();
  });
});

describe("/start", () => {
  beforeEach(() => vi.clearAllMocks());

  it("отвечает приветствием с активным проектом", async () => {
    const { deps, sendMessage } = makeDeps();
    const result = await handleUpdate(textUpdate("/start"), deps);

    expect(result).toEqual({ status: "processed", action: "start" });
    const [{ chatId, text }] = sendMessage.mock.calls[0];
    expect(chatId).toBe(CHAT);
    expect(text).toContain("Работа");
    expect(text).toContain("Активный проект");
  });

  it("экранирует имя проекта в разметке", async () => {
    const { deps, sendMessage } = makeDeps({
      getActiveEnvironment: vi.fn().mockResolvedValue({ name: "Цены & <ККУ>" }),
    });
    await handleUpdate(textUpdate("/start"), deps);

    const [{ text }] = sendMessage.mock.calls[0];
    expect(text).toContain("Цены &amp; &lt;ККУ&gt;");
    expect(text).not.toContain("<ККУ>");
  });

  it("без сред говорит, что проектов нет", async () => {
    const { deps, sendMessage } = makeDeps({
      getActiveEnvironment: vi.fn().mockResolvedValue(null),
    });
    await handleUpdate(textUpdate("/start"), deps);

    expect(sendMessage.mock.calls[0][0].text).toContain("Проектов пока нет");
  });

  it("понимает команду с упоминанием бота", async () => {
    const { deps } = makeDeps();
    const result = await handleUpdate(textUpdate("/start@constance_bot"), deps);
    expect(result).toEqual({ status: "processed", action: "start" });
  });
});

describe("остальные сообщения", () => {
  beforeEach(() => vi.clearAllMocks());

  it("/help перечисляет команды", async () => {
    const { deps, sendMessage } = makeDeps();
    const result = await handleUpdate(textUpdate("/help"), deps);

    expect(result).toEqual({ status: "processed", action: "help" });
    const [{ text }] = sendMessage.mock.calls[0];
    expect(text).toContain("/start");
    expect(text).toContain("/help");
  });

  it("обычный текст пока не разбирается, но сохраняется", async () => {
    const { deps, sendMessage, recordUpdate } = makeDeps();
    const result = await handleUpdate(textUpdate("купить билеты"), deps);

    expect(result).toEqual({ status: "processed", action: "unsupported" });
    expect(recordUpdate.mock.calls[0][0].rawText).toBe("купить билеты");
    expect(sendMessage.mock.calls[0][0].text).toContain("Сообщение сохранено");
  });

  it("нажатие кнопки сначала гасит спиннер", async () => {
    const { deps, answerCallbackQuery, sendMessage } = makeDeps();
    const update: TelegramUpdate = {
      update_id: 9,
      callback_query: {
        id: "cb-9",
        from: { id: CHAT, is_bot: false, first_name: "Денис" },
        data: "noop",
        message: {
          message_id: 3,
          date: 1_700_000_000,
          chat: { id: CHAT, type: "private" },
        },
      },
    };

    const result = await handleUpdate(update, deps);

    expect(result).toEqual({ status: "processed", action: "callback" });
    expect(answerCallbackQuery).toHaveBeenCalledWith({ callbackQueryId: "cb-9" });
    expect(answerCallbackQuery.mock.invocationCallOrder[0]).toBeLessThan(
      sendMessage.mock.invocationCallOrder[0]
    );
  });
});

describe("parseCommand", () => {
  it("разбирает команду, упоминание и аргумент", () => {
    expect(parseCommand("/start")).toBe("start");
    expect(parseCommand("/Start")).toBe("start");
    expect(parseCommand("/start@constance_bot")).toBe("start");
    expect(parseCommand("/help мне")).toBe("help");
    expect(parseCommand("  /help  ")).toBe("help");
  });

  it("не считает командой обычный текст", () => {
    expect(parseCommand("купить билеты")).toBeUndefined();
    expect(parseCommand("почта/дела")).toBeUndefined();
    expect(parseCommand("")).toBeUndefined();
    expect(parseCommand(undefined)).toBeUndefined();
  });
});

describe("allowedChatIdFromEnv", () => {
  it("читает число из окружения", () => {
    vi.stubEnv("TELEGRAM_ALLOWED_CHAT_ID", "-1001234567890");
    expect(allowedChatIdFromEnv()).toBe(-1001234567890);
    vi.unstubAllEnvs();
  });

  it("мусор и пустое значение оставляют бота молчащим", () => {
    vi.stubEnv("TELEGRAM_ALLOWED_CHAT_ID", "не число");
    expect(allowedChatIdFromEnv()).toBeUndefined();
    vi.stubEnv("TELEGRAM_ALLOWED_CHAT_ID", "");
    expect(allowedChatIdFromEnv()).toBeUndefined();
    vi.unstubAllEnvs();
  });
});
