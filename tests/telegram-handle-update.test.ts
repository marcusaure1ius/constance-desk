import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  allowedChatIdFromEnv,
  botToday,
  defaultDeps,
  handleUpdate,
  parseCommand,
  receiveUpdate,
  type BotBoard,
  type TelegramDeps,
} from "@/lib/telegram/handle-update";
import { createTelegramClient, TelegramApiError } from "@/lib/telegram/client";
import { readInbound, type Inbound } from "@/lib/telegram/inbound";
import { draftCallback, type DraftPayload } from "@/lib/telegram/draft";
import type { RouteDecision } from "@/lib/telegram/route";
import { parseTaskCallback, taskCallback } from "@/lib/telegram/task-card";
import type { TelegramUpdate } from "@/lib/telegram/types";

const CHAT = 555;

const BOARD: BotBoard = {
  environment: { id: "env-1", name: "Работа" },
  columns: [
    { id: "col-backlog", title: "Бэклог" },
    { id: "col-done", title: "Готово" },
  ],
};

/** UUID с четвёркой в версии: packUuid/unpackUuid принимают только настоящие. */
const TASK_ID = "3f1a2b3c-4d5e-4f60-8123-456789abcdef";
const OTHER_ID = "11111111-2222-4333-8444-555555555555";

/** Хендлы — по 10 символов base64url, как у newHandleId. */
const DRAFT_ID = "DRAFT12345";
const NEW_DRAFT_ID = "NEWDRAFT01";

/** Сообщение-заглушка «⏳ Разбираю…» — его message_id отдаёт sendMessage. */
const PLACEHOLDER = 100;
/** Карточка открытого черновика в чате. */
const DRAFT_CARD = 77;

const TASK_DETAILS = {
  task: {
    id: TASK_ID,
    title: "ответить по вэду",
    description: null,
    priority: "normal" as const,
    plannedDate: null,
    completedAt: null,
    createdAt: new Date("2026-08-20T10:00:00Z"),
    columnId: "col-backlog",
    categoryId: null,
  },
  column: { id: "col-backlog", title: "Бэклог" },
  environment: { id: "env-1", name: "Работа" },
  epic: null,
};

const HIT = {
  task: {
    id: TASK_ID,
    title: "ответить по вэду",
    priority: "normal" as const,
    completedAt: null,
    createdAt: new Date("2026-08-20T10:00:00Z"),
  },
  column: { id: "col-backlog", title: "Бэклог" },
  environment: { id: "env-1", name: "Работа" },
};

const CALLS = [
  { tool: "create_task", args: { title: "Позвонить Маше" }, label: "Задача «Позвонить Маше»" },
  { tool: "create_note", args: { title: "Синергия" }, label: "Заметка «Синергия»" },
];

const CAPTURE: RouteDecision = { route: "capture", correction: false, source: "jev", confidence: 0.9 };

function storedDraft(overrides: Partial<DraftPayload> = {}): DraftPayload {
  return {
    source: { text: "позвонить Маше", links: [], hasUnreadableMedia: false },
    corrections: [],
    calls: CALLS,
    agentText: "Нашёл дело и мысль",
    environmentId: "env-1",
    createdAt: "2026-08-25T10:00:00.000Z",
    ...overrides,
  };
}

function draftHandle(payload: unknown = storedDraft(), messageId: number | null = DRAFT_CARD) {
  return { id: DRAFT_ID, kind: "draft", payload, chatId: CHAT, messageId };
}

/** Мок из собранных зависимостей: подменённый через overrides, а не исходный. */
function asMock(value: unknown): ReturnType<typeof vi.fn> {
  return value as ReturnType<typeof vi.fn>;
}

function makeDeps(overrides: Partial<TelegramDeps> = {}) {
  const transcribe = vi.fn().mockResolvedValue("позвонить Маше");
  const fetchPreview = vi.fn().mockResolvedValue({});

  const deps: TelegramDeps = {
    client: {
      sendMessage: vi.fn().mockResolvedValue({ message_id: PLACEHOLDER }),
      editMessageText: vi.fn().mockResolvedValue(true),
      answerCallbackQuery: vi.fn().mockResolvedValue(true),
      getFile: vi.fn().mockResolvedValue({
        file_id: "voice-file-1",
        file_unique_id: "u1",
        file_path: "voice/file_1.oga",
      }),
      downloadFile: vi.fn().mockResolvedValue(new ArrayBuffer(1024)),
    },
    recordUpdate: vi.fn().mockResolvedValue(true),
    markProcessed: vi.fn().mockResolvedValue(undefined),
    markFailed: vi.fn().mockResolvedValue(undefined),
    loadUpdate: vi.fn().mockResolvedValue(null),
    loadBoard: vi.fn().mockResolvedValue(BOARD),
    allowedChatId: CHAT,

    // Настоящий разбор входа поверх фейкового клиента: голос, лимиты и
    // ошибки расшифровки проверяются сквозь обработчик.
    readInbound: vi.fn((message) =>
      readInbound(message, { client: deps.client, transcribe, fetchPreview })
    ),
    decideRoute: vi.fn().mockResolvedValue(CAPTURE),
    buildDraft: vi.fn().mockResolvedValue({ ok: true, calls: CALLS, agentText: "Нашёл дело и мысль" }),
    answerBoardQuestion: vi.fn().mockResolvedValue({ ok: true, html: "На сегодня: <b>отчёт</b>" }),
    extractSearchQuery: vi.fn().mockResolvedValue({ query: "вэду", done: false }),
    applyCalls: vi.fn().mockResolvedValue([
      { ok: true, data: { task: { id: TASK_ID, title: "Позвонить Маше" } } },
      { ok: true, data: { id: "note-1" } },
    ]),
    findActiveHandle: vi.fn().mockResolvedValue(null),
    updateHandle: vi.fn().mockResolvedValue(true),
    claimHandle: vi.fn().mockResolvedValue(null),
    cancelHandle: vi.fn().mockResolvedValue(undefined),
    today: () => "2026-08-25",

    getTask: vi.fn().mockResolvedValue(TASK_DETAILS),
    listEpics: vi.fn().mockResolvedValue([{ id: "epic-1", name: "Техдолг" }]),
    listColumns: vi.fn().mockResolvedValue([{ id: "col-backlog", title: "Бэклог" }]),
    listEnvironments: vi.fn().mockResolvedValue([{ id: "env-1", name: "Работа" }]),
    searchTasks: vi.fn().mockResolvedValue([HIT]),
    completeTask: vi.fn().mockResolvedValue(undefined),
    restoreTask: vi.fn().mockResolvedValue(undefined),
    updateTask: vi.fn().mockResolvedValue(undefined),
    deleteTask: vi.fn().mockResolvedValue(undefined),
    moveTaskToColumn: vi.fn().mockResolvedValue(undefined),
    moveTaskToEnvironment: vi.fn().mockResolvedValue(undefined),
    createEpic: vi.fn().mockResolvedValue({ id: "epic-2" }),
    createHandle: vi.fn().mockResolvedValue(NEW_DRAFT_ID),
    getHandle: vi.fn().mockResolvedValue(null),
    cancelAwaitInput: vi.fn().mockResolvedValue(undefined),
    takeAwaitInput: vi.fn().mockResolvedValue(null),
    now: () => new Date("2026-08-25T12:00:00Z"),
    ...overrides,
  };

  return {
    deps,
    transcribe,
    sendMessage: asMock(deps.client.sendMessage),
    editMessageText: asMock(deps.client.editMessageText),
    answerCallbackQuery: asMock(deps.client.answerCallbackQuery),
    getFile: asMock(deps.client.getFile),
    downloadFile: asMock(deps.client.downloadFile),
    recordUpdate: asMock(deps.recordUpdate),
    markProcessed: asMock(deps.markProcessed),
    markFailed: asMock(deps.markFailed),
    loadUpdate: asMock(deps.loadUpdate),
    decideRoute: asMock(deps.decideRoute),
    buildDraft: asMock(deps.buildDraft),
    answerBoardQuestion: asMock(deps.answerBoardQuestion),
    extractSearchQuery: asMock(deps.extractSearchQuery),
    applyCalls: asMock(deps.applyCalls),
    findActiveHandle: asMock(deps.findActiveHandle),
    updateHandle: asMock(deps.updateHandle),
    claimHandle: asMock(deps.claimHandle),
    cancelHandle: asMock(deps.cancelHandle),
    getTask: asMock(deps.getTask),
    searchTasks: asMock(deps.searchTasks),
    completeTask: asMock(deps.completeTask),
    updateTask: asMock(deps.updateTask),
    deleteTask: asMock(deps.deleteTask),
    createHandle: asMock(deps.createHandle),
    getHandle: asMock(deps.getHandle),
    takeAwaitInput: asMock(deps.takeAwaitInput),
    cancelAwaitInput: asMock(deps.cancelAwaitInput),
  };
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

const voiceUpdate = (updateId = 5, fileSize?: number): TelegramUpdate => ({
  update_id: updateId,
  message: {
    message_id: 11,
    date: 1_700_000_000,
    chat: { id: CHAT, type: "private" },
    voice: { file_id: "voice-file-1", file_unique_id: "u1", duration: 4, file_size: fileSize },
  },
});

/** Дата сообщения по умолчанию — «сегодня» относительно deps.now: кнопки живут неделю. */
const FRESH = Math.floor(new Date("2026-08-25T11:00:00Z").getTime() / 1000);

const callbackUpdate = (data: string, updateId = 9, date = FRESH): TelegramUpdate => ({
  update_id: updateId,
  callback_query: {
    id: "cb-1",
    from: { id: CHAT, is_bot: false, first_name: "Денис" },
    data,
    message: {
      message_id: 3,
      date,
      chat: { id: CHAT, type: "private" },
    },
  },
});

/** Текст последнего отправленного сообщения. */
function lastText(mock: ReturnType<typeof vi.fn>): string {
  const calls = mock.mock.calls;
  return calls[calls.length - 1][0].text as string;
}

/** Последняя правка сообщения `messageId`. */
function lastEditOf(editMessageText: ReturnType<typeof vi.fn>, messageId: number) {
  const calls = editMessageText.mock.calls.filter(([input]) => input.messageId === messageId);
  return calls.at(-1)?.[0] as
    | { text: string; replyMarkup?: { inline_keyboard: { text: string; callback_data?: string }[][] } }
    | undefined;
}

function codes(card: { replyMarkup?: { inline_keyboard: { callback_data?: string }[][] } } | undefined) {
  return (card?.replyMarkup?.inline_keyboard ?? []).flat().map((b) => b.callback_data);
}

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

    expect(markProcessed).toHaveBeenCalledWith(1, undefined);
    expect(markFailed).not.toHaveBeenCalled();
  });

  it("сбой отправки помечается ошибкой, а не теряется", async () => {
    const { deps, markFailed, markProcessed } = makeDeps({
      client: {
        sendMessage: vi.fn().mockRejectedValue(new Error("Telegram недоступен")),
        editMessageText: vi.fn(),
        answerCallbackQuery: vi.fn(),
        getFile: vi.fn(),
        downloadFile: vi.fn(),
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

describe("/start и /help", () => {
  beforeEach(() => vi.clearAllMocks());

  it("приветствие называет проект и колонку, куда лягут задачи", async () => {
    const { deps, sendMessage } = makeDeps();
    const result = await handleUpdate(textUpdate("/start"), CHAT, deps);

    expect(result).toEqual({ status: "processed", action: "start" });
    const [{ chatId, text }] = sendMessage.mock.calls[0];
    expect(chatId).toBe(CHAT);
    expect(text).toContain("Работа");
    expect(text).toContain("Бэклог");
  });

  it("приветствие объясняет черновик: без «Отправить» ничего не пишется", async () => {
    const { deps, sendMessage } = makeDeps();
    await handleUpdate(textUpdate("/start"), CHAT, deps);

    const [{ text }] = sendMessage.mock.calls[0];
    expect(text).toContain("черновик");
    expect(text).toContain("Отправить");
    expect(text).toContain("что у меня на сегодня");
    expect(text).toContain("найди задачу про");
  });

  it("экранирует имя проекта в разметке", async () => {
    const { deps, sendMessage } = makeDeps({
      loadBoard: vi.fn().mockResolvedValue({
        ...BOARD,
        environment: { id: "env-1", name: "Цены & <ККУ>" },
      }),
    });
    await handleUpdate(textUpdate("/start"), CHAT, deps);

    const [{ text }] = sendMessage.mock.calls[0];
    expect(text).toContain("Цены &amp; &lt;ККУ&gt;");
    expect(text).not.toContain("<ККУ>");
  });

  it("без сред говорит, что проектов нет", async () => {
    const { deps, sendMessage } = makeDeps({ loadBoard: vi.fn().mockResolvedValue(null) });
    await handleUpdate(textUpdate("/start"), CHAT, deps);

    expect(sendMessage.mock.calls[0][0].text).toContain("Проектов пока нет");
  });

  it("понимает команду с упоминанием бота", async () => {
    const { deps } = makeDeps();
    const result = await handleUpdate(textUpdate("/start@constance_bot"), CHAT, deps);
    expect(result).toEqual({ status: "processed", action: "start" });
  });

  it("/help перечисляет команды", async () => {
    const { deps, sendMessage } = makeDeps();
    const result = await handleUpdate(textUpdate("/help"), CHAT, deps);

    expect(result).toEqual({ status: "processed", action: "help" });
    const [{ text }] = sendMessage.mock.calls[0];
    expect(text).toContain("/start");
    expect(text).toContain("/help");
  });

  it("команда не уходит ни в Jev, ни в агента", async () => {
    const { deps, decideRoute, buildDraft } = makeDeps();
    await handleUpdate(textUpdate("/help"), CHAT, deps);

    expect(decideRoute).not.toHaveBeenCalled();
    expect(buildDraft).not.toHaveBeenCalled();
  });
});

describe("захват: сообщение → черновик", () => {
  beforeEach(() => vi.clearAllMocks());

  it("сначала заглушка «Разбираю», потом она же становится карточкой черновика", async () => {
    const { deps, sendMessage, editMessageText, decideRoute, buildDraft, createHandle, applyCalls } =
      makeDeps();

    const result = await handleUpdate(textUpdate("позвонить Маше"), CHAT, deps);

    expect(result).toEqual({ status: "processed", action: "draft" });
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0][0]).toMatchObject({ chatId: CHAT, text: "⏳ Разбираю…" });

    const inbound: Inbound = { text: "позвонить Маше", links: [], hasUnreadableMedia: false };
    expect(decideRoute).toHaveBeenCalledWith(inbound, null);
    expect(buildDraft).toHaveBeenCalledWith({
      inbound,
      environmentId: "env-1",
      today: "2026-08-25",
    });

    expect(createHandle).toHaveBeenCalledWith({
      kind: "draft",
      chatId: CHAT,
      messageId: PLACEHOLDER,
      payload: expect.objectContaining({
        source: inbound,
        corrections: [],
        calls: CALLS,
        agentText: "Нашёл дело и мысль",
        environmentId: "env-1",
      }),
    });

    const card = lastEditOf(editMessageText, PLACEHOLDER)!;
    expect(card.text).toContain("Черновик");
    expect(card.text).toContain("Позвонить Маше");
    expect(codes(card)).toEqual([
      draftCallback.send(NEW_DRAFT_ID),
      draftCallback.fix(NEW_DRAFT_ID),
      draftCallback.cancel(NEW_DRAFT_ID),
    ]);

    // До «Отправить» на доску не уходит ничего.
    expect(applyCalls).not.toHaveBeenCalled();
  });

  it("в журнал уходят маршрут, подписи вызовов и текст агента", async () => {
    const { deps, markProcessed } = makeDeps();

    await handleUpdate(textUpdate("позвонить Маше"), CHAT, deps);

    expect(markProcessed).toHaveBeenCalledWith(1, {
      route: CAPTURE,
      calls: ["Задача «Позвонить Маше»", "Заметка «Синергия»"],
      agentText: "Нашёл дело и мысль",
    });
  });

  it("голосовое расшифровывается и уходит агенту с транскриптом", async () => {
    const { deps, getFile, downloadFile, transcribe, buildDraft, editMessageText, markProcessed } =
      makeDeps();

    const result = await handleUpdate(voiceUpdate(), CHAT, deps);

    expect(result).toEqual({ status: "processed", action: "draft" });
    expect(getFile).toHaveBeenCalledWith("voice-file-1");
    expect(downloadFile).toHaveBeenCalledWith("voice/file_1.oga");
    const [file] = transcribe.mock.calls[0] as [File];
    expect(file.name).toBe("voice.ogg");

    expect(buildDraft.mock.calls[0][0].inbound).toMatchObject({
      text: "позвонить Маше",
      transcript: "позвонить Маше",
    });
    expect(lastEditOf(editMessageText, PLACEHOLDER)!.text).toContain("🎙");
    expect(markProcessed.mock.calls[0][1]).toMatchObject({ transcript: "позвонить Маше" });
  });

  it("голосовое больше лимита Telegram даже не качается: причина и кнопка повтора", async () => {
    const { deps, getFile, editMessageText, buildDraft, markFailed } = makeDeps();

    const result = await handleUpdate(voiceUpdate(6, 21 * 1024 * 1024), CHAT, deps);

    expect(getFile).not.toHaveBeenCalled();
    expect(buildDraft).not.toHaveBeenCalled();
    expect(result.status).toBe("failed");
    const card = lastEditOf(editMessageText, PLACEHOLDER)!;
    expect(card.text).toContain("Не разобрал");
    expect(card.text).toContain("20 МБ");
    expect(codes(card)).toEqual([draftCallback.retry(6)]);
    expect(markFailed).toHaveBeenCalled();
  });

  it("сбой расшифровки не молчит: причина и кнопка повтора", async () => {
    const { deps, transcribe, editMessageText, buildDraft } = makeDeps();
    transcribe.mockRejectedValue(new Error("Модель openrouter: 429 Rate limit"));

    const result = await handleUpdate(voiceUpdate(), CHAT, deps);

    expect(result.status).toBe("failed");
    expect(buildDraft).not.toHaveBeenCalled();
    const card = lastEditOf(editMessageText, PLACEHOLDER)!;
    expect(card.text).toContain("429");
    expect(codes(card)).toEqual([draftCallback.retry(5)]);
  });

  it("картинка без подписи: честно говорим, что пока не читаем", async () => {
    const { deps, editMessageText, decideRoute, buildDraft } = makeDeps();
    const update: TelegramUpdate = {
      update_id: 2,
      message: {
        message_id: 12,
        date: 1,
        chat: { id: CHAT, type: "private" },
        photo: [{ file_id: "p1" }],
      },
    };

    const result = await handleUpdate(update, CHAT, deps);

    expect(result).toEqual({ status: "processed", action: "unsupported" });
    expect(decideRoute).not.toHaveBeenCalled();
    expect(buildDraft).not.toHaveBeenCalled();
    expect(lastEditOf(editMessageText, PLACEHOLDER)!.text).toContain(
      "Картинки и файлы пока не читаю"
    );
  });

  it("сбой агента: черновика нет, в заглушке причина и кнопка повтора", async () => {
    const { deps, editMessageText, createHandle, markFailed } = makeDeps({
      buildDraft: vi.fn().mockResolvedValue({ ok: false, error: "Модель <молчит>" }),
    });

    const result = await handleUpdate(textUpdate("позвонить Маше"), CHAT, deps);

    expect(result).toEqual({ status: "failed", error: "Модель <молчит>" });
    expect(createHandle).not.toHaveBeenCalled();
    const card = lastEditOf(editMessageText, PLACEHOLDER)!;
    expect(card.text).toContain("Модель &lt;молчит&gt;");
    expect(codes(card)).toEqual([draftCallback.retry(1)]);
    expect(markFailed).toHaveBeenCalledWith(1, "Модель <молчит>");
  });

  it.each([
    ["агент бросил", { buildDraft: vi.fn().mockRejectedValue(new Error("boom")) }],
    ["база недоступна", { loadBoard: vi.fn().mockRejectedValue(new Error("db down")) }],
    ["Jev бросил", { decideRoute: vi.fn().mockRejectedValue(new Error("jev")) }],
  ])("исключение после заглушки (%s): она становится «не разобрал» с повтором", async (_n, over) => {
    const { deps, editMessageText, markFailed } = makeDeps(over as Partial<TelegramDeps>);

    const result = await handleUpdate(textUpdate("позвонить Маше"), CHAT, deps);

    expect(result.status).toBe("failed");
    const card = lastEditOf(editMessageText, PLACEHOLDER)!;
    expect(card.text).toContain("внутренняя ошибка");
    expect(codes(card)).toEqual([draftCallback.retry(1)]);
    expect(markFailed).toHaveBeenCalledWith(1, expect.any(String));
  });

  it("исключение, а заглушку поправить нельзя — апдейт всё равно failed", async () => {
    const { deps, markFailed } = makeDeps({
      buildDraft: vi.fn().mockRejectedValue(new Error("boom")),
    });
    deps.client.editMessageText = vi.fn().mockRejectedValue(new TypeError("fetch failed")) as never;

    const result = await handleUpdate(textUpdate("позвонить Маше"), CHAT, deps);

    expect(result).toEqual({ status: "failed", error: "boom" });
    expect(markFailed).toHaveBeenCalledWith(1, "boom");
  });

  it("пересылка из канала тоже собирает черновик", async () => {
    const { deps, buildDraft, createHandle } = makeDeps({
      decideRoute: vi.fn().mockResolvedValue({ route: "forward", correction: false, source: "rule" }),
    });

    const result = await handleUpdate(textUpdate("пост про стратегию"), CHAT, deps);

    expect(result).toEqual({ status: "processed", action: "draft" });
    expect(buildDraft).toHaveBeenCalled();
    expect(createHandle).toHaveBeenCalledWith(expect.objectContaining({ kind: "draft" }));
  });

  it("новая запись при открытом черновике не трогает старый", async () => {
    const { deps, cancelHandle, updateHandle, createHandle, buildDraft } = makeDeps({
      findActiveHandle: vi.fn().mockResolvedValue(draftHandle()),
    });

    await handleUpdate(textUpdate("купить хлеб"), CHAT, deps);

    expect(buildDraft.mock.calls[0][0].previous).toBeUndefined();
    expect(createHandle).toHaveBeenCalledWith(expect.objectContaining({ kind: "draft" }));
    expect(cancelHandle).not.toHaveBeenCalled();
    expect(updateHandle).not.toHaveBeenCalled();
  });

  it("нет ни одного проекта — говорим об этом, агента не зовём", async () => {
    const { deps, buildDraft, editMessageText } = makeDeps({
      loadBoard: vi.fn().mockResolvedValue(null),
    });

    await handleUpdate(textUpdate("позвонить Маше"), CHAT, deps);

    expect(buildDraft).not.toHaveBeenCalled();
    expect(lastEditOf(editMessageText, PLACEHOLDER)!.text).toContain("Проектов пока нет");
  });
});

describe("поправка к черновику", () => {
  beforeEach(() => vi.clearAllMocks());

  it("правит карточку ОТКРЫТОГО черновика и не заводит новый хендл", async () => {
    const correction: RouteDecision = { route: "capture", correction: true, source: "jev", confidence: 0.8 };
    const newCalls = [CALLS[0]];
    const {
      deps,
      decideRoute,
      buildDraft,
      updateHandle,
      createHandle,
      editMessageText,
    } = makeDeps({
      findActiveHandle: vi.fn().mockResolvedValue(draftHandle()),
      decideRoute: vi.fn().mockResolvedValue(correction),
      buildDraft: vi.fn().mockResolvedValue({ ok: true, calls: newCalls, agentText: "Убрал заметку" }),
    });

    const result = await handleUpdate(textUpdate("заметку не надо"), CHAT, deps);

    expect(result).toEqual({ status: "processed", action: "correction" });
    expect(decideRoute).toHaveBeenCalledWith(expect.objectContaining({ text: "заметку не надо" }), {
      summary: "Задача «Позвонить Маше»; Заметка «Синергия»",
      createdAt: new Date("2026-08-25T10:00:00.000Z"),
    });
    expect(buildDraft).toHaveBeenCalledWith({
      inbound: expect.objectContaining({ text: "заметку не надо" }),
      environmentId: "env-1",
      today: "2026-08-25",
      previous: storedDraft(),
      correction: "заметку не надо",
    });

    expect(createHandle).not.toHaveBeenCalled();
    expect(updateHandle).toHaveBeenCalledWith(DRAFT_ID, {
      payload: storedDraft({
        corrections: ["заметку не надо"],
        calls: newCalls,
        agentText: "Убрал заметку",
      }),
    });

    const card = lastEditOf(editMessageText, DRAFT_CARD)!;
    expect(card.text).toContain("правка 1");
    expect(codes(card)).toContain(draftCallback.send(DRAFT_ID));
    expect(lastEditOf(editMessageText, PLACEHOLDER)!.text).toContain("Поправил черновик выше");
  });

  it("черновик отправили, пока агент думал над поправкой: старую карточку не трогаем", async () => {
    // Хендл был открыт при чтении, но к моменту записи «Отправить» его уже
    // забрал: updateHandle ничего не обновил. Отчёт «Создано N из N» на старой
    // карточке должен остаться, а сообщение — стать новой записью.
    const { deps, buildDraft, updateHandle, createHandle, editMessageText } = makeDeps({
      findActiveHandle: vi.fn().mockResolvedValue(draftHandle()),
      decideRoute: vi.fn().mockResolvedValue({ ...CAPTURE, correction: true }),
      updateHandle: vi.fn().mockResolvedValue(false),
    });

    const result = await handleUpdate(textUpdate("заметку не надо"), CHAT, deps);

    expect(result).toEqual({ status: "processed", action: "draft" });
    expect(updateHandle).toHaveBeenCalledWith(DRAFT_ID, expect.anything());
    expect(lastEditOf(editMessageText, DRAFT_CARD)).toBeUndefined();

    // Вторая сборка — как новая запись, без прошлого черновика.
    expect(buildDraft).toHaveBeenCalledTimes(2);
    expect(buildDraft.mock.calls[1][0].previous).toBeUndefined();
    expect(createHandle).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "draft", messageId: PLACEHOLDER })
    );

    const card = lastEditOf(editMessageText, PLACEHOLDER)!;
    expect(card.text).toContain("Черновик выше уже закрыт — разобрал сообщение как новую запись");
    expect(codes(card)).toContain(draftCallback.send(NEW_DRAFT_ID));
  });

  it("правка хендла записывается раньше, чем правится карточка", async () => {
    const { deps, updateHandle, editMessageText } = makeDeps({
      findActiveHandle: vi.fn().mockResolvedValue(draftHandle()),
      decideRoute: vi.fn().mockResolvedValue({ ...CAPTURE, correction: true }),
    });

    await handleUpdate(textUpdate("заметку не надо"), CHAT, deps);

    const cardEdit = editMessageText.mock.calls.findIndex(([input]) => input.messageId === DRAFT_CARD);
    expect(updateHandle.mock.invocationCallOrder[0]).toBeLessThan(
      editMessageText.mock.invocationCallOrder[cardEdit]
    );
  });

  it("поправка после «Отправить» или «Отмены» — обычная новая запись", async () => {
    // Хендл уже не активен: findActiveHandle его не отдаёт. Даже если бы Jev
    // ответил «поправка», править нечего — это новый черновик.
    const { deps, decideRoute, buildDraft, createHandle, updateHandle } = makeDeps({
      decideRoute: vi.fn().mockResolvedValue({ ...CAPTURE, correction: true }),
    });

    const result = await handleUpdate(textUpdate("а срок — понедельник"), CHAT, deps);

    expect(result).toEqual({ status: "processed", action: "draft" });
    expect(decideRoute).toHaveBeenCalledWith(expect.anything(), null);
    expect(buildDraft.mock.calls[0][0].previous).toBeUndefined();
    expect(createHandle).toHaveBeenCalledWith(expect.objectContaining({ kind: "draft" }));
    expect(updateHandle).not.toHaveBeenCalled();
  });

  it("битый payload открытого черновика — обычная новая запись", async () => {
    const { deps, decideRoute, createHandle } = makeDeps({
      findActiveHandle: vi.fn().mockResolvedValue(draftHandle({ мусор: true })),
    });

    await handleUpdate(textUpdate("купить хлеб"), CHAT, deps);

    expect(decideRoute).toHaveBeenCalledWith(expect.anything(), null);
    expect(createHandle).toHaveBeenCalledWith(expect.objectContaining({ kind: "draft" }));
  });

  it("сбой агента на поправке не портит черновик", async () => {
    const { deps, updateHandle, editMessageText } = makeDeps({
      findActiveHandle: vi.fn().mockResolvedValue(draftHandle()),
      decideRoute: vi.fn().mockResolvedValue({ ...CAPTURE, correction: true }),
      buildDraft: vi.fn().mockResolvedValue({ ok: false, error: "таймаут" }),
    });

    const result = await handleUpdate(textUpdate("заметку не надо"), CHAT, deps);

    expect(result.status).toBe("failed");
    expect(updateHandle).not.toHaveBeenCalled();
    expect(lastEditOf(editMessageText, DRAFT_CARD)).toBeUndefined();
    expect(lastEditOf(editMessageText, PLACEHOLDER)!.text).toContain("таймаут");
  });
});

describe("«отправляй» при открытом черновике", () => {
  beforeEach(() => vi.clearAllMocks());

  const CONFIRM: RouteDecision = { route: "capture", correction: false, confirm: true, source: "jev" };

  it("ничего не применяет: свежая карточка в заглушке, у старой кнопки сняты", async () => {
    const { deps, buildDraft, applyCalls, claimHandle, createHandle, updateHandle, editMessageText } =
      makeDeps({
        findActiveHandle: vi.fn().mockResolvedValue(draftHandle()),
        decideRoute: vi.fn().mockResolvedValue(CONFIRM),
      });

    const result = await handleUpdate(textUpdate("Все, отправляй короче на доску. Пофиг."), CHAT, deps);

    expect(result).toEqual({ status: "processed", action: "confirm" });
    // Ни агента, ни применения, ни нового хендла.
    expect(buildDraft).not.toHaveBeenCalled();
    expect(applyCalls).not.toHaveBeenCalled();
    expect(claimHandle).not.toHaveBeenCalled();
    expect(createHandle).not.toHaveBeenCalled();
    // Хендл теперь ведёт на новую карточку, payload не трогается.
    expect(updateHandle).toHaveBeenCalledTimes(1);
    expect(updateHandle).toHaveBeenCalledWith(DRAFT_ID, { messageId: PLACEHOLDER });

    const fresh = lastEditOf(editMessageText, PLACEHOLDER)!;
    expect(fresh.text).toContain("Проверьте и нажмите «✅ Отправить»");
    expect(fresh.text).toContain("Позвонить Маше");
    expect(codes(fresh)).toEqual([
      draftCallback.send(DRAFT_ID),
      draftCallback.fix(DRAFT_ID),
      draftCallback.cancel(DRAFT_ID),
    ]);

    const old = lastEditOf(editMessageText, DRAFT_CARD)!;
    expect(old.text).toBe("Черновик ниже ↓");
    expect(old.replyMarkup).toBeUndefined();
  });

  it("черновик отправили, пока решал Jev: «нечего отправлять», старая карточка не трогается", async () => {
    const { deps, editMessageText, applyCalls } = makeDeps({
      findActiveHandle: vi.fn().mockResolvedValue(draftHandle()),
      decideRoute: vi.fn().mockResolvedValue(CONFIRM),
      updateHandle: vi.fn().mockResolvedValue(false),
    });

    const result = await handleUpdate(textUpdate("да, записывай"), CHAT, deps);

    expect(result).toEqual({ status: "processed", action: "confirm" });
    expect(applyCalls).not.toHaveBeenCalled();
    expect(lastEditOf(editMessageText, PLACEHOLDER)!.text).toBe(
      "Нечего отправлять — открытого черновика нет."
    );
    expect(lastEditOf(editMessageText, DRAFT_CARD)).toBeUndefined();
  });

  it("пустой черновик — нечего отправлять, хендл не двигается", async () => {
    const { deps, editMessageText, updateHandle } = makeDeps({
      findActiveHandle: vi.fn().mockResolvedValue(draftHandle(storedDraft({ calls: [] }))),
      decideRoute: vi.fn().mockResolvedValue(CONFIRM),
    });

    await handleUpdate(textUpdate("ок, на доску"), CHAT, deps);

    expect(updateHandle).not.toHaveBeenCalled();
    expect(lastEditOf(editMessageText, PLACEHOLDER)!.text).toContain("Нечего отправлять");
  });

  it("старую карточку удалили из чата — свежая всё равно показана", async () => {
    const editMessageText = vi.fn(async (input: { messageId: number }) => {
      if (input.messageId === DRAFT_CARD) {
        throw new TelegramApiError("editMessageText", 400, "Bad Request: message to edit not found");
      }
      return true;
    });
    const { deps } = makeDeps({
      findActiveHandle: vi.fn().mockResolvedValue(draftHandle()),
      decideRoute: vi.fn().mockResolvedValue(CONFIRM),
    });
    deps.client.editMessageText = editMessageText as unknown as typeof deps.client.editMessageText;

    const result = await handleUpdate(textUpdate("да, записывай"), CHAT, deps);

    expect(result).toEqual({ status: "processed", action: "confirm" });
    expect(lastEditOf(asMock(editMessageText), PLACEHOLDER)!.text).toContain("Проверьте");
  });

  it("после «отправляй» кнопка свежей карточки применяет черновик ровно один раз", async () => {
    const claimHandle = vi
      .fn()
      .mockResolvedValueOnce({ id: DRAFT_ID, kind: "draft", payload: storedDraft() })
      .mockResolvedValue(null);
    const { deps, applyCalls } = makeDeps({
      findActiveHandle: vi.fn().mockResolvedValue(draftHandle()),
      decideRoute: vi.fn().mockResolvedValue(CONFIRM),
      claimHandle,
    });

    await handleUpdate(textUpdate("отправляй"), CHAT, deps);
    expect(applyCalls).not.toHaveBeenCalled();

    // Нажали и на новой, и на старой карточке (если клавиатура не успела сняться).
    await handleUpdate(callbackUpdate(draftCallback.send(DRAFT_ID), 20), CHAT, deps);
    await handleUpdate(callbackUpdate(draftCallback.send(DRAFT_ID), 21), CHAT, deps);
    expect(applyCalls).toHaveBeenCalledTimes(1);
  });
});

describe("поправка: карточку не удалось обновить", () => {
  beforeEach(() => vi.clearAllMocks());

  const NEW_CALLS = [CALLS[0]];

  function correctionDeps(editError: Error) {
    const editMessageText = vi.fn(async (input: { messageId: number }) => {
      if (input.messageId === DRAFT_CARD) throw editError;
      return true as const;
    });
    const made = makeDeps({
      findActiveHandle: vi.fn().mockResolvedValue(draftHandle()),
      decideRoute: vi.fn().mockResolvedValue({ ...CAPTURE, correction: true }),
      buildDraft: vi.fn().mockResolvedValue({ ok: true, calls: NEW_CALLS, agentText: "Убрал заметку" }),
    });
    made.deps.client.editMessageText = editMessageText as never;
    return { ...made, editMessageText };
  }

  it("карточку удалили из чата — черновик переезжает в заглушку", async () => {
    const { deps, updateHandle, editMessageText } = correctionDeps(
      new TelegramApiError("editMessageText", 400, "Bad Request: message to edit not found")
    );

    const result = await handleUpdate(textUpdate("заметку не надо"), CHAT, deps);

    expect(result).toEqual({ status: "processed", action: "correction" });
    expect(updateHandle).toHaveBeenCalledWith(DRAFT_ID, { messageId: PLACEHOLDER });
    const card = lastEditOf(editMessageText as never, PLACEHOLDER)!;
    expect(card.text).toContain("правка 1");
    expect(codes(card)).toContain(draftCallback.send(DRAFT_ID));
  });

  it.each([
    ["сеть", new TypeError("fetch failed")],
    ["флуд-лимит", new TelegramApiError("editMessageText", 429, "Too Many Requests", 120)],
    ["другая 400", new TelegramApiError("editMessageText", 400, "Bad Request: can't parse entities")],
  ])("%s: хендл откатывается к прежним вызовам, в заглушке — повтор", async (_name, error) => {
    const { deps, updateHandle, editMessageText } = correctionDeps(error);

    const result = await handleUpdate(textUpdate("заметку не надо"), CHAT, deps);

    expect(result.status).toBe("failed");
    // Сначала записали новую версию, потом вернули прежнюю: «Отправить» на
    // старой карточке применит ровно то, что на ней видно.
    expect(updateHandle).toHaveBeenNthCalledWith(1, DRAFT_ID, {
      payload: expect.objectContaining({ calls: NEW_CALLS }),
    });
    expect(updateHandle).toHaveBeenLastCalledWith(DRAFT_ID, { payload: storedDraft() });
    expect(updateHandle).not.toHaveBeenCalledWith(DRAFT_ID, { messageId: PLACEHOLDER });

    const placeholder = lastEditOf(editMessageText as never, PLACEHOLDER)!;
    expect(placeholder.text).toContain("Не разобрал");
    expect(codes(placeholder)).toEqual([draftCallback.retry(1)]);
  });

  it("сбой стрелки «Поправил выше» не превращает готовую поправку в ошибку", async () => {
    const editMessageText = vi.fn(async (input: { messageId: number }) => {
      if (input.messageId === PLACEHOLDER) throw new TypeError("fetch failed");
      return true as const;
    });
    const { deps } = makeDeps({
      findActiveHandle: vi.fn().mockResolvedValue(draftHandle()),
      decideRoute: vi.fn().mockResolvedValue({ ...CAPTURE, correction: true }),
    });
    deps.client.editMessageText = editMessageText as never;

    const result = await handleUpdate(textUpdate("заметку не надо"), CHAT, deps);

    expect(result).toEqual({ status: "processed", action: "correction" });
  });
});

describe("вопрос к доске, поиск задачи, болтовня", () => {
  beforeEach(() => vi.clearAllMocks());

  it("ask_board отвечает текстом в заглушке и ничего не пишет", async () => {
    const { deps, answerBoardQuestion, buildDraft, applyCalls, createHandle, editMessageText } =
      makeDeps({
        decideRoute: vi.fn().mockResolvedValue({ route: "ask_board", correction: false, source: "jev" }),
      });

    const result = await handleUpdate(textUpdate("что у меня на сегодня?"), CHAT, deps);

    expect(result).toEqual({ status: "processed", action: "ask_board" });
    expect(answerBoardQuestion).toHaveBeenCalledWith("что у меня на сегодня?", {
      environmentId: "env-1",
      today: "2026-08-25",
    });
    expect(lastEditOf(editMessageText, PLACEHOLDER)!.text).toBe("На сегодня: <b>отчёт</b>");
    expect(buildDraft).not.toHaveBeenCalled();
    expect(applyCalls).not.toHaveBeenCalled();
    expect(createHandle).not.toHaveBeenCalled();
  });

  it("ask_board: сбой агента виден в заглушке и в журнале", async () => {
    const { deps, editMessageText, markFailed } = makeDeps({
      decideRoute: vi.fn().mockResolvedValue({ route: "ask_board", correction: false, source: "jev" }),
      answerBoardQuestion: vi.fn().mockResolvedValue({ ok: false, error: "нет ответа" }),
    });

    const result = await handleUpdate(textUpdate("что горит?"), CHAT, deps);

    expect(result.status).toBe("failed");
    expect(markFailed).toHaveBeenCalledWith(1, "нет ответа");
    expect(lastEditOf(editMessageText, PLACEHOLDER)!.text).toContain("нет ответа");
  });

  it("find_task ищет по ключевым словам и показывает карточку с кнопкой", async () => {
    const { deps, extractSearchQuery, searchTasks, completeTask, buildDraft, editMessageText } =
      makeDeps({
        decideRoute: vi.fn().mockResolvedValue({ route: "find_task", correction: false, source: "jev" }),
        extractSearchQuery: vi.fn().mockResolvedValue({ query: "вэду", done: true }),
        searchTasks: vi.fn().mockResolvedValue([
          HIT,
          { ...HIT, task: { ...HIT.task, id: OTHER_ID, title: "Заполнить пилот по вэду" } },
        ]),
      });

    const result = await handleUpdate(textUpdate("ответил по вэду"), CHAT, deps);

    expect(result).toEqual({ status: "processed", action: "find_task" });
    expect(extractSearchQuery).toHaveBeenCalledWith("ответил по вэду");
    expect(searchTasks).toHaveBeenCalledWith("вэду", expect.any(Number));
    expect(buildDraft).not.toHaveBeenCalled();
    // Закрывает задачу кнопка, а не фраза.
    expect(completeTask).not.toHaveBeenCalled();

    const card = lastEditOf(editMessageText, PLACEHOLDER)!;
    expect(card.text).toContain("уже сделана");
    expect(
      codes(card).some((code) => parseTaskCallback(code)?.kind === "done")
    ).toBe(true);
    // Кнопки «задачей как есть» больше нет: старого захвата нет.
    expect(card.replyMarkup!.inline_keyboard.flat().map((b) => b.text)).not.toContain(
      "Нет, это новая задача"
    );
  });

  it("smalltalk отвечает подсказкой без агента", async () => {
    const { deps, buildDraft, answerBoardQuestion, editMessageText } = makeDeps({
      decideRoute: vi.fn().mockResolvedValue({ route: "smalltalk", correction: false, source: "jev" }),
    });

    const result = await handleUpdate(textUpdate("привет"), CHAT, deps);

    expect(result).toEqual({ status: "processed", action: "smalltalk" });
    expect(buildDraft).not.toHaveBeenCalled();
    expect(answerBoardQuestion).not.toHaveBeenCalled();
    expect(lastEditOf(editMessageText, PLACEHOLDER)!.text).toContain("/start");
  });
});

describe("кнопки черновика", () => {
  beforeEach(() => vi.clearAllMocks());

  it("«Отправить» дважды применяет черновик один раз", async () => {
    const claimHandle = vi
      .fn()
      .mockResolvedValueOnce(draftHandle())
      .mockResolvedValueOnce(null);
    const { deps, applyCalls, editMessageText, answerCallbackQuery } = makeDeps({ claimHandle });

    const first = await handleUpdate(callbackUpdate(draftCallback.send(DRAFT_ID)), CHAT, deps);
    const firstCard = lastEditOf(editMessageText, 3)!;
    const second = await handleUpdate(callbackUpdate(draftCallback.send(DRAFT_ID), 10), CHAT, deps);
    const secondCard = lastEditOf(editMessageText, 3)!;

    expect(first).toEqual({ status: "processed", action: "callback" });
    expect(second).toEqual({ status: "processed", action: "callback" });
    expect(claimHandle).toHaveBeenCalledWith(DRAFT_ID);
    expect(applyCalls).toHaveBeenCalledTimes(1);
    expect(applyCalls).toHaveBeenCalledWith(CALLS);

    expect(firstCard.text).toContain("Готово: 2 из 2");
    expect(codes(firstCard)).toEqual([taskCallback.back(TASK_ID)]);
    expect(secondCard.text).toContain("уже отправлен");
    expect(secondCard.replyMarkup).toBeUndefined();

    expect(answerCallbackQuery.mock.invocationCallOrder[0]).toBeLessThan(
      claimHandle.mock.invocationCallOrder[0]
    );
  });

  it("«Отправить» на битом payload ничего не применяет", async () => {
    const { deps, applyCalls, editMessageText } = makeDeps({
      claimHandle: vi.fn().mockResolvedValue(draftHandle({ calls: "мусор" })),
    });

    await handleUpdate(callbackUpdate(draftCallback.send(DRAFT_ID)), CHAT, deps);

    expect(applyCalls).not.toHaveBeenCalled();
    const card = lastEditOf(editMessageText, 3)!;
    expect(card.text).toContain("устарел");
    expect(card.replyMarkup).toBeUndefined();
  });

  it("«Отмена» закрывает черновик и снимает клавиатуру", async () => {
    const { deps, cancelHandle, applyCalls, editMessageText } = makeDeps({
      getHandle: vi.fn().mockResolvedValue(draftHandle()),
    });

    await handleUpdate(callbackUpdate(draftCallback.cancel(DRAFT_ID)), CHAT, deps);

    expect(cancelHandle).toHaveBeenCalledWith(DRAFT_ID);
    expect(applyCalls).not.toHaveBeenCalled();
    const card = lastEditOf(editMessageText, 3)!;
    expect(card.text).toContain("отменён");
    expect(card.replyMarkup).toBeUndefined();
  });

  it("«Отмена» на уже закрытом черновике — «устарел», без кнопок", async () => {
    const { deps, cancelHandle, editMessageText } = makeDeps();

    await handleUpdate(callbackUpdate(draftCallback.cancel(DRAFT_ID)), CHAT, deps);

    expect(cancelHandle).not.toHaveBeenCalled();
    const card = lastEditOf(editMessageText, 3)!;
    expect(card.text).toContain("устарел");
    expect(card.replyMarkup).toBeUndefined();
  });

  it("кнопка черновика старше недели ничего не делает", async () => {
    const { deps, claimHandle, applyCalls, editMessageText } = makeDeps();
    const stale = Math.floor(new Date("2026-07-01T12:00:00Z").getTime() / 1000);

    await handleUpdate(callbackUpdate(draftCallback.send(DRAFT_ID), 9, stale), CHAT, deps);

    expect(claimHandle).not.toHaveBeenCalled();
    expect(applyCalls).not.toHaveBeenCalled();
    const card = lastEditOf(editMessageText, 3)!;
    expect(card.text).toContain("устарел");
    expect(card.replyMarkup).toBeUndefined();
  });

  it("«Исправить» ставит ожидание ввода и спрашивает, что поправить", async () => {
    const { deps, createHandle, cancelAwaitInput, sendMessage } = makeDeps({
      getHandle: vi.fn().mockResolvedValue(draftHandle()),
    });

    await handleUpdate(callbackUpdate(draftCallback.fix(DRAFT_ID)), CHAT, deps);

    expect(cancelAwaitInput).toHaveBeenCalledWith(CHAT);
    expect(createHandle).toHaveBeenCalledWith({
      kind: "await_input",
      payload: { draftHandleId: DRAFT_ID },
      chatId: CHAT,
      messageId: 3,
    });
    expect(lastText(sendMessage)).toContain("Что поправить? Напишите или надиктуйте");
  });

  it("«Исправить» на закрытом черновике — «устарел», ожидания нет", async () => {
    const { deps, createHandle, editMessageText } = makeDeps();

    await handleUpdate(callbackUpdate(draftCallback.fix(DRAFT_ID)), CHAT, deps);

    expect(createHandle).not.toHaveBeenCalled();
    expect(lastEditOf(editMessageText, 3)!.text).toContain("устарел");
  });

  it("после «Исправить» следующее сообщение — поправка без вопроса к Jev", async () => {
    const { deps, decideRoute, buildDraft, updateHandle, createHandle, editMessageText, getHandle } =
      makeDeps({
        takeAwaitInput: vi.fn().mockResolvedValue({
          payload: { draftHandleId: DRAFT_ID },
          messageId: DRAFT_CARD,
        }),
        getHandle: vi.fn().mockResolvedValue(draftHandle()),
      });

    const result = await handleUpdate(textUpdate("срок — понедельник"), CHAT, deps);

    expect(result).toEqual({ status: "processed", action: "correction" });
    expect(getHandle).toHaveBeenCalledWith(DRAFT_ID);
    expect(decideRoute).not.toHaveBeenCalled();
    expect(buildDraft).toHaveBeenCalledWith(
      expect.objectContaining({ previous: storedDraft(), correction: "срок — понедельник" })
    );
    expect(createHandle).not.toHaveBeenCalled();
    expect(updateHandle).toHaveBeenCalledWith(DRAFT_ID, expect.anything());
    expect(lastEditOf(editMessageText, DRAFT_CARD)!.text).toContain("правка 1");
  });

  it("после «Исправить» голосовое тоже поправка: идёт расшифровка", async () => {
    const { deps, decideRoute, buildDraft, cancelAwaitInput } = makeDeps({
      takeAwaitInput: vi.fn().mockResolvedValue({
        payload: { draftHandleId: DRAFT_ID },
        messageId: DRAFT_CARD,
      }),
      getHandle: vi.fn().mockResolvedValue(draftHandle()),
    });

    const result = await handleUpdate(voiceUpdate(), CHAT, deps);

    expect(result).toEqual({ status: "processed", action: "correction" });
    expect(decideRoute).not.toHaveBeenCalled();
    expect(cancelAwaitInput).not.toHaveBeenCalled();
    expect(buildDraft.mock.calls[0][0]).toMatchObject({ correction: "позвонить Маше" });
  });

  it("голосовая поправка: на карточке её расшифровка, текстовая следом её снимает", async () => {
    const { deps, updateHandle, editMessageText } = makeDeps({
      takeAwaitInput: vi.fn().mockResolvedValue({
        payload: { draftHandleId: DRAFT_ID },
        messageId: DRAFT_CARD,
      }),
      getHandle: vi.fn().mockResolvedValue(draftHandle()),
    });

    await handleUpdate(voiceUpdate(), CHAT, deps);

    expect(updateHandle).toHaveBeenCalledWith(DRAFT_ID, {
      payload: expect.objectContaining({ correctionTranscript: "позвонить Маше" }),
    });
    expect(lastEditOf(editMessageText, DRAFT_CARD)!.text).toContain("🎙 поправка: «позвонить Маше»");

    // Следующая поправка — текстом: прошлая расшифровка к ней не относится.
    const text = makeDeps({
      findActiveHandle: vi.fn().mockResolvedValue(
        draftHandle(storedDraft({ corrections: ["позвонить Маше"], correctionTranscript: "позвонить Маше" }))
      ),
      decideRoute: vi.fn().mockResolvedValue({ ...CAPTURE, correction: true }),
    });
    await handleUpdate(textUpdate("и хлеб"), CHAT, text.deps);
    const payload = text.updateHandle.mock.calls[0][1].payload as DraftPayload;
    expect(payload).not.toHaveProperty("correctionTranscript");
    expect(lastEditOf(text.editMessageText, DRAFT_CARD)!.text).not.toContain("поправка:");
  });

  it("«Исправить», а черновик тем временем закрыт — обычный проход", async () => {
    const { deps, decideRoute, createHandle } = makeDeps({
      takeAwaitInput: vi.fn().mockResolvedValue({
        payload: { draftHandleId: DRAFT_ID },
        messageId: DRAFT_CARD,
      }),
    });

    await handleUpdate(textUpdate("срок — понедельник"), CHAT, deps);

    expect(decideRoute).toHaveBeenCalledWith(expect.anything(), null);
    expect(createHandle).toHaveBeenCalledWith(expect.objectContaining({ kind: "draft" }));
  });

  it("«Повторить» берёт сообщение из журнала и разбирает его в той же карточке", async () => {
    const { deps, loadUpdate, transcribe, buildDraft, createHandle, sendMessage, editMessageText } =
      makeDeps({ loadUpdate: vi.fn().mockResolvedValue(voiceUpdate(42)) });

    const result = await handleUpdate(callbackUpdate(draftCallback.retry(42)), CHAT, deps);

    expect(result).toEqual({ status: "processed", action: "draft" });
    expect(loadUpdate).toHaveBeenCalledWith(42);
    expect(transcribe).toHaveBeenCalledTimes(1);
    expect(buildDraft).toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
    expect(createHandle).toHaveBeenCalledWith(expect.objectContaining({ messageId: 3 }));
    expect(lastEditOf(editMessageText, 3)!.text).toContain("Черновик");
  });

  it("«Повторить», а апдейта нет в журнале — просим прислать заново", async () => {
    const { deps, buildDraft, sendMessage } = makeDeps();

    await handleUpdate(callbackUpdate(draftCallback.retry(404)), CHAT, deps);

    expect(buildDraft).not.toHaveBeenCalled();
    expect(lastText(sendMessage)).toContain("журнале");
  });
});

describe("кнопки", () => {
  beforeEach(() => vi.clearAllMocks());

  it("сначала гасит спиннер, потом отвечает", async () => {
    const { deps, answerCallbackQuery, sendMessage } = makeDeps();

    const result = await handleUpdate(callbackUpdate("что-то чужое"), CHAT, deps);

    expect(result).toEqual({ status: "processed", action: "callback" });
    expect(answerCallbackQuery).toHaveBeenCalledWith({ callbackQueryId: "cb-1" });
    expect(answerCallbackQuery.mock.invocationCallOrder[0]).toBeLessThan(
      sendMessage.mock.invocationCallOrder[0]
    );
  });

  it("сбой answerCallbackQuery не обрывает нажатие (L7)", async () => {
    const { deps, answerCallbackQuery, sendMessage } = makeDeps();
    answerCallbackQuery.mockRejectedValueOnce(new Error("Bad Request: query is too old"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await handleUpdate(callbackUpdate("что-то чужое"), CHAT, deps);

    expect(result).toEqual({ status: "processed", action: "callback" });
    expect(lastText(sendMessage)).toContain("кнопка мне незнакома");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("кнопки старого захвата больше не работают и не притворяются рабочими", async () => {
    const { deps, loadUpdate, buildDraft, sendMessage } = makeDeps();

    await handleUpdate(callbackUpdate("cap:astask:42"), CHAT, deps);

    expect(loadUpdate).not.toHaveBeenCalled();
    expect(buildDraft).not.toHaveBeenCalled();
    expect(lastText(sendMessage)).toContain("кнопка мне незнакома");
  });

  it("незнакомая кнопка не притворяется рабочей", async () => {
    const { deps, loadUpdate, sendMessage } = makeDeps();

    await handleUpdate(callbackUpdate("task:done:xyz"), CHAT, deps);

    expect(loadUpdate).not.toHaveBeenCalled();
    expect(lastText(sendMessage)).toContain("кнопка мне незнакома");
  });
});

describe("управление задачами", () => {
  beforeEach(() => vi.clearAllMocks());

  const taskButton = (data: string) => callbackUpdate(data);

  it("нажатие кнопки правит то же сообщение, а не шлёт новое", async () => {
    const { deps, editMessageText, sendMessage, completeTask } = makeDeps();

    const result = await handleUpdate(
      taskButton(taskCallback.done(TASK_ID)),
      CHAT,
      deps
    );

    expect(result).toEqual({ status: "processed", action: "callback" });
    expect(completeTask).toHaveBeenCalledWith(TASK_ID);
    expect(sendMessage).not.toHaveBeenCalled();
    expect(editMessageText).toHaveBeenCalledWith(
      expect.objectContaining({ chatId: CHAT, messageId: 3 })
    );
  });

  it("спиннер гасится раньше похода в базу", async () => {
    const { deps, answerCallbackQuery, getTask, editMessageText } = makeDeps();

    await handleUpdate(taskButton(taskCallback.done(TASK_ID)), CHAT, deps);

    expect(answerCallbackQuery.mock.invocationCallOrder[0]).toBeLessThan(
      getTask.mock.invocationCallOrder[0]
    );
    expect(answerCallbackQuery.mock.invocationCallOrder[0]).toBeLessThan(
      editMessageText.mock.invocationCallOrder[0]
    );
  });

  it("кнопка на сообщении месячной давности ничего не делает и снимает клавиатуру", async () => {
    const { deps, deleteTask, getTask, editMessageText } = makeDeps();
    const stale = Math.floor(new Date("2026-07-01T12:00:00Z").getTime() / 1000);

    await handleUpdate(
      callbackUpdate(taskCallback.removeConfirm(TASK_ID), 9, stale),
      CHAT,
      deps
    );

    expect(deleteTask).not.toHaveBeenCalled();
    expect(getTask).not.toHaveBeenCalled();
    const [{ text, replyMarkup }] = editMessageText.mock.calls.at(-1)!;
    expect(text).toContain("устарели");
    expect(replyMarkup).toBeUndefined();
  });

  it("«message is not modified» не роняет обработку апдейта", async () => {
    const { deps, markProcessed } = makeDeps({
      client: {
        sendMessage: vi.fn().mockResolvedValue({ message_id: 1 }),
        editMessageText: vi
          .fn()
          .mockRejectedValue(
            new TelegramApiError("editMessageText", 400, "Bad Request: message is not modified")
          ),
        answerCallbackQuery: vi.fn().mockResolvedValue(true),
        getFile: vi.fn(),
        downloadFile: vi.fn(),
      },
    });

    const result = await handleUpdate(taskButton(taskCallback.back(TASK_ID)), CHAT, deps);

    expect(result).toEqual({ status: "processed", action: "callback" });
    expect(markProcessed).toHaveBeenCalledWith(9, undefined);
  });

  it("ответ на «пришлите название» правит задачу, а не создаёт черновик", async () => {
    const { deps, updateTask, buildDraft, decideRoute, editMessageText, sendMessage } = makeDeps({
      takeAwaitInput: vi.fn().mockResolvedValue({
        payload: { taskId: TASK_ID, field: "title" },
        messageId: 42,
      }),
    });

    const result = await handleUpdate(textUpdate("ответить по вэду до пятницы"), CHAT, deps);

    expect(result).toEqual({ status: "processed", action: "edit" });
    expect(decideRoute).not.toHaveBeenCalled();
    expect(buildDraft).not.toHaveBeenCalled();
    // Ответ на вопрос — не запись: заглушки «Разбираю» нет.
    expect(sendMessage).not.toHaveBeenCalled();
    expect(updateTask).toHaveBeenCalledWith(TASK_ID, { title: "ответить по вэду до пятницы" });
    // Правится карточка, с которой спрашивали, а не последнее сообщение чата.
    expect(editMessageText).toHaveBeenCalledWith(expect.objectContaining({ messageId: 42 }));
  });

  it("без заданного вопроса сообщение идёт в захват как обычно", async () => {
    const { deps, buildDraft, takeAwaitInput, updateTask } = makeDeps();

    await handleUpdate(textUpdate("заполнить итмо"), CHAT, deps);

    expect(takeAwaitInput).toHaveBeenCalledWith(CHAT);
    expect(buildDraft).toHaveBeenCalled();
    expect(updateTask).not.toHaveBeenCalled();
  });

  /*
   * Протухшее ожидание попадает сюда же: `takeAwaitInput` отсекает срок
   * запросом и отдаёт null, а для обработчика null — это «вопроса не
   * задавали». Что именно возвращает база через двадцать минут, проверяется
   * на настоящей базе (`tests/task-control.integration.test.ts`).
   */

  it("команда обрывает заданный вопрос", async () => {
    const { deps, cancelAwaitInput } = makeDeps();
    await handleUpdate(textUpdate("/start"), CHAT, deps);
    expect(cancelAwaitInput).toHaveBeenCalledWith(CHAT);
  });

  it("незнакомая команда снимает вопрос раньше, чем его успеют забрать", async () => {
    const { deps, cancelAwaitInput, takeAwaitInput } = makeDeps({
      takeAwaitInput: vi.fn().mockResolvedValue({
        payload: { taskId: TASK_ID, field: "title" },
        messageId: 42,
      }),
    });

    await handleUpdate(textUpdate("/stop"), CHAT, deps);

    // Порядок здесь и есть суть: отмена после чтения ожидания ничего бы не
    // спасла — «/stop» уже ушёл бы в название задачи.
    expect(cancelAwaitInput).toHaveBeenCalledWith(CHAT);
    expect(cancelAwaitInput.mock.invocationCallOrder[0]).toBeLessThan(
      takeAwaitInput.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER
    );
  });

  it("голосовое снимает вопрос про поле задачи и идёт в захват", async () => {
    // Ожидание забрано (и тем самым погашено), но расшифровка — не ответ на
    // «пришлите название»: следующему тексту оно уже не достанется.
    const { deps, takeAwaitInput, updateTask, buildDraft } = makeDeps({
      takeAwaitInput: vi.fn().mockResolvedValue({
        payload: { taskId: TASK_ID, field: "title" },
        messageId: 42,
      }),
    });

    await handleUpdate(voiceUpdate(), CHAT, deps);

    expect(takeAwaitInput).toHaveBeenCalledWith(CHAT);
    expect(updateTask).not.toHaveBeenCalled();
    expect(buildDraft).toHaveBeenCalled();
  });

  it("картинка снимает заданный вопрос, а не оставляет его следующему тексту", async () => {
    const { deps, cancelAwaitInput, takeAwaitInput, updateTask } = makeDeps();
    const update: TelegramUpdate = {
      update_id: 2,
      message: {
        message_id: 12,
        date: 1,
        chat: { id: CHAT, type: "private" },
        photo: [{ file_id: "p1" }],
      },
    };

    await handleUpdate(update, CHAT, deps);

    expect(cancelAwaitInput).toHaveBeenCalledWith(CHAT);
    expect(takeAwaitInput).not.toHaveBeenCalled();
    expect(updateTask).not.toHaveBeenCalled();
  });
});

describe("зависимости по умолчанию", () => {
  it("старого захвата и сухого прогона больше нет", () => {
    const deps = defaultDeps() as Record<string, unknown>;
    for (const removed of ["createTask", "dryRun", "captureItems", "transcribe"]) {
      expect(deps, removed).not.toHaveProperty(removed);
    }
  });

  it("«Отправить» исполняет только инструменты агента захвата", async () => {
    // Подменённый или устаревший payload не должен суметь удалить задачу:
    // удаления нет в наборе, с которым черновик применяется.
    const results = await defaultDeps().applyCalls([
      { tool: "delete_task", args: { id: TASK_ID } },
      { tool: "complete_task", args: { id: TASK_ID } },
    ]);

    expect(results).toEqual([
      { ok: false, error: "Неизвестный инструмент: delete_task" },
      { ok: false, error: "Неизвестный инструмент: complete_task" },
    ]);
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

describe("botToday", () => {
  it.each([
    ["2026-10-24T20:59:59Z", "2026-10-24"],
    ["2026-10-24T21:00:00Z", "2026-10-25"],
    ["2026-10-24T23:30:00Z", "2026-10-25"],
    ["2026-12-31T22:00:00Z", "2027-01-01"],
  ])("%s по UTC — %s по Москве", (iso, expected) => {
    expect(botToday(new Date(iso))).toBe(expected);
  });

  it("зависимости по умолчанию считают «сегодня» по Москве", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-10-24T22:30:00Z"));
      expect(defaultDeps().today()).toBe("2026-10-25");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("снимок доски в запросе агентов", () => {
  beforeEach(() => vi.clearAllMocks());

  const SNAPSHOT = { text: "# Доска сейчас", tasks: [{ id: "t1", title: "Отчёт", description: null, subtasks: [] }] };

  it("захват: снимок активной среды уходит в buildDraft", async () => {
    const loadBoardSnapshot = vi.fn().mockResolvedValue(SNAPSHOT);
    const { deps, buildDraft } = makeDeps({ loadBoardSnapshot });

    await handleUpdate(textUpdate("позвонить Маше"), CHAT, deps);

    expect(loadBoardSnapshot).toHaveBeenCalledWith("env-1");
    expect(buildDraft.mock.calls[0][0].board).toBe(SNAPSHOT);
  });

  it("ask_board: снимок уходит в answerBoardQuestion", async () => {
    const loadBoardSnapshot = vi.fn().mockResolvedValue(SNAPSHOT);
    const { deps, answerBoardQuestion } = makeDeps({
      loadBoardSnapshot,
      decideRoute: vi.fn().mockResolvedValue({ route: "ask_board", correction: false, source: "jev" }),
    });

    await handleUpdate(textUpdate("что у меня на сегодня?"), CHAT, deps);

    expect(answerBoardQuestion).toHaveBeenCalledWith("что у меня на сегодня?", {
      environmentId: "env-1",
      today: "2026-08-25",
      board: SNAPSHOT,
    });
  });

  it("сбой снимка не мешает черновику: агент читает доску сам", async () => {
    const { deps, buildDraft } = makeDeps({
      loadBoardSnapshot: vi.fn().mockRejectedValue(new Error("база легла")),
    });

    const result = await handleUpdate(textUpdate("позвонить Маше"), CHAT, deps);

    expect(result).toEqual({ status: "processed", action: "draft" });
    expect(buildDraft.mock.calls[0][0]).not.toHaveProperty("board");
  });
});

describe("намерение без содержания: «хочу создать задачу»", () => {
  beforeEach(() => vi.clearAllMocks());

  const INTENT_TEXT = "хочу создать новую задачу в блоке ml модели";
  const INTENT: RouteDecision = { ...CAPTURE, intentOnly: true };

  it("агента не зовёт: заглушка становится вопросом с эпиком, ставится ожидание с исходной фразой", async () => {
    const listEpics = vi.fn(async (environmentId: string) =>
      environmentId === "env-1"
        ? [
            { id: "epic-ml", name: "ML модели" },
            { id: "epic-ml-short", name: "ML" },
          ]
        : []
    );
    const { deps, buildDraft, createHandle, cancelAwaitInput, editMessageText } = makeDeps({
      decideRoute: vi.fn().mockResolvedValue(INTENT),
      listEpics,
    });

    const result = await handleUpdate(textUpdate(INTENT_TEXT), CHAT, deps);

    expect(result).toEqual({ status: "processed", action: "intent" });
    expect(buildDraft).not.toHaveBeenCalled();
    expect(cancelAwaitInput).toHaveBeenCalledWith(CHAT);
    expect(createHandle).toHaveBeenCalledTimes(1);
    expect(createHandle).toHaveBeenCalledWith({
      kind: "await_input",
      payload: { captureContext: INTENT_TEXT },
      chatId: CHAT,
      messageId: PLACEHOLDER,
    });
    const card = lastEditOf(editMessageText, PLACEHOLDER)!;
    expect(card.text).toBe("Какую задачу завести в эпике «ML модели»? Напишите или надиктуйте.");
    expect(card.replyMarkup).toBeUndefined();
  });

  it("эпика в сообщении нет — общий вопрос «что именно записать?»", async () => {
    const { deps, buildDraft, editMessageText } = makeDeps({
      decideRoute: vi.fn().mockResolvedValue(INTENT),
    });

    await handleUpdate(textUpdate("надо завести задачу"), CHAT, deps);

    expect(buildDraft).not.toHaveBeenCalled();
    expect(lastEditOf(editMessageText, PLACEHOLDER)!.text).toBe(
      "Что именно записать? Напишите или надиктуйте."
    );
  });

  it("название эпика в вопросе экранируется, сбой списка эпиков — вопрос без эпика", async () => {
    const html = makeDeps({
      decideRoute: vi.fn().mockResolvedValue(INTENT),
      listEpics: vi.fn().mockResolvedValue([{ id: "e", name: "R&D <лаб>" }]),
    });
    await handleUpdate(textUpdate("хочу задачу в r&d <лаб>"), CHAT, html.deps);
    expect(lastEditOf(html.editMessageText, PLACEHOLDER)!.text).toContain("«R&amp;D &lt;лаб&gt;»");

    const broken = makeDeps({
      decideRoute: vi.fn().mockResolvedValue(INTENT),
      listEpics: vi.fn().mockRejectedValue(new Error("база недоступна")),
    });
    const result = await handleUpdate(textUpdate(INTENT_TEXT), CHAT, broken.deps);
    expect(result).toEqual({ status: "processed", action: "intent" });
    expect(lastEditOf(broken.editMessageText, PLACEHOLDER)!.text).toContain("Что именно записать?");
  });

  it("следующий текст — запись с контекстом намерения, без вопроса к Jev", async () => {
    const { deps, decideRoute, buildDraft, createHandle } = makeDeps({
      takeAwaitInput: vi.fn().mockResolvedValue({
        payload: { captureContext: INTENT_TEXT },
        messageId: PLACEHOLDER,
      }),
    });

    const result = await handleUpdate(textUpdate("обучить модель оттока"), CHAT, deps);

    expect(result).toEqual({ status: "processed", action: "draft" });
    expect(decideRoute).not.toHaveBeenCalled();
    expect(buildDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        inbound: expect.objectContaining({ text: "обучить модель оттока" }),
        captureContext: INTENT_TEXT,
      })
    );
    expect(createHandle).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "draft",
        payload: expect.objectContaining({ captureContext: INTENT_TEXT }),
      })
    );
  });

  it("голосовое тоже ответ: расшифровка уходит агенту с контекстом", async () => {
    const { deps, decideRoute, buildDraft, transcribe, cancelAwaitInput } = makeDeps({
      takeAwaitInput: vi.fn().mockResolvedValue({
        payload: { captureContext: INTENT_TEXT },
        messageId: PLACEHOLDER,
      }),
    });

    const result = await handleUpdate(voiceUpdate(), CHAT, deps);

    expect(result).toEqual({ status: "processed", action: "draft" });
    expect(transcribe).toHaveBeenCalled();
    expect(cancelAwaitInput).not.toHaveBeenCalled();
    expect(decideRoute).not.toHaveBeenCalled();
    expect(buildDraft.mock.calls[0][0]).toMatchObject({
      inbound: { text: "позвонить Маше" },
      captureContext: INTENT_TEXT,
    });
  });

  it("команда снимает ожидание «что записать?»", async () => {
    const { deps, cancelAwaitInput, takeAwaitInput, buildDraft } = makeDeps({
      takeAwaitInput: vi.fn().mockResolvedValue({
        payload: { captureContext: INTENT_TEXT },
        messageId: PLACEHOLDER,
      }),
    });

    await handleUpdate(textUpdate("/help"), CHAT, deps);

    expect(cancelAwaitInput).toHaveBeenCalledWith(CHAT);
    expect(takeAwaitInput).not.toHaveBeenCalled();
    expect(buildDraft).not.toHaveBeenCalled();
  });

  it("intentOnly не перебивает «отправляй» при открытом черновике", async () => {
    const { deps, buildDraft, createHandle } = makeDeps({
      findActiveHandle: vi.fn().mockResolvedValue(draftHandle()),
      decideRoute: vi.fn().mockResolvedValue({ ...INTENT, confirm: true }),
    });

    const result = await handleUpdate(textUpdate("да, записывай"), CHAT, deps);

    expect(result).toEqual({ status: "processed", action: "confirm" });
    expect(buildDraft).not.toHaveBeenCalled();
    expect(createHandle).not.toHaveBeenCalled();
  });
});
