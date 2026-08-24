import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  clampMessageText,
  createTelegramClient,
  escapeHtml,
  TelegramApiError,
  TELEGRAM_MESSAGE_LIMIT,
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

  it("без дедлайна ждёт столько, сколько просит Telegram", async () => {
    fetchFn
      .mockResolvedValueOnce(fail(429, "Too Many Requests: retry after 300", 300))
      .mockResolvedValueOnce(ok({ message_id: 1 }));

    await client().sendMessage({ chatId: 42, text: "привет" });

    expect(sleep).toHaveBeenCalledWith(300_000);
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

describe("дедлайн функции", () => {
  /**
   * Часы, которые двигает сам сон: в тестах sleep не спит, поэтому без такого
   * счётчика остаток до дедлайна никогда бы не уменьшался — и проверка «второй
   * раз ждать уже нечем» ничего бы не проверяла.
   */
  function fakeClock(startAt = 1_700_000_000_000) {
    let current = startAt;
    return {
      now: () => current,
      sleep: vi.fn(async (ms: number) => {
        current += ms;
      }),
    };
  }

  const fetchFn = vi.fn();

  function client(deadlineIn: number | undefined, clock: ReturnType<typeof fakeClock>) {
    return createTelegramClient({
      token: TOKEN,
      fetchFn: fetchFn as unknown as typeof fetch,
      sleep: clock.sleep as unknown as (ms: number) => Promise<void>,
      now: clock.now,
      deadlineAt: deadlineIn === undefined ? undefined : clock.now() + deadlineIn,
    });
  }

  beforeEach(() => {
    fetchFn.mockReset();
  });

  it("флуд-лимит длиннее остатка не усыпляет, а падает ошибкой с причиной", async () => {
    const clock = fakeClock();
    fetchFn.mockResolvedValue(fail(429, "Too Many Requests: retry after 300", 300));

    const error = await client(20_000, clock)
      .sendMessage({ chatId: 42, text: "привет" })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(TelegramApiError);
    expect((error as TelegramApiError).status).toBe(429);
    expect((error as TelegramApiError).retryAfter).toBe(300);
    // Причина должна быть читаемой: сколько просили ждать и сколько оставалось.
    expect((error as Error).message).toContain("300 с");
    expect((error as Error).message).toContain("20 с");
    expect(clock.sleep).not.toHaveBeenCalled();
    // Ни одной лишней попытки: спать нечем, повторять бессмысленно.
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("флуд-лимит короче остатка ждётся как обычно", async () => {
    const clock = fakeClock();
    fetchFn
      .mockResolvedValueOnce(fail(429, "Too Many Requests: retry after 7", 7))
      .mockResolvedValueOnce(ok({ message_id: 1 }));

    const result = await client(60_000, clock).sendMessage({ chatId: 42, text: "привет" });

    expect(result).toEqual({ message_id: 1 });
    expect(clock.sleep).toHaveBeenCalledWith(7000);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("остаток считается от текущего момента: после сна ждать уже нечем", async () => {
    const clock = fakeClock();
    fetchFn
      .mockResolvedValueOnce(fail(429, "Too Many Requests: retry after 12", 12))
      .mockResolvedValueOnce(fail(429, "Too Many Requests: retry after 12", 12));

    const error = await client(20_000, clock)
      .sendMessage({ chatId: 42, text: "привет" })
      .catch((e: unknown) => e);

    // Первые 12 с в 20 с укладываются, вторые 12 — уже нет: сон съел остаток.
    expect(clock.sleep).toHaveBeenCalledTimes(1);
    expect(clock.sleep).toHaveBeenCalledWith(12_000);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect((error as Error).message).toContain("8 с");
  });

  it("у самого дедлайна не спит даже секундную паузу после 5xx", async () => {
    const clock = fakeClock();
    fetchFn.mockResolvedValue(fail(502, "Bad Gateway"));

    // Секунда паузы плюс запас на повторный запрос и отметку в журнале в 2,5 с
    // не помещаются.
    const error = await client(2500, clock)
      .sendMessage({ chatId: 42, text: "привет" })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(TelegramApiError);
    expect((error as TelegramApiError).status).toBe(502);
    expect(clock.sleep).not.toHaveBeenCalled();
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("успешный запрос дедлайн не трогает", async () => {
    const clock = fakeClock();
    fetchFn.mockResolvedValue(ok({ message_id: 3 }));

    const result = await client(1000, clock).sendMessage({ chatId: 42, text: "привет" });

    expect(result).toEqual({ message_id: 3 });
    expect(clock.sleep).not.toHaveBeenCalled();
  });
});

/**
 * Страховка на длину. 400 «message is too long» клиент не ретраит (это не 429)
 * и не понижает до plain text (это не «can't parse entities») — он выходил
 * наружу исключением, и пользователь не получал ничего.
 */
describe("лимит длины сообщения", () => {
  let fetchFn: ReturnType<typeof vi.fn>;

  const client = () =>
    createTelegramClient({
      token: TOKEN,
      fetchFn: fetchFn as unknown as typeof fetch,
      sleep: vi.fn().mockResolvedValue(undefined) as unknown as (ms: number) => Promise<void>,
    });

  beforeEach(() => {
    fetchFn = vi.fn().mockResolvedValue(ok({ message_id: 1 }));
  });

  it("текст длиннее лимита обрезается перед отправкой, а не роняет запрос", async () => {
    const long = "сходить к суровцеву ".repeat(400);
    expect(long.length).toBeGreaterThan(TELEGRAM_MESSAGE_LIMIT);

    await client().sendMessage({ chatId: 42, text: long });

    const sent = bodyOf(fetchFn.mock.calls[0]).text as string;
    expect(sent.length).toBeLessThanOrEqual(TELEGRAM_MESSAGE_LIMIT);
    expect(sent.endsWith("…")).toBe(true);
    expect(sent.startsWith("сходить к суровцеву")).toBe(true);
  });

  it("editMessageText обрезается так же", async () => {
    await client().editMessageText({
      chatId: 42,
      messageId: 7,
      text: "и".repeat(TELEGRAM_MESSAGE_LIMIT + 500),
    });

    const sent = bodyOf(fetchFn.mock.calls[0]).text as string;
    expect(sent.length).toBeLessThanOrEqual(TELEGRAM_MESSAGE_LIMIT);
  });

  it("текст в пределах лимита не трогается", async () => {
    const exact = "я".repeat(TELEGRAM_MESSAGE_LIMIT);
    await client().sendMessage({ chatId: 42, text: exact });

    expect(bodyOf(fetchFn.mock.calls[0]).text).toBe(exact);
  });
});

describe("clampMessageText", () => {
  it("закрывает теги, оставшиеся открытыми после обрезки", () => {
    const clamped = clampMessageText(`<b>${"я".repeat(TELEGRAM_MESSAGE_LIMIT)}</b>`);

    expect(clamped.length).toBeLessThanOrEqual(TELEGRAM_MESSAGE_LIMIT);
    expect(clamped.endsWith("</b>…")).toBe(true);
    // Незакрытый <b> Telegram отвергает с «can't parse entities», и сообщение
    // уходит без разметки — с тегами в виде текста.
    expect(countOf(clamped, "<b>")).toBe(countOf(clamped, "</b>"));
  });

  it("не разрезает тег пополам — где бы ни пришлась граница", () => {
    // Перебор смещений вместо одного «удачного»: так тест не зависит от того,
    // сколько именно клиент резервирует под закрывающие теги, и обязательно
    // накрывает случай, когда граница приходится внутрь «<b>».
    const limit = 60;

    for (let offset = 0; offset <= 40; offset++) {
      const text = `${"a".repeat(offset)}<b>жирный</b>${"x".repeat(200)}`;
      const clamped = clampMessageText(text, limit);

      expect(clamped.length).toBeLessThanOrEqual(limit);
      // Незакрытая «<» в конце — разрезанный пополам тег.
      expect(clamped).not.toMatch(/<[^>]*$/);
    }
  });

  it("не разрезает суррогатную пару пополам", () => {
    const clamped = clampMessageText("😀".repeat(TELEGRAM_MESSAGE_LIMIT));

    expect(clamped.length).toBeLessThanOrEqual(TELEGRAM_MESSAGE_LIMIT);
    // Одинокая половинка пары — «битый» символ вместо эмодзи.
    expect(clamped).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
    expect(clamped).not.toMatch(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
  });

  it("не разрезает суррогатную пару — где бы ни пришлась граница", () => {
    // Тот же перебор, что и для тегов: единственное «удачное» смещение
    // проходит и на сломанной обрезке — на этом уже обжигались. Эмодзи здесь
    // соседствует с разметкой, потому что оба правила применяются к одному
    // разрезу и мешать друг другу не должны.
    const limit = 60;

    for (let offset = 0; offset <= 60; offset++) {
      const text = `${"я".repeat(offset)}😀<b>жирный</b>${"я".repeat(200)}`;
      const clamped = clampMessageText(text, limit);

      expect(clamped.length, `смещение ${offset}`).toBeLessThanOrEqual(limit);
      expect(clamped, `смещение ${offset}`).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
      expect(clamped, `смещение ${offset}`).not.toMatch(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
      expect(clamped, `смещение ${offset}`).not.toMatch(/<[^>]*$/);
    }
  });

  it("короткий текст возвращается как есть", () => {
    expect(clampMessageText("привет")).toBe("привет");
  });
});

function countOf(text: string, needle: string): number {
  return text.split(needle).length - 1;
}
