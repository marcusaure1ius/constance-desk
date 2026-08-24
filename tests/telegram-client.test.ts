import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createTelegramClient,
  escapeHtml,
  TelegramApiError,
} from "@/lib/telegram/client";

const TOKEN = "123:TEST";
const URL_PREFIX = `https://api.telegram.org/bot${TOKEN}/`;

/** Ответ Bot API: успех. */
const ok = (result: unknown) =>
  new Response(JSON.stringify({ ok: true, result }), { status: 200 });

/** Ответ Bot API: отказ. */
const fail = (status: number, description: string, retryAfter?: number) =>
  new Response(
    JSON.stringify({
      ok: false,
      description,
      parameters: retryAfter != null ? { retry_after: retryAfter } : undefined,
    }),
    { status }
  );

const bodyOf = (call: unknown[]) =>
  JSON.parse((call[1] as RequestInit).body as string) as Record<string, unknown>;

describe("escapeHtml", () => {
  it("экранирует амперсанд, меньше и больше", () => {
    expect(escapeHtml('Цены & КУУ <b> "тест" >')).toBe(
      'Цены &amp; КУУ &lt;b&gt; "тест" &gt;'
    );
  });

  it("не экранирует амперсанд дважды", () => {
    expect(escapeHtml("<a & b>")).toBe("&lt;a &amp; b&gt;");
  });

  it("обычный текст не меняет", () => {
    expect(escapeHtml("вэду и итмо")).toBe("вэду и итмо");
  });
});

describe("вызовы Bot API", () => {
  let fetchFn: ReturnType<typeof vi.fn>;
  let sleep: ReturnType<typeof vi.fn>;

  const client = () =>
    createTelegramClient({
      token: TOKEN,
      fetchFn: fetchFn as unknown as typeof fetch,
      sleep: sleep as unknown as (ms: number) => Promise<void>,
    });

  beforeEach(() => {
    fetchFn = vi.fn();
    sleep = vi.fn().mockResolvedValue(undefined);
  });

  it("sendMessage шлёт HTML-разметку в нужный метод", async () => {
    fetchFn.mockResolvedValue(ok({ message_id: 7 }));
    const result = await client().sendMessage({ chatId: 42, text: "<b>Привет</b>" });

    expect(result).toEqual({ message_id: 7 });
    expect(fetchFn.mock.calls[0][0]).toBe(`${URL_PREFIX}sendMessage`);
    expect(bodyOf(fetchFn.mock.calls[0])).toMatchObject({
      chat_id: 42,
      text: "<b>Привет</b>",
      parse_mode: "HTML",
    });
  });

  it("на 429 ждёт ровно retry_after и повторяет", async () => {
    fetchFn
      .mockResolvedValueOnce(fail(429, "Too Many Requests: retry after 7", 7))
      .mockResolvedValueOnce(ok({ message_id: 1 }));

    await client().sendMessage({ chatId: 42, text: "привет" });

    expect(sleep).toHaveBeenCalledWith(7000);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("на 5xx повторяет с паузой по умолчанию", async () => {
    fetchFn
      .mockResolvedValueOnce(fail(502, "Bad Gateway"))
      .mockResolvedValueOnce(ok({ message_id: 1 }));

    await client().sendMessage({ chatId: 42, text: "привет" });

    expect(sleep).toHaveBeenCalledWith(1000);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("исчерпав попытки на 429, бросает TelegramApiError", async () => {
    fetchFn.mockResolvedValue(fail(429, "Too Many Requests", 1));

    await expect(client().sendMessage({ chatId: 42, text: "привет" })).rejects.toBeInstanceOf(
      TelegramApiError
    );
    // Первая попытка плюс maxRetries по умолчанию
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it("на 400 can't parse entities повторяет без parse_mode", async () => {
    fetchFn
      .mockResolvedValueOnce(fail(400, "Bad Request: can't parse entities: unclosed tag"))
      .mockResolvedValueOnce(ok({ message_id: 5 }));

    const result = await client().sendMessage({ chatId: 42, text: "<b>кривая" });

    expect(result).toEqual({ message_id: 5 });
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(bodyOf(fetchFn.mock.calls[0])).toHaveProperty("parse_mode", "HTML");
    expect(bodyOf(fetchFn.mock.calls[1])).not.toHaveProperty("parse_mode");
    expect(bodyOf(fetchFn.mock.calls[1])).toMatchObject({ text: "<b>кривая" });
    expect(sleep).not.toHaveBeenCalled();
  });

  it("другую 400 не повторяет и пробрасывает", async () => {
    fetchFn.mockResolvedValue(fail(400, "Bad Request: chat not found"));

    await expect(client().sendMessage({ chatId: 42, text: "привет" })).rejects.toThrow(
      /chat not found/
    );
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("ok: false при HTTP 200 считается ошибкой", async () => {
    fetchFn.mockResolvedValue(
      new Response(JSON.stringify({ ok: false, description: "Forbidden: bot was blocked" }), {
        status: 200,
      })
    );

    await expect(client().sendMessage({ chatId: 42, text: "привет" })).rejects.toBeInstanceOf(
      TelegramApiError
    );
  });

  it("editMessageText тоже откатывается на текст без разметки", async () => {
    fetchFn
      .mockResolvedValueOnce(fail(400, "Bad Request: can't parse entities"))
      .mockResolvedValueOnce(ok(true));

    await client().editMessageText({ chatId: 1, messageId: 2, text: "<i>текст" });

    expect(bodyOf(fetchFn.mock.calls[1])).not.toHaveProperty("parse_mode");
    expect(bodyOf(fetchFn.mock.calls[1])).toMatchObject({ chat_id: 1, message_id: 2 });
  });

  it("answerCallbackQuery передаёт идентификатор запроса", async () => {
    fetchFn.mockResolvedValue(ok(true));
    await client().answerCallbackQuery({ callbackQueryId: "cb-1", text: "Готово" });

    expect(fetchFn.mock.calls[0][0]).toBe(`${URL_PREFIX}answerCallbackQuery`);
    expect(bodyOf(fetchFn.mock.calls[0])).toMatchObject({
      callback_query_id: "cb-1",
      text: "Готово",
    });
  });

  it("getFile запрашивает файл по идентификатору", async () => {
    fetchFn.mockResolvedValue(ok({ file_id: "f-1", file_path: "voice/file_1.ogg" }));
    const file = await client().getFile("f-1");

    expect(file.file_path).toBe("voice/file_1.ogg");
    expect(bodyOf(fetchFn.mock.calls[0])).toEqual({ file_id: "f-1" });
  });

  it("setMyCommands отправляет список команд", async () => {
    fetchFn.mockResolvedValue(ok(true));
    await client().setMyCommands([{ command: "start", description: "Начать" }]);

    expect(bodyOf(fetchFn.mock.calls[0])).toEqual({
      commands: [{ command: "start", description: "Начать" }],
    });
  });

  it("без токена не делает запросов", async () => {
    // Подменяем окружение ДО создания клиента: токен читается в этот момент.
    // vitest подтягивает .env.local целиком, и настоящий токен там может быть.
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "");
    const noToken = createTelegramClient({ fetchFn: fetchFn as unknown as typeof fetch });

    await expect(noToken.sendMessage({ chatId: 1, text: "x" })).rejects.toThrow(
      /TELEGRAM_BOT_TOKEN/
    );
    expect(fetchFn).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });

  it("токен из окружения используется, если не передан явно", async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "env-token");
    fetchFn.mockResolvedValue(ok({ message_id: 1 }));

    await createTelegramClient({ fetchFn: fetchFn as unknown as typeof fetch }).sendMessage({
      chatId: 1,
      text: "x",
    });

    expect(fetchFn.mock.calls[0][0]).toBe("https://api.telegram.org/botenv-token/sendMessage");
    vi.unstubAllEnvs();
  });
});
