import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  allowedChatIdFromEnv,
  captureDryRunFromEnv,
  handleUpdate,
  parseCommand,
  receiveUpdate,
  type TelegramDeps,
} from "@/lib/telegram/handle-update";
import { createTelegramClient, TelegramApiError } from "@/lib/telegram/client";
import { parseTaskCallback, taskCallback } from "@/lib/telegram/task-card";
import type { CapturedItem } from "@/lib/llm/capture";
import type { CaptureBoardData } from "@/lib/telegram/capture";
import type { TelegramUpdate } from "@/lib/telegram/types";

const CHAT = 555;

const BOARD: CaptureBoardData = {
  environment: { id: "env-1", name: "Работа" },
  environmentNames: ["Работа"],
  columns: [
    { id: "col-backlog", title: "Бэклог" },
    { id: "col-done", title: "Готово" },
  ],
  epics: [{ id: "epic-1", name: "Техдолг" }],
};

const ONE_TASK: CapturedItem[] = [{ kind: "task", text: "заполнить итмо" }];

/** UUID с четвёркой в версии: packUuid/unpackUuid принимают только настоящие. */
const TASK_ID = "3f1a2b3c-4d5e-4f60-8123-456789abcdef";
const OTHER_ID = "11111111-2222-4333-8444-555555555555";

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

/** Мок из собранных зависимостей: подменённый через overrides, а не исходный. */
function asMock(value: unknown): ReturnType<typeof vi.fn> {
  return value as ReturnType<typeof vi.fn>;
}

function makeDeps(overrides: Partial<TelegramDeps> = {}) {
  const deps: TelegramDeps = {
    client: {
      sendMessage: vi.fn().mockResolvedValue({ message_id: 1 }),
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
    captureItems: vi.fn().mockResolvedValue(ONE_TASK),
    createTask: vi.fn().mockResolvedValue({ id: "task-1" }),
    transcribe: vi.fn().mockResolvedValue("заполнить итмо"),
    allowedChatId: CHAT,

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
    createHandle: vi.fn().mockResolvedValue("HANDLE1234"),
    getHandle: vi.fn().mockResolvedValue(null),
    cancelAwaitInput: vi.fn().mockResolvedValue(undefined),
    takeAwaitInput: vi.fn().mockResolvedValue(null),
    now: () => new Date("2026-08-25T12:00:00Z"),
    ...overrides,
  };

  return {
    deps,
    sendMessage: asMock(deps.client.sendMessage),
    editMessageText: asMock(deps.client.editMessageText),
    answerCallbackQuery: asMock(deps.client.answerCallbackQuery),
    getFile: asMock(deps.client.getFile),
    downloadFile: asMock(deps.client.downloadFile),
    recordUpdate: asMock(deps.recordUpdate),
    markProcessed: asMock(deps.markProcessed),
    markFailed: asMock(deps.markFailed),
    loadUpdate: asMock(deps.loadUpdate),
    loadBoard: asMock(deps.loadBoard),
    captureItems: asMock(deps.captureItems),
    createTask: asMock(deps.createTask),
    transcribe: asMock(deps.transcribe),
    getTask: asMock(deps.getTask),
    searchTasks: asMock(deps.searchTasks),
    completeTask: asMock(deps.completeTask),
    updateTask: asMock(deps.updateTask),
    deleteTask: asMock(deps.deleteTask),
    createHandle: asMock(deps.createHandle),
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
function lastText(sendMessage: ReturnType<typeof vi.fn>): string {
  const calls = sendMessage.mock.calls;
  return calls[calls.length - 1][0].text as string;
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

    expect(markProcessed).toHaveBeenCalledWith(1);
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
});

describe("захват текста", () => {
  beforeEach(() => vi.clearAllMocks());

  it("обычное сообщение становится задачей на доске", async () => {
    const { deps, captureItems, createTask, sendMessage, markProcessed } = makeDeps();

    const result = await handleUpdate(textUpdate("заполнить итмо"), CHAT, deps);

    expect(result).toEqual({ status: "processed", action: "capture" });
    expect(captureItems).toHaveBeenCalledWith("заполнить итмо", expect.objectContaining({
      environmentName: "Работа",
    }));
    expect(createTask).toHaveBeenCalledWith(
      expect.objectContaining({ title: "заполнить итмо", columnId: "col-backlog" })
    );
    expect(lastText(sendMessage)).toContain("заполнить итмо");
    expect(markProcessed).toHaveBeenCalledWith(1);
  });

  it("команда не уходит в модель", async () => {
    const { deps, captureItems, createTask } = makeDeps();
    await handleUpdate(textUpdate("/help"), CHAT, deps);

    expect(captureItems).not.toHaveBeenCalled();
    expect(createTask).not.toHaveBeenCalled();
  });

  it("сбой модели: сообщение не теряется, в ответе кнопка повтора", async () => {
    const { deps, sendMessage, createTask, markFailed } = makeDeps({
      captureItems: vi.fn().mockRejectedValue(new Error("Модель groq: 429 Rate limit")),
    });

    const result = await handleUpdate(textUpdate("заполнить итмо"), CHAT, deps);

    expect(result).toEqual({ status: "failed", error: "Модель groq: 429 Rate limit" });
    expect(createTask).not.toHaveBeenCalled();

    const [{ text, replyMarkup }] = sendMessage.mock.calls[0];
    expect(text).toContain("не разобрал");
    expect(replyMarkup.inline_keyboard.flat().map((b: { callback_data: string }) => b.callback_data)).toContain(
      "cap:retry:1"
    );
    // В журнале сбой виден с причиной, а не как «обработано».
    expect(markFailed).toHaveBeenCalledWith(1, "Модель groq: 429 Rate limit");
  });

  it("сообщение без текста и голоса честно называется неподдержанным", async () => {
    const { deps, sendMessage, captureItems } = makeDeps();
    const update: TelegramUpdate = {
      update_id: 2,
      message: { message_id: 12, date: 1, chat: { id: CHAT, type: "private" } },
    };

    const result = await handleUpdate(update, CHAT, deps);

    expect(result).toEqual({ status: "processed", action: "unsupported" });
    expect(captureItems).not.toHaveBeenCalled();
    expect(lastText(sendMessage)).toContain("текст и голосовые");
  });
});

describe("захват голосового", () => {
  beforeEach(() => vi.clearAllMocks());

  it("скачивает, расшифровывает и показывает расшифровку в ответе", async () => {
    const { deps, getFile, downloadFile, transcribe, createTask, sendMessage } = makeDeps();

    const result = await handleUpdate(voiceUpdate(), CHAT, deps);

    expect(result).toEqual({ status: "processed", action: "voice" });
    expect(getFile).toHaveBeenCalledWith("voice-file-1");
    expect(downloadFile).toHaveBeenCalledWith("voice/file_1.oga");

    // Whisper определяет формат по имени файла: безымянный Blob получает 400.
    const [file] = transcribe.mock.calls[0] as [File];
    expect(file).toBeInstanceOf(File);
    expect(file.name).toBe("voice.ogg");
    expect(file.type).toBe("audio/ogg");
    expect(file.size).toBe(1024);

    expect(createTask).toHaveBeenCalledWith(
      expect.objectContaining({ title: "заполнить итмо" })
    );
    expect(lastText(sendMessage)).toContain("🎤");
    expect(lastText(sendMessage)).toContain("заполнить итмо");
  });

  it("расшифровка уходит в модель как обычный текст", async () => {
    const { deps, captureItems } = makeDeps({
      transcribe: vi.fn().mockResolvedValue("Сходить к суровцеву"),
    });

    await handleUpdate(voiceUpdate(), CHAT, deps);

    expect(captureItems).toHaveBeenCalledWith("Сходить к суровцеву", expect.anything());
  });

  it("длинная расшифровка не мешает ответить: карточка уходит в лимите", async () => {
    // Раньше карточка на 5000+ символов получала от Telegram 400 «too long»,
    // sendMessage бросал, апдейт помечался failed — и пользователь не узнавал,
    // что задачи уже созданы.
    const { deps, sendMessage, createTask } = makeDeps({
      transcribe: vi.fn().mockResolvedValue("сходить к суровцеву и заполнить итмо ".repeat(150)),
    });

    const result = await handleUpdate(voiceUpdate(), CHAT, deps);

    expect(result).toEqual({ status: "processed", action: "voice" });
    expect(createTask).toHaveBeenCalledTimes(1);
    expect(lastText(sendMessage).length).toBeLessThanOrEqual(4096);
    expect(lastText(sendMessage)).toContain("заполнить итмо");
  });

  it("голосовое больше лимита Telegram даже не качается", async () => {
    const { deps, getFile, downloadFile, sendMessage, markFailed } = makeDeps();

    const result = await handleUpdate(voiceUpdate(6, 21 * 1024 * 1024), CHAT, deps);

    expect(getFile).not.toHaveBeenCalled();
    expect(downloadFile).not.toHaveBeenCalled();
    expect(result.status).toBe("failed");
    expect(lastText(sendMessage)).toContain("20 МБ");
    expect(markFailed).toHaveBeenCalled();
  });

  it("сбой расшифровки не молчит: причина и кнопка повтора", async () => {
    const { deps, sendMessage, createTask } = makeDeps({
      transcribe: vi.fn().mockRejectedValue(new Error("Модель groq: 429 Rate limit")),
    });

    const result = await handleUpdate(voiceUpdate(), CHAT, deps);

    expect(result.status).toBe("failed");
    expect(createTask).not.toHaveBeenCalled();
    const [{ text, replyMarkup }] = sendMessage.mock.calls[0];
    expect(text).toContain("429");
    expect(replyMarkup.inline_keyboard.flat()[0].callback_data).toBe("cap:retry:5");
  });

  it("пустая расшифровка не создаёт задачу без названия", async () => {
    const { deps, createTask, sendMessage } = makeDeps({
      transcribe: vi.fn().mockResolvedValue("   "),
    });

    await handleUpdate(voiceUpdate(), CHAT, deps);

    expect(createTask).not.toHaveBeenCalled();
    expect(lastText(sendMessage)).toContain("не разобрал");
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

  it("«разобрать заново» берёт исходное сообщение из журнала и повторяет разбор", async () => {
    const { deps, loadUpdate, captureItems, createTask, sendMessage } = makeDeps({
      loadUpdate: vi.fn().mockResolvedValue(textUpdate("заполнить итмо", CHAT, 42)),
    });

    const result = await handleUpdate(callbackUpdate("cap:retry:42"), CHAT, deps);

    expect(loadUpdate).toHaveBeenCalledWith(42);
    expect(captureItems).toHaveBeenCalledWith("заполнить итмо", expect.anything());
    expect(createTask).toHaveBeenCalledTimes(1);
    expect(lastText(sendMessage)).toContain("заполнить итмо");
    expect(result).toEqual({ status: "processed", action: "callback" });
  });

  it("«разобрать заново» на голосовом расшифровывает его снова", async () => {
    const { deps, transcribe, captureItems } = makeDeps({
      loadUpdate: vi.fn().mockResolvedValue(voiceUpdate(42)),
    });

    await handleUpdate(callbackUpdate("cap:retry:42"), CHAT, deps);

    expect(transcribe).toHaveBeenCalledTimes(1);
    expect(captureItems).toHaveBeenCalledWith("заполнить итмо", expect.anything());
  });

  it("«задачей как есть» заводит задачу мимо модели", async () => {
    const { deps, captureItems, createTask, sendMessage } = makeDeps({
      loadUpdate: vi.fn().mockResolvedValue(textUpdate("Надо купить билеты", CHAT, 42)),
    });

    const result = await handleUpdate(callbackUpdate("cap:astask:42"), CHAT, deps);

    expect(captureItems).not.toHaveBeenCalled();
    expect(createTask).toHaveBeenCalledWith({
      title: "Купить билеты",
      columnId: "col-backlog",
      priority: "normal",
    });
    expect(lastText(sendMessage)).toContain("Купить билеты");
    expect(result).toEqual({ status: "processed", action: "callback" });
  });

  it("апдейта нет в журнале — просим прислать сообщение заново", async () => {
    const { deps, captureItems, createTask, sendMessage } = makeDeps();

    await handleUpdate(callbackUpdate("cap:retry:404"), CHAT, deps);

    expect(captureItems).not.toHaveBeenCalled();
    expect(createTask).not.toHaveBeenCalled();
    expect(lastText(sendMessage)).toContain("журнале");
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

  it("«ответил по вэду» уводит в поиск, а не заводит новую задачу", async () => {
    // Прошедшее время — это про существующее дело. Заведи бот из этой фразы
    // задачу, её пришлось бы тут же закрывать: мусор ровно там, где человек
    // хотел прибраться.
    const { deps, createTask, searchTasks, sendMessage } = makeDeps({
      captureItems: vi
        .fn()
        .mockResolvedValue([{ kind: "question", text: "вэду", done: true }]),
    });

    const result = await handleUpdate(textUpdate("ответил по вэду"), CHAT, deps);

    expect(result).toEqual({ status: "processed", action: "search" });
    expect(createTask).not.toHaveBeenCalled();
    expect(searchTasks).toHaveBeenCalledWith("вэду", expect.any(Number));

    const [{ text, replyMarkup }] = sendMessage.mock.calls.at(-1)!;
    expect(text).toContain("уже сделана");
    expect(text).toContain("ответить по вэду");

    const buttons = replyMarkup.inline_keyboard.flat();
    expect(buttons.map((b: { text: string }) => b.text)).toContain("Нет, это новая задача");
    // Кнопка закрытия есть — но нажимает её человек, а не бот.
    expect(
      buttons.some((b: { callback_data?: string }) =>
        parseTaskCallback(b.callback_data)?.kind === "done"
      )
    ).toBe(true);
  });

  it("«найди задачи по вэду» показывает найденное с кнопкой на каждой", async () => {
    const { deps, createTask, sendMessage } = makeDeps({
      captureItems: vi.fn().mockResolvedValue([{ kind: "question", text: "вэду" }]),
      searchTasks: vi.fn().mockResolvedValue([
        HIT,
        { ...HIT, task: { ...HIT.task, id: OTHER_ID, title: "Заполнить пилот по вэду" } },
      ]),
    });

    const result = await handleUpdate(textUpdate("найди задачи по вэду"), CHAT, deps);

    expect(result.status).toBe("processed");
    expect(createTask).not.toHaveBeenCalled();

    const [{ text, replyMarkup }] = sendMessage.mock.calls.at(-1)!;
    expect(text).toContain("Нашёл 2");
    const labels = replyMarkup.inline_keyboard.flat().map((b: { text: string }) => b.text);
    expect(labels).toContain("✓ ответить по вэду");
    expect(labels).toContain("✓ Заполнить пилот по вэду");
  });

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
    expect(markProcessed).toHaveBeenCalledWith(9);
  });

  it("ответ на «пришлите название» правит задачу, а не создаёт новую", async () => {
    const { deps, createTask, updateTask, captureItems, editMessageText } = makeDeps({
      takeAwaitInput: vi.fn().mockResolvedValue({
        payload: { taskId: TASK_ID, field: "title" },
        messageId: 42,
      }),
    });

    const result = await handleUpdate(textUpdate("ответить по вэду до пятницы"), CHAT, deps);

    expect(result).toEqual({ status: "processed", action: "edit" });
    expect(captureItems).not.toHaveBeenCalled();
    expect(createTask).not.toHaveBeenCalled();
    expect(updateTask).toHaveBeenCalledWith(TASK_ID, { title: "ответить по вэду до пятницы" });
    // Правится карточка, с которой спрашивали, а не последнее сообщение чата.
    expect(editMessageText).toHaveBeenCalledWith(expect.objectContaining({ messageId: 42 }));
  });

  it("без заданного вопроса сообщение идёт в захват как обычно", async () => {
    const { deps, createTask, captureItems, takeAwaitInput, updateTask } = makeDeps();

    await handleUpdate(textUpdate("заполнить итмо"), CHAT, deps);

    expect(takeAwaitInput).toHaveBeenCalledWith(CHAT);
    expect(captureItems).toHaveBeenCalled();
    expect(createTask).toHaveBeenCalled();
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

  it("голосовое снимает заданный вопрос, а не оставляет его следующему тексту", async () => {
    const { deps, cancelAwaitInput, takeAwaitInput, updateTask, createTask } = makeDeps({
      takeAwaitInput: vi.fn().mockResolvedValue({
        payload: { taskId: TASK_ID, field: "title" },
        messageId: 42,
      }),
    });

    await handleUpdate(voiceUpdate(), CHAT, deps);

    expect(cancelAwaitInput).toHaveBeenCalledWith(CHAT);
    // Расшифровка — не ответ на «пришлите название»: голосовое идёт в захват.
    expect(takeAwaitInput).not.toHaveBeenCalled();
    expect(updateTask).not.toHaveBeenCalled();
    expect(createTask).toHaveBeenCalled();
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

describe("captureDryRunFromEnv", () => {
  it("не задана — режим выключен, бот пишет в доску", () => {
    vi.stubEnv("TELEGRAM_CAPTURE_DRY_RUN", "");
    expect(captureDryRunFromEnv()).toBe(false);
    vi.unstubAllEnvs();
  });

  it("явное выключение распознаётся", () => {
    for (const value of ["0", "false", "off", "no", "FALSE", " Off "]) {
      vi.stubEnv("TELEGRAM_CAPTURE_DRY_RUN", value);
      expect(captureDryRunFromEnv(), value).toBe(false);
    }
    vi.unstubAllEnvs();
  });

  it("любое другое значение включает режим", () => {
    // Режим защитный: при непонятном значении честнее не писать в доску,
    // чем писать. «maybe» — это не «нет».
    for (const value of ["1", "true", "on", "yes", "maybe"]) {
      vi.stubEnv("TELEGRAM_CAPTURE_DRY_RUN", value);
      expect(captureDryRunFromEnv(), value).toBe(true);
    }
    vi.unstubAllEnvs();
  });
});
