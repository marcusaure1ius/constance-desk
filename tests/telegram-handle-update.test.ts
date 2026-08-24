import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  allowedChatIdFromEnv,
  handleUpdate,
  parseCommand,
  receiveUpdate,
  type TelegramDeps,
} from "@/lib/telegram/handle-update";
import { createTelegramClient } from "@/lib/telegram/client";
import type { TelegramUpdate } from "@/lib/telegram/types";

const CHAT = 555;

function makeDeps(overrides: Partial<TelegramDeps> = {}) {
  const sendMessage = vi.fn().mockResolvedValue({ message_id: 1 });
  const answerCallbackQuery = vi.fn().mockResolvedValue(true);
  const recordUpdate = vi.fn().mockResolvedValue(true);
  const markProcessed = vi.fn().mockResolvedValue(undefined);
  const markFailed = vi.fn().mockResolvedValue(undefined);
  const getActiveEnvironment = vi.fn().mockResolvedValue({ name: "Работа" });

  const deps: TelegramDeps = {
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

describe("приём апдейта", () => {
  beforeEach(() => vi.clearAllMocks());

  it("чужой чат: ни записи, ни обработки", async () => {
    const { deps, recordUpdate } = makeDeps();
    const result = await receiveUpdate(textUpdate("/start", 999), deps);

    expect(result).toEqual({ status: "ignored", reason: "foreign_chat" });
    expect(recordUpdate).not.toHaveBeenCalled();
  });

  it("разрешённый чат не настроен — молчим для всех", async () => {
    const { deps, recordUpdate } = makeDeps({ allowedChatId: undefined });
    const result = await receiveUpdate(textUpdate("/start"), deps);

    expect(result).toEqual({ status: "ignored", reason: "foreign_chat" });
    expect(recordUpdate).not.toHaveBeenCalled();
  });

  it("апдейт без чата пропускается", async () => {
    const { deps, recordUpdate } = makeDeps();
    const result = await receiveUpdate({ update_id: 3 }, deps);

    expect(result).toEqual({ status: "ignored", reason: "no_chat" });
    expect(recordUpdate).not.toHaveBeenCalled();
  });

  it("свой апдейт пишется в журнал целиком и отдаёт чат для обработки", async () => {
    const { deps, recordUpdate } = makeDeps();
    const result = await receiveUpdate(textUpdate("/start"), deps);

    expect(result).toEqual({ status: "accepted", chatId: CHAT });
    expect(recordUpdate).toHaveBeenCalledWith({
      updateId: 1,
      chatId: CHAT,
      rawText: "/start",
      payload: textUpdate("/start"),
    });
  });

  it("повторная доставка отдаёт duplicate, а не accepted", async () => {
    // Обработку по duplicate не запускает роут: сюда она даже не доходит.
    const { deps } = makeDeps({ recordUpdate: vi.fn().mockResolvedValue(false) });
    const result = await receiveUpdate(textUpdate("/start"), deps);

    expect(result).toEqual({ status: "duplicate", chatId: CHAT });
  });

  it("сбой журнала пробрасывается наверх, а не проглатывается", async () => {
    // Роут решает, что делать со сбоем записи; молча вернуть accepted нельзя.
    const { deps } = makeDeps({
      recordUpdate: vi.fn().mockRejectedValue(new Error("база недоступна")),
    });

    await expect(receiveUpdate(textUpdate("/start"), deps)).rejects.toThrow("база недоступна");
  });
});

describe("отметки в журнале", () => {
  beforeEach(() => vi.clearAllMocks());

  it("успешная обработка помечается в журнале", async () => {
    const { deps, markProcessed, markFailed } = makeDeps();
    await handleUpdate(textUpdate("/help"), CHAT, deps);

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
    const result = await handleUpdate(textUpdate("/start"), CHAT, deps);

    expect(result).toEqual({ status: "failed", error: "Telegram недоступен" });
    expect(markFailed).toHaveBeenCalledWith(1, "Telegram недоступен");
    expect(markProcessed).not.toHaveBeenCalled();
  });

  it("флуд-лимит длиннее дедлайна помечает апдейт failed, а не оставляет received", async () => {
    // Настоящий клиент с настоящим дедлайном: раньше он уснул бы на 300 секунд,
    // функцию убили бы во сне, и апдейт навсегда остался бы в статусе received.
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: false,
          description: "Too Many Requests: retry after 300",
          parameters: { retry_after: 300 },
        }),
        { status: 429 }
      )
    );
    const sleep = vi.fn().mockResolvedValue(undefined);
    const { deps, markFailed, markProcessed } = makeDeps({
      client: createTelegramClient({
        token: "123:TEST",
        fetchFn: fetchFn as unknown as typeof fetch,
        sleep,
        deadlineAt: Date.now() + 10_000,
      }),
    });

    const result = await handleUpdate(textUpdate("/start"), CHAT, deps);

    expect(result.status).toBe("failed");
    expect(sleep).not.toHaveBeenCalled();
    expect(markProcessed).not.toHaveBeenCalled();
    expect(markFailed).toHaveBeenCalledWith(1, expect.stringContaining("300 с"));
  });
});

describe("/start", () => {
  beforeEach(() => vi.clearAllMocks());

  it("отвечает приветствием с активным проектом", async () => {
    const { deps, sendMessage } = makeDeps();
    const result = await handleUpdate(textUpdate("/start"), CHAT, deps);

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
    await handleUpdate(textUpdate("/start"), CHAT, deps);

    const [{ text }] = sendMessage.mock.calls[0];
    expect(text).toContain("Цены &amp; &lt;ККУ&gt;");
    expect(text).not.toContain("<ККУ>");
  });

  it("без сред говорит, что проектов нет", async () => {
    const { deps, sendMessage } = makeDeps({
      getActiveEnvironment: vi.fn().mockResolvedValue(null),
    });
    await handleUpdate(textUpdate("/start"), CHAT, deps);

    expect(sendMessage.mock.calls[0][0].text).toContain("Проектов пока нет");
  });

  it("понимает команду с упоминанием бота", async () => {
    const { deps } = makeDeps();
    const result = await handleUpdate(textUpdate("/start@constance_bot"), CHAT, deps);
    expect(result).toEqual({ status: "processed", action: "start" });
  });
});

describe("остальные сообщения", () => {
  beforeEach(() => vi.clearAllMocks());

  it("/help перечисляет команды", async () => {
    const { deps, sendMessage } = makeDeps();
    const result = await handleUpdate(textUpdate("/help"), CHAT, deps);

    expect(result).toEqual({ status: "processed", action: "help" });
    const [{ text }] = sendMessage.mock.calls[0];
    expect(text).toContain("/start");
    expect(text).toContain("/help");
  });

  it("обычный текст пока не разбирается, но сохраняется", async () => {
    // Запись сделал приём, до ответа 200: обработка только подтверждает её.
    const { deps, sendMessage } = makeDeps();
    const result = await handleUpdate(textUpdate("купить билеты"), CHAT, deps);

    expect(result).toEqual({ status: "processed", action: "unsupported" });
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

    const result = await handleUpdate(update, CHAT, deps);

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
