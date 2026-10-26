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
import { decideRoute, type RouteDecision } from "@/lib/telegram/route";
import type { askJev } from "@/lib/llm/jev";
import type { Turn } from "@/lib/telegram/conversation";
import { A_CALLS, A_SOURCE, B_CALLS, B_SOURCE, MERGED_CALLS } from "./fixtures/live-drafts";
import { LIVE_403 } from "./fixtures/route-cases";
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
    listActiveHandles: vi.fn().mockResolvedValue([]),
    findHandleByMessage: vi.fn().mockResolvedValue(null),
    loadRecentUpdates: vi.fn().mockResolvedValue([]),
    updateHandle: vi.fn().mockResolvedValue(true),
    claimHandle: vi.fn().mockResolvedValue(null),
    cancelHandle: vi.fn().mockResolvedValue(true),
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
    listActiveHandles: asMock(deps.listActiveHandles),
    findHandleByMessage: asMock(deps.findHandleByMessage),
    loadRecentUpdates: asMock(deps.loadRecentUpdates),
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
    expect(decideRoute).toHaveBeenCalledWith(inbound, null, []);
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

  describe("текстовые вложения", () => {
    const MD = new TextEncoder().encode("# Встреча\nя: пришлю письмо завтра").buffer;
    const documentUpdate = (
      document: NonNullable<NonNullable<TelegramUpdate["message"]>["document"]>,
      caption?: string,
      updateId = 3
    ): TelegramUpdate => ({
      update_id: updateId,
      message: {
        message_id: 13,
        date: 1,
        chat: { id: CHAT, type: "private" },
        document,
        ...(caption ? { caption } : {}),
      },
    });
    const MD_DOC = { file_id: "doc-1", file_name: "transcript.md", mime_type: "text/markdown", file_size: 40 };

    it("файл с подписью: черновик по файлу, подпись — текст, файл запомнен", async () => {
      const { deps, buildDraft, createHandle, downloadFile } = makeDeps();
      downloadFile.mockResolvedValue(MD);

      const result = await handleUpdate(documentUpdate(MD_DOC, "вот посмотри какие еще есть задачи"), CHAT, deps);

      expect(result).toEqual({ status: "processed", action: "draft" });
      const input = buildDraft.mock.calls[0][0];
      expect(input.inbound.text).toBe("вот посмотри какие еще есть задачи");
      expect(input.inbound.attachments).toEqual([
        { name: "transcript.md", text: "# Встреча\nя: пришлю письмо завтра", truncated: false },
      ]);
      // До «Отправить» в базу — только хендлы: память о файле и черновик.
      expect(createHandle).toHaveBeenCalledWith(
        expect.objectContaining({ kind: "attachment", chatId: CHAT, payload: { document: MD_DOC } })
      );
      expect(deps.applyCalls).not.toHaveBeenCalled();
    });

    it("файл без подписи тоже идёт в черновик", async () => {
      const { deps, buildDraft, downloadFile } = makeDeps();
      downloadFile.mockResolvedValue(MD);

      const result = await handleUpdate(documentUpdate(MD_DOC), CHAT, deps);

      expect(result).toEqual({ status: "processed", action: "draft" });
      expect(buildDraft.mock.calls[0][0].inbound.attachments).toHaveLength(1);
    });

    it("pdf без подписи: говорим, какие файлы читаем, ничего не качаем", async () => {
      const { deps, editMessageText, buildDraft, getFile, decideRoute } = makeDeps();

      const result = await handleUpdate(
        documentUpdate({ file_id: "doc-2", file_name: "отчёт <2026>.pdf", mime_type: "application/pdf" }),
        CHAT,
        deps
      );

      expect(result).toEqual({ status: "processed", action: "unsupported" });
      expect(getFile).not.toHaveBeenCalled();
      expect(decideRoute).not.toHaveBeenCalled();
      expect(buildDraft).not.toHaveBeenCalled();
      expect(lastEditOf(editMessageText, PLACEHOLDER)!.text).toBe(
        "Файл «отчёт &lt;2026&gt;.pdf» пока не читаю — пришлите .txt/.md или текстом."
      );
    });

    it("pdf с подписью: подпись разбирается, файл — предупреждением агента", async () => {
      const { deps, buildDraft } = makeDeps();

      await handleUpdate(
        documentUpdate({ file_id: "doc-2", file_name: "отчёт.pdf", mime_type: "application/pdf" }, "позвонить Маше"),
        CHAT,
        deps
      );

      const input = buildDraft.mock.calls[0][0];
      expect(input.inbound.text).toBe("позвонить Маше");
      expect(input.inbound.unsupportedAttachment).toBe("отчёт.pdf");
      expect(input.inbound.attachments).toBeUndefined();
    });

    it("«проанализируй файлы» следом за файлом — тот же файл перечитывается", async () => {
      const { deps, buildDraft, findActiveHandle, getFile, downloadFile } = makeDeps();
      downloadFile.mockResolvedValue(MD);
      findActiveHandle.mockImplementation(async (_chat: number, kind: string) =>
        kind === "attachment"
          ? { id: "ATTACH0001", kind: "attachment", payload: { document: MD_DOC }, chatId: CHAT, messageId: null }
          : null
      );

      await handleUpdate(textUpdate("проанализируй файлы, выцепи оттуда задачи"), CHAT, deps);

      expect(findActiveHandle).toHaveBeenCalledWith(CHAT, "attachment");
      expect(getFile).toHaveBeenCalledWith("doc-1");
      const input = buildDraft.mock.calls[0][0];
      expect(input.inbound.text).toBe("проанализируй файлы, выцепи оттуда задачи");
      expect(input.inbound.attachments?.[0].name).toBe("transcript.md");
    });

    it("повторный разбор при свежем черновике — поправка этого черновика, без нового", async () => {
      const open = storedDraft({
        source: { text: "вот", links: [], hasUnreadableMedia: false, attachments: [{ name: "transcript.md", text: "я: письмо", truncated: false }] },
        createdAt: "2026-08-25T11:30:00.000Z",
      });
      const { deps, buildDraft, findActiveHandle, getFile, createHandle, decideRoute } = makeDeps({
        decideRoute: vi.fn().mockResolvedValue({ route: "capture", correction: true, source: "jev", confidence: 0.9 }),
      });
      findActiveHandle.mockImplementation(async (_chat: number, kind: string) =>
        kind === "draft"
          ? draftHandle(open)
          : { id: "ATTACH0001", kind: "attachment", payload: { document: MD_DOC }, chatId: CHAT, messageId: null }
      );

      const result = await handleUpdate(textUpdate("посмотри файл ещё раз, ты пропустил письмо"), CHAT, deps);

      expect(result).toEqual({ status: "processed", action: "correction" });
      expect(getFile).not.toHaveBeenCalled();
      expect(decideRoute.mock.calls[0][0].attachments).toBeUndefined();
      const input = buildDraft.mock.calls[0][0];
      expect(input.previous?.source.attachments?.[0].name).toBe("transcript.md");
      expect(input.correction).toBe("посмотри файл ещё раз, ты пропустил письмо");
      expect(createHandle).not.toHaveBeenCalled();
    });

    it("черновик старше часа повторному разбору не мешает", async () => {
      const { deps, buildDraft, findActiveHandle, downloadFile } = makeDeps();
      downloadFile.mockResolvedValue(MD);
      findActiveHandle.mockImplementation(async (_chat: number, kind: string) =>
        kind === "draft"
          ? draftHandle(storedDraft({ createdAt: "2026-08-25T10:00:00.000Z" }))
          : { id: "ATTACH0001", kind: "attachment", payload: { document: MD_DOC }, chatId: CHAT, messageId: null }
      );

      await handleUpdate(textUpdate("разбери вложение"), CHAT, deps);

      expect(buildDraft.mock.calls[0][0].inbound.attachments?.[0].name).toBe("transcript.md");
    });

    it("«проанализируй файл» без недавнего файла — обычное сообщение", async () => {
      const { deps, buildDraft, getFile } = makeDeps();

      await handleUpdate(textUpdate("проанализируй файл"), CHAT, deps);

      expect(getFile).not.toHaveBeenCalled();
      expect(buildDraft.mock.calls[0][0].inbound.attachments).toBeUndefined();
    });

    it("обычный текст файл не ищет", async () => {
      const { deps, findActiveHandle } = makeDeps();

      await handleUpdate(textUpdate("позвонить Маше"), CHAT, deps);

      expect(findActiveHandle).not.toHaveBeenCalledWith(CHAT, "attachment");
    });
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
    }, []);
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
    expect(decideRoute).toHaveBeenCalledWith(expect.anything(), null, []);
    expect(buildDraft.mock.calls[0][0].previous).toBeUndefined();
    expect(createHandle).toHaveBeenCalledWith(expect.objectContaining({ kind: "draft" }));
    expect(updateHandle).not.toHaveBeenCalled();
  });

  it("битый payload открытого черновика — обычная новая запись", async () => {
    const { deps, decideRoute, createHandle } = makeDeps({
      findActiveHandle: vi.fn().mockResolvedValue(draftHandle({ мусор: true })),
    });

    await handleUpdate(textUpdate("купить хлеб"), CHAT, deps);

    expect(decideRoute).toHaveBeenCalledWith(expect.anything(), null, []);
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

    expect(decideRoute).toHaveBeenCalledWith(expect.anything(), null, []);
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

/* ── живой случай 2026-10-26: память разговора, слияние, пустые черновики ── */

const A_ID = "Zcm9sWderQ";
const B_ID = "pwCCZBs7fA";
const A_CARD = 140;
const B_CARD = 146;

function liveDraft(source: string, calls: typeof A_CALLS, createdAt: string): DraftPayload {
  return {
    source: { text: source, links: [], hasUnreadableMedia: false },
    corrections: [],
    calls,
    agentText: "",
    environmentId: "env-1",
    createdAt,
  };
}

// now в makeDeps — 2026-08-25T12:00Z: A — 70 минут назад, B — минуту назад.
const A_DRAFT = liveDraft(A_SOURCE, A_CALLS, "2026-08-25T10:50:00.000Z");
const B_DRAFT = liveDraft(B_SOURCE, B_CALLS, "2026-08-25T11:59:00.000Z");
const A_HANDLE = { id: A_ID, kind: "draft", payload: A_DRAFT, chatId: CHAT, messageId: A_CARD };
const B_HANDLE = { id: B_ID, kind: "draft", payload: B_DRAFT, chatId: CHAT, messageId: B_CARD };
const EMPTY_HANDLE = {
  id: "p015Lk09wQ",
  kind: "draft",
  payload: { ...liveDraft("это в дополнении", [], "2026-08-25T11:59:30.000Z"), agentText: "Что именно записать?" },
  chatId: CHAT,
  messageId: 148,
};

/** findActiveHandle как в базе: новые первыми, `accept` — фильтр в коде. */
function activeHandles(rows: unknown[]) {
  return vi.fn(async (_chat: number, kind: string, accept?: (h: never) => boolean) => {
    const ofKind = (rows as { kind: string }[]).filter((r) => r.kind === kind);
    return ((accept ? ofKind.find((r) => accept(r as never)) : ofKind[0]) ?? null) as never;
  });
}

function replyUpdate(text: string, replyTo: number, updateId = 714077401): TelegramUpdate {
  return {
    update_id: updateId,
    message: {
      message_id: 147,
      date: 1_700_000_000,
      chat: { id: CHAT, type: "private" },
      text,
      reply_to_message: {
        message_id: replyTo,
        date: 1_700_000_000,
        chat: { id: CHAT, type: "private" },
        from: { id: 1, is_bot: true, first_name: "Constance" },
        text: "📝 Черновик\n\n1. Добавить подзадачу «Составить план работ со сроками»",
      },
    },
  };
}

function jev(answers: Record<string, number>, route = "capture") {
  return vi.fn(async () => ({
    answers: {
      route: { type: "choice" as const, choice: route, confidence: 0.96, probabilities: { [route]: 0.96 } },
      ...Object.fromEntries(Object.entries(answers).map(([k, noul]) => [k, { type: "noul" as const, noul }])),
    },
    latencyMs: 300,
  }));
}

/** Настоящий decideRoute поверх фейкового Jev. */
function realRoute(ask: ReturnType<typeof jev>, now: () => Date) {
  return vi.fn((inbound: Inbound, open: { summary: string; createdAt: Date } | null, conversation?: Turn[]) =>
    decideRoute(inbound, open, { askJev: ask as unknown as typeof askJev, now }, conversation)
  );
}

/** Строки журнала живого случая (новые первыми). */
const JOURNAL = [
  {
    updateId: 714077400,
    createdAt: new Date("2026-08-25T11:59:00Z"),
    status: "processed",
    payload: textUpdate(B_SOURCE, CHAT, 714077400),
    parsed: { route: { route: "capture" }, calls: B_CALLS.map((c) => c.label), agentText: "" },
  },
  {
    updateId: 714077397,
    createdAt: new Date("2026-08-25T10:50:00Z"),
    status: "processed",
    payload: textUpdate(A_SOURCE, CHAT, 714077397),
    parsed: { route: { route: "capture" }, calls: A_CALLS.map((c) => c.label), agentText: "" },
  },
];

describe("живой случай: реплай «это в дополнении к двум задач выше»", () => {
  beforeEach(() => vi.clearAllMocks());

  it("правит A, видит пункты B, B закрыт как слитый", async () => {
    const { deps, buildDraft, cancelHandle, updateHandle, createHandle, editMessageText, decideRoute: route } =
      makeDeps({
        findHandleByMessage: vi.fn(async (_c: number, messageId: number) => (messageId === A_CARD ? A_HANDLE : null)),
        listActiveHandles: vi.fn().mockResolvedValue([EMPTY_HANDLE, B_HANDLE, A_HANDLE]),
        findActiveHandle: activeHandles([EMPTY_HANDLE, B_HANDLE, A_HANDLE]),
        loadRecentUpdates: vi.fn().mockResolvedValue(JOURNAL),
        decideRoute: vi.fn().mockResolvedValue(CAPTURE),
        buildDraft: vi.fn().mockResolvedValue({ ok: true, calls: MERGED_CALLS, agentText: "" }),
      });

    const result = await handleUpdate(replyUpdate("это в дополнении к двум задач выше", A_CARD), CHAT, deps);

    expect(result).toEqual({ status: "processed", action: "correction" });
    // Jev спрошен только ради «отправляй»: черновик для него — A.
    expect(route.mock.calls[0][1].summary).toContain("Составить план работ со сроками");
    const input = buildDraft.mock.calls[0][0];
    expect(input.previous).toEqual(A_DRAFT);
    expect(input.correction).toBe("это в дополнении к двум задач выше");
    expect(input.openDrafts).toEqual([B_CALLS]);
    expect(input.conversation.map((t: { role: string }) => t.role)).toEqual(["owner", "bot", "owner", "bot"]);
    // Текст карточки, на которую ответили, агенту не дублируется.
    expect(input.inbound.replyTo).toEqual({ messageId: A_CARD, fromBot: true });

    expect(createHandle).not.toHaveBeenCalledWith(expect.objectContaining({ kind: "draft" }));
    expect(updateHandle).toHaveBeenCalledWith(A_ID, { payload: expect.objectContaining({ calls: MERGED_CALLS }) });
    expect(cancelHandle).toHaveBeenCalledWith(B_ID);
    expect(cancelHandle).not.toHaveBeenCalledWith(A_ID);
    expect(lastEditOf(editMessageText, A_CARD)!.text).toContain("Составить план работ со сроками");
    const merged = lastEditOf(editMessageText, B_CARD)!;
    expect(merged.text).toBe("Объединён с черновиком выше ↑");
    expect(merged.replyMarkup).toBeUndefined();
    expect(lastEditOf(editMessageText, PLACEHOLDER)!.text).toBe("Поправил черновик выше ↑");
  });

  it("без реплая: поправка последнего черновика B, A слит в него и закрыт", async () => {
    const ask = jev({ correction: 0.9, confirm: 0.1, intent: 0.8 });
    const now = () => new Date("2026-08-25T12:00:00Z");
    const { deps, buildDraft, cancelHandle, updateHandle, editMessageText } = makeDeps({
      listActiveHandles: vi.fn().mockResolvedValue([EMPTY_HANDLE, B_HANDLE, A_HANDLE]),
      findActiveHandle: activeHandles([EMPTY_HANDLE, B_HANDLE, A_HANDLE]),
      loadRecentUpdates: vi.fn().mockResolvedValue(JOURNAL),
      decideRoute: realRoute(ask, now),
      buildDraft: vi.fn().mockResolvedValue({ ok: true, calls: MERGED_CALLS, agentText: "" }),
    });

    const result = await handleUpdate(textUpdate("это в дополнении к двум задач выше", CHAT, 714077401), CHAT, deps);

    expect(result).toEqual({ status: "processed", action: "correction" });
    // Jev видел разговор и B (а не пустой черновик 148).
    const state = (ask.mock.calls[0] as unknown as [{ state: { previous: unknown[]; draft: string } }])[0].state;
    expect(state.previous).toHaveLength(4);
    expect(state.draft).toContain("Узнать про групповые ящики");
    const input = buildDraft.mock.calls[0][0];
    expect(input.previous).toEqual(B_DRAFT);
    expect(input.openDrafts).toEqual([A_CALLS]);
    expect(updateHandle).toHaveBeenCalledWith(B_ID, { payload: expect.objectContaining({ calls: MERGED_CALLS }) });
    expect(cancelHandle).toHaveBeenCalledWith(A_ID);
    expect(lastEditOf(editMessageText, A_CARD)!.text).toBe("Объединён с черновиком ниже ↓");
    expect(lastEditOf(editMessageText, B_CARD)!.text).toContain("8. Добавить подзадачу");
  });

  it("агент не перенёс пункты — второй черновик не трогаем", async () => {
    const { deps, cancelHandle, editMessageText } = makeDeps({
      findHandleByMessage: vi.fn().mockResolvedValue(A_HANDLE),
      listActiveHandles: vi.fn().mockResolvedValue([B_HANDLE, A_HANDLE]),
      buildDraft: vi.fn().mockResolvedValue({ ok: true, calls: A_CALLS.slice(0, 1), agentText: "" }),
    });

    await handleUpdate(replyUpdate("убери второй", A_CARD), CHAT, deps);

    expect(cancelHandle).not.toHaveBeenCalled();
    expect(lastEditOf(editMessageText, B_CARD)).toBeUndefined();
  });

  it("B отправили, пока агент думал: карточку B с отчётом не трогаем", async () => {
    const { deps, editMessageText } = makeDeps({
      findHandleByMessage: vi.fn().mockResolvedValue(A_HANDLE),
      listActiveHandles: vi.fn().mockResolvedValue([B_HANDLE, A_HANDLE]),
      cancelHandle: vi.fn().mockResolvedValue(false),
      buildDraft: vi.fn().mockResolvedValue({ ok: true, calls: MERGED_CALLS, agentText: "" }),
    });

    await handleUpdate(replyUpdate("это в дополнении к двум задач выше", A_CARD), CHAT, deps);

    expect(lastEditOf(editMessageText, B_CARD)).toBeUndefined();
  });

  it("реплай «да, отправляй» на карточку A — A заново внизу, ничего не применено", async () => {
    const { deps, buildDraft, applyCalls, updateHandle, editMessageText } = makeDeps({
      findHandleByMessage: vi.fn().mockResolvedValue(A_HANDLE),
      decideRoute: vi.fn().mockResolvedValue({ route: "capture", correction: false, confirm: true, source: "jev" }),
    });

    const result = await handleUpdate(replyUpdate("да, отправляй", A_CARD), CHAT, deps);

    expect(result).toEqual({ status: "processed", action: "confirm" });
    expect(buildDraft).not.toHaveBeenCalled();
    expect(applyCalls).not.toHaveBeenCalled();
    expect(updateHandle).toHaveBeenCalledWith(A_ID, { messageId: PLACEHOLDER });
    expect(lastEditOf(editMessageText, A_CARD)!.text).toBe("Черновик ниже ↓");
  });

  it("реплай на пустой черновик или чужое сообщение — обычный путь, текст ответа агенту контекстом", async () => {
    const { deps, buildDraft, decideRoute: route } = makeDeps({
      findHandleByMessage: vi.fn().mockResolvedValue(EMPTY_HANDLE),
    });

    await handleUpdate(replyUpdate("и это туда же", 148), CHAT, deps);

    expect(route).toHaveBeenCalled();
    const input = buildDraft.mock.calls[0][0];
    expect(input.previous).toBeUndefined();
    expect(input.inbound.replyTo.text).toContain("Черновик");
  });
});

describe("продолжение нумерации — поправка того же черновика", () => {
  beforeEach(() => vi.clearAllMocks());

  it("«3. … 8.» при открытом A с пунктами 1–2: правим A, параллельного черновика нет, Jev не спрашиваем", async () => {
    const { deps, buildDraft, decideRoute: route, createHandle, updateHandle } = makeDeps({
      listActiveHandles: vi.fn().mockResolvedValue([A_HANDLE]),
      findActiveHandle: activeHandles([A_HANDLE]),
      buildDraft: vi.fn().mockResolvedValue({ ok: true, calls: MERGED_CALLS, agentText: "" }),
    });

    const result = await handleUpdate(textUpdate(B_SOURCE, CHAT, 714077400), CHAT, deps);

    expect(result).toEqual({ status: "processed", action: "correction" });
    expect(route).not.toHaveBeenCalled();
    expect(buildDraft.mock.calls[0][0].previous).toEqual(A_DRAFT);
    expect(createHandle).not.toHaveBeenCalledWith(expect.objectContaining({ kind: "draft" }));
    expect(updateHandle).toHaveBeenCalledWith(A_ID, { payload: expect.objectContaining({ calls: MERGED_CALLS }) });
  });

  it("черновик старше трёх часов продолжением не считается", async () => {
    const old = { ...A_HANDLE, payload: { ...A_DRAFT, createdAt: "2026-08-25T08:00:00.000Z" } };
    const { deps, buildDraft } = makeDeps({ listActiveHandles: vi.fn().mockResolvedValue([old]) });

    await handleUpdate(textUpdate(B_SOURCE), CHAT, deps);

    expect(buildDraft.mock.calls[0][0].previous).toBeUndefined();
  });
});

describe("живой случай 714077403: «отправляй» по Jev на просьбу переделать", () => {
  beforeEach(() => vi.clearAllMocks());

  it("Jev confirm 0.97 на тексте со списком — не показ старого черновика, а поправка B", async () => {
    const ask = jev({ confirm: 0.97, correction: 0.3, intent: 0.2 });
    const now = () => new Date("2026-08-25T12:00:00Z");
    const { deps, buildDraft, applyCalls, updateHandle } = makeDeps({
      findActiveHandle: activeHandles([B_HANDLE]),
      listActiveHandles: vi.fn().mockResolvedValue([B_HANDLE]),
      decideRoute: realRoute(ask, now),
      buildDraft: vi.fn().mockResolvedValue({ ok: true, calls: MERGED_CALLS.slice(2), agentText: "" }),
    });

    const result = await handleUpdate(textUpdate(LIVE_403, CHAT, 714077403), CHAT, deps);

    expect(result).toEqual({ status: "processed", action: "correction" });
    expect(applyCalls).not.toHaveBeenCalled();
    expect(buildDraft.mock.calls[0][0].previous).toEqual(B_DRAFT);
    expect(updateHandle).toHaveBeenCalledWith(B_ID, {
      payload: expect.objectContaining({ calls: MERGED_CALLS.slice(2) }),
    });
  });

  it("Jev не узнал поправку — пересказ пунктов B всё равно правит B, без параллельного черновика", async () => {
    const ask = jev({ confirm: 0.1, correction: 0.2, intent: 0.1 });
    const { deps, buildDraft, createHandle, decideRoute: route } = makeDeps({
      findActiveHandle: activeHandles([B_HANDLE]),
      listActiveHandles: vi.fn().mockResolvedValue([B_HANDLE]),
      decideRoute: realRoute(ask, () => new Date("2026-08-25T12:00:00Z")),
      buildDraft: vi.fn().mockResolvedValue({ ok: true, calls: MERGED_CALLS.slice(2), agentText: "" }),
    });

    const result = await handleUpdate(textUpdate(LIVE_403, CHAT, 714077403), CHAT, deps);

    expect(result).toEqual({ status: "processed", action: "correction" });
    // Jev спрошен: правило пересказа работает только при маршруте записи.
    expect(route).toHaveBeenCalledTimes(1);
    expect(buildDraft.mock.calls[0][0].previous).toEqual(B_DRAFT);
    expect(createHandle).not.toHaveBeenCalledWith(expect.objectContaining({ kind: "draft" }));
  });

  it("«ок, на доску» — по-прежнему «отправляй»", async () => {
    const ask = jev({ confirm: 0.9, correction: 0.2 });
    const { deps, buildDraft } = makeDeps({
      findActiveHandle: activeHandles([B_HANDLE]),
      decideRoute: realRoute(ask, () => new Date("2026-08-25T12:00:00Z")),
    });

    const result = await handleUpdate(textUpdate("ок, на доску"), CHAT, deps);

    expect(result).toEqual({ status: "processed", action: "confirm" });
    expect(buildDraft).not.toHaveBeenCalled();
  });

  it("«я просил сделать их в виде подзадачи» после отчёта — черновик с разговором, не «что записать?»", async () => {
    const ask = jev({ intent: 0.91 });
    const sent = {
      updateId: 714077404,
      createdAt: new Date("2026-08-25T11:59:00Z"),
      status: "processed",
      payload: callbackUpdate(draftCallback.send(B_ID), 714077404),
      parsed: { button: "send", done: 6, total: 6 },
    };
    const { deps, buildDraft, createHandle } = makeDeps({
      loadRecentUpdates: vi.fn().mockResolvedValue([sent, ...JOURNAL]),
      decideRoute: realRoute(ask, () => new Date("2026-08-25T12:00:00Z")),
      buildDraft: vi.fn().mockResolvedValue({
        ok: true,
        calls: MERGED_CALLS.slice(2),
        agentText: "Шесть отдельных задач уже на доске — убрать их можно кнопками карточки: «найди задачу про …».",
      }),
    });

    const result = await handleUpdate(textUpdate("я просил сделать их в виде подзадачи", CHAT, 714077405), CHAT, deps);

    expect(result).toEqual({ status: "processed", action: "draft" });
    const conversation = buildDraft.mock.calls[0][0].conversation as { role: string; text: string }[];
    expect(conversation.at(-1)).toEqual({ role: "bot", text: "Отправил черновик на доску: 6 из 6." });
    expect(createHandle).toHaveBeenCalledWith(expect.objectContaining({ kind: "draft" }));
    expect(createHandle).not.toHaveBeenCalledWith(expect.objectContaining({ kind: "await_input" }));
  });
});

describe("пустой черновик не заводится и открытым не считается", () => {
  beforeEach(() => vi.clearAllMocks());

  it("агент без пунктов спросил «что записать?» — ни хендла draft, ни кнопок; ответ пойдёт в пару", async () => {
    const { deps, createHandle, editMessageText, cancelAwaitInput } = makeDeps({
      buildDraft: vi.fn().mockResolvedValue({
        ok: true,
        calls: [],
        agentText: "В записи нет содержания — только намерение дополнить. Что именно записать?",
      }),
    });

    const result = await handleUpdate(textUpdate("вот посмотри какие еще есть задача"), CHAT, deps);

    expect(result).toEqual({ status: "processed", action: "intent" });
    expect(createHandle).not.toHaveBeenCalledWith(expect.objectContaining({ kind: "draft" }));
    expect(cancelAwaitInput).toHaveBeenCalledWith(CHAT);
    expect(createHandle).toHaveBeenCalledWith({
      kind: "await_input",
      payload: { captureContext: "вот посмотри какие еще есть задача" },
      chatId: CHAT,
      messageId: PLACEHOLDER,
    });
    const card = lastEditOf(editMessageText, PLACEHOLDER)!;
    expect(card.text).toContain("Что именно записать?");
    expect(card.replyMarkup).toBeUndefined();
  });

  it("без вопроса — просто фраза агента, ожидания нет", async () => {
    const { deps, createHandle } = makeDeps({
      buildDraft: vi.fn().mockResolvedValue({ ok: true, calls: [], agentText: "Ничего нового не нашёл." }),
    });

    const result = await handleUpdate(textUpdate("ну вот"), CHAT, deps);

    expect(result).toEqual({ status: "processed", action: "draft" });
    expect(createHandle).not.toHaveBeenCalled();
  });

  it("поправка без пунктов не стирает черновик: «Ничего не поменял: …»", async () => {
    const { deps, updateHandle, editMessageText } = makeDeps({
      findActiveHandle: vi.fn().mockResolvedValue(draftHandle()),
      decideRoute: vi.fn().mockResolvedValue({ ...CAPTURE, correction: true }),
      buildDraft: vi.fn().mockResolvedValue({ ok: true, calls: [], agentText: "Не понял, что поменять." }),
    });

    const result = await handleUpdate(textUpdate("ну такое"), CHAT, deps);

    expect(result).toEqual({ status: "processed", action: "correction" });
    expect(updateHandle).not.toHaveBeenCalled();
    expect(lastEditOf(editMessageText, DRAFT_CARD)).toBeUndefined();
    expect(lastEditOf(editMessageText, PLACEHOLDER)!.text).toBe("Ничего не поменял: Не понял, что поменять.");
  });

  it("пустые черновики (как 142/144/148 в проде) не считаются открытыми", async () => {
    const { deps, decideRoute: route } = makeDeps({
      findActiveHandle: activeHandles([EMPTY_HANDLE, B_HANDLE]),
    });

    await handleUpdate(textUpdate("купить хлеб"), CHAT, deps);

    expect(route.mock.calls[0][1].summary).toContain("Разобраться, может ли визуальная модель");
  });

  it("только пустые — открытого черновика нет, даже если база отдала пустой", async () => {
    const { deps, decideRoute: route } = makeDeps({
      findActiveHandle: vi.fn().mockResolvedValue(EMPTY_HANDLE),
    });

    await handleUpdate(textUpdate("купить хлеб"), CHAT, deps);

    expect(route).toHaveBeenCalledWith(expect.anything(), null, []);
  });
});

describe("журнал для памяти разговора", () => {
  beforeEach(() => vi.clearAllMocks());

  it("«Отправить» пишет в разбор, сколько применено", async () => {
    const { deps, markProcessed } = makeDeps({
      claimHandle: vi.fn().mockResolvedValue({ id: DRAFT_ID, kind: "draft", payload: storedDraft() }),
    });

    await handleUpdate(callbackUpdate(draftCallback.send(DRAFT_ID), 30), CHAT, deps);

    expect(markProcessed).toHaveBeenCalledWith(30, {
      button: "send",
      done: 2,
      total: 2,
      calls: ["Задача «Позвонить Маше»", "Заметка «Синергия»"],
    });
  });

  it("ответ по доске — простым текстом в разборе", async () => {
    const { deps, markProcessed } = makeDeps({
      decideRoute: vi.fn().mockResolvedValue({ route: "ask_board", correction: false, source: "jev" }),
    });

    await handleUpdate(textUpdate("что на сегодня?", CHAT, 31), CHAT, deps);

    expect(markProcessed).toHaveBeenCalledWith(31, expect.objectContaining({ reply: "На сегодня: отчёт" }));
  });

  it("сбой чтения журнала не мешает разбору", async () => {
    const { deps, createHandle } = makeDeps({
      loadRecentUpdates: vi.fn().mockRejectedValue(new Error("db down")),
      listActiveHandles: vi.fn().mockRejectedValue(new Error("db down")),
    });

    const result = await handleUpdate(textUpdate("купить хлеб"), CHAT, deps);

    expect(result).toEqual({ status: "processed", action: "draft" });
    expect(createHandle).toHaveBeenCalledWith(expect.objectContaining({ kind: "draft" }));
  });
});

describe("правила поправки уступают Jev, слияние без потерь", () => {
  beforeEach(() => vi.clearAllMocks());

  const TWO = [
    { tool: "create_task", args: { title: "отчёт" }, label: "Задача «отчёт»" },
    { tool: "create_task", args: { title: "Позвонить Маше" }, label: "Задача «Позвонить Маше»" },
  ];
  const TWO_HANDLE = { ...B_HANDLE, payload: liveDraft("отчёт, позвонить Маше", TWO, "2026-08-25T11:59:00.000Z") };

  it("«найди:\n- отчёт…» при черновике из двух пунктов — поиск, не поправка", async () => {
    const { deps, buildDraft, extractSearchQuery } = makeDeps({
      listActiveHandles: vi.fn().mockResolvedValue([TWO_HANDLE]),
      findActiveHandle: activeHandles([TWO_HANDLE]),
      decideRoute: vi.fn().mockResolvedValue({ route: "find_task", correction: false, source: "jev" }),
    });

    const result = await handleUpdate(textUpdate("найди:\n- отчёт\n- Позвонить Маше"), CHAT, deps);

    expect(result).toEqual({ status: "processed", action: "find_task" });
    expect(buildDraft).not.toHaveBeenCalled();
    expect(extractSearchQuery).toHaveBeenCalled();
  });

  it("новый список с одним общим пунктом — новый черновик, старый не тронут", async () => {
    const { deps, buildDraft, createHandle, updateHandle } = makeDeps({
      listActiveHandles: vi.fn().mockResolvedValue([TWO_HANDLE]),
      findActiveHandle: activeHandles([TWO_HANDLE]),
    });

    await handleUpdate(textUpdate("1. Позвонить Маше\n2. Купить хлеб\n3. Сходить в банк"), CHAT, deps);

    expect(buildDraft.mock.calls[0][0].previous).toBeUndefined();
    expect(createHandle).toHaveBeenCalledWith(expect.objectContaining({ kind: "draft" }));
    expect(updateHandle).not.toHaveBeenCalled();
  });

  it("реплай на карточку черновика с вопросом к доске — ответ по доске, черновик не правится", async () => {
    const { deps, buildDraft, answerBoardQuestion, decideRoute: route } = makeDeps({
      findHandleByMessage: vi.fn().mockResolvedValue(A_HANDLE),
      decideRoute: vi.fn().mockResolvedValue({ route: "ask_board", correction: false, source: "jev" }),
    });

    const result = await handleUpdate(replyUpdate("что у меня на сегодня?", A_CARD), CHAT, deps);

    expect(result).toEqual({ status: "processed", action: "ask_board" });
    expect(buildDraft).not.toHaveBeenCalled();
    expect(answerBoardQuestion).toHaveBeenCalled();
    // Маршрут уже известен — второго вопроса к Jev нет.
    expect(route).toHaveBeenCalledTimes(1);
  });

  it("агент перенёс из B лишь часть пунктов — B остаётся открытым", async () => {
    const { deps, cancelHandle, editMessageText } = makeDeps({
      findHandleByMessage: vi.fn().mockResolvedValue(A_HANDLE),
      listActiveHandles: vi.fn().mockResolvedValue([B_HANDLE, A_HANDLE]),
      buildDraft: vi.fn().mockResolvedValue({ ok: true, calls: MERGED_CALLS.slice(0, 7), agentText: "" }),
    });

    await handleUpdate(replyUpdate("это в дополнении к двум задач выше", A_CARD), CHAT, deps);

    expect(cancelHandle).not.toHaveBeenCalled();
    expect(lastEditOf(editMessageText, B_CARD)).toBeUndefined();
  });
});
