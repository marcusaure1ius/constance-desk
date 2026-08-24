import { describe, it, expect, vi } from "vitest";
import type { CapturedItem } from "@/lib/llm/capture";
import {
  captureCallback,
  captureMessage,
  createTaskFromText,
  parseCaptureCallback,
  plural,
  renderCaptureCard,
  type CaptureBoardData,
  type CaptureDeps,
  type CaptureResult,
} from "@/lib/telegram/capture";

/**
 * Перекладывание элементов на доску и карточка ответа. Модель здесь замокана:
 * проверяется не качество разбора, а что задача ложится в первую колонку
 * активного проекта и что пользователь получает ответ в любом случае.
 */

const BOARD: CaptureBoardData = {
  environment: { id: "env-1", name: "Работа" },
  environmentNames: ["Работа", "Личное"],
  // Колонок несколько намеренно: с одной колонкой тест не отличил бы первую от
  // последней и прошёл бы на сломанном выборе.
  columns: [
    { id: "col-backlog", title: "Бэклог" },
    { id: "col-doing", title: "В работе" },
    { id: "col-done", title: "Готово" },
  ],
  epics: [
    { id: "epic-debt", name: "Техдолг" },
    { id: "epic-ved", name: "ВЭД" },
  ],
};

function makeDeps(items: CapturedItem[], overrides: Partial<CaptureDeps> = {}) {
  const loadBoard = vi.fn().mockResolvedValue(BOARD);
  const captureItems = vi.fn().mockResolvedValue(items);
  const createTask = vi.fn().mockResolvedValue({ id: "task-1" });

  const deps: CaptureDeps = { loadBoard, captureItems, createTask, ...overrides };
  return { deps, loadBoard, captureItems, createTask };
}

describe("captureMessage — задачи на доске", () => {
  it("кладёт задачу в первую колонку активного проекта", async () => {
    const { deps, createTask } = makeDeps([{ kind: "task", text: "заполнить итмо" }]);

    const result = await captureMessage("заполнить итмо", deps);

    expect(createTask).toHaveBeenCalledTimes(1);
    expect(createTask).toHaveBeenCalledWith({
      title: "заполнить итмо",
      columnId: "col-backlog",
      categoryId: undefined,
      priority: "normal",
      plannedDate: undefined,
    });
    expect(result).toMatchObject({
      status: "captured",
      environmentName: "Работа",
      columnTitle: "Бэклог",
    });
  });

  it("отдаёт модели контекст доски: имена проектов, колонок и эпиков", async () => {
    const { deps, captureItems } = makeDeps([]);

    await captureMessage("что-то", deps);

    expect(captureItems).toHaveBeenCalledWith("что-то", {
      environmentName: "Работа",
      environmentNames: ["Работа", "Личное"],
      columnTitles: ["Бэклог", "В работе", "Готово"],
      epicNames: ["Техдолг", "ВЭД"],
    });
  });

  it("три задачи создаются тремя вызовами и все в первой колонке", async () => {
    const { deps, createTask } = makeDeps([
      { kind: "task", text: "Сходить к суровцеву" },
      { kind: "task", text: "заполнить итмо" },
      { kind: "task", text: "ответить по вэду" },
    ]);

    const result = await captureMessage("Сходить к суровцеву, заполнить итмо, ответить по вэду", deps);

    expect(createTask).toHaveBeenCalledTimes(3);
    expect(createTask.mock.calls.map(([input]) => input.title)).toEqual([
      "Сходить к суровцеву",
      "заполнить итмо",
      "ответить по вэду",
    ]);
    expect(createTask.mock.calls.every(([input]) => input.columnId === "col-backlog")).toBe(true);
    expect(result.status === "captured" && result.tasks).toHaveLength(3);
  });

  it("срок и приоритет доезжают до задачи", async () => {
    const { deps, createTask } = makeDeps([
      {
        kind: "task",
        text: "Контроль за ВШЭ кейсы",
        plannedDate: "2026-08-25",
        priority: "urgent",
      },
    ]);

    await captureMessage("Контроль за ВШЭ кейсы до 25.08", deps);

    expect(createTask).toHaveBeenCalledWith(
      expect.objectContaining({ plannedDate: "2026-08-25", priority: "urgent" })
    );
  });

  it("эпик превращается в categoryId своей категории", async () => {
    const { deps, createTask } = makeDeps([
      { kind: "task", text: "разобрать долги", epic: "Техдолг" },
    ]);

    const result = await captureMessage("разобрать долги", deps);

    expect(createTask).toHaveBeenCalledWith(expect.objectContaining({ categoryId: "epic-debt" }));
    expect(result.status === "captured" && result.tasks[0].epic).toBe("Техдолг");
  });

  it("не-задачи не создаются, но возвращаются как сохранённые", async () => {
    const { deps, createTask } = makeDeps([
      { kind: "task", text: "написать комментарии по стратегии" },
      { kind: "note", text: "нет синергии" },
      { kind: "read", text: "https://example.com/post" },
    ]);

    const result = await captureMessage("длинное сообщение", deps);

    expect(createTask).toHaveBeenCalledTimes(1);
    expect(result.status === "captured" && result.others.map((i) => i.kind)).toEqual([
      "note",
      "read",
    ]);
  });
});

describe("captureMessage — сбои", () => {
  it("модель упала: ни одной задачи и статус failed с причиной", async () => {
    const { deps, createTask } = makeDeps([], {
      captureItems: vi.fn().mockRejectedValue(new Error("Модель groq: 429 Rate limit")),
    });

    const result = await captureMessage("заполнить итмо", deps);

    expect(result).toEqual({ status: "failed", reason: "Модель groq: 429 Rate limit" });
    expect(createTask).not.toHaveBeenCalled();
  });

  it("модель ничего не распознала — empty, а не пустая карточка успеха", async () => {
    const { deps } = makeDeps([]);
    expect(await captureMessage("апвыапвы", deps)).toEqual({ status: "empty" });
  });

  it("нет проектов или колонок — складывать некуда", async () => {
    const { deps: noEnv } = makeDeps([], { loadBoard: vi.fn().mockResolvedValue(null) });
    expect(await captureMessage("х", noEnv)).toEqual({ status: "no_board" });

    const { deps: noColumns } = makeDeps([], {
      loadBoard: vi.fn().mockResolvedValue({ ...BOARD, columns: [] }),
    });
    expect(await captureMessage("х", noColumns)).toEqual({ status: "no_board" });
  });

  it("база отвалилась посреди списка: показываем, что успели, а не «ничего не вышло»", async () => {
    const createTask = vi
      .fn()
      .mockResolvedValueOnce({ id: "task-1" })
      .mockRejectedValueOnce(new Error("база недоступна"));
    const { deps } = makeDeps(
      [
        { kind: "task", text: "первая" },
        { kind: "task", text: "вторая" },
      ],
      { createTask }
    );

    const result = await captureMessage("первая, вторая", deps);

    expect(result.status).toBe("captured");
    expect(result.status === "captured" && result.tasks.map((t) => t.title)).toEqual(["первая"]);
    expect(result.status === "captured" && result.warning).toContain("база недоступна");
  });

  it("упавшая доска не превращается в исключение", async () => {
    const { deps } = makeDeps([], {
      loadBoard: vi.fn().mockRejectedValue(new Error("база недоступна")),
    });

    expect(await captureMessage("х", deps)).toEqual({
      status: "failed",
      reason: "база недоступна",
    });
  });
});

describe("createTaskFromText", () => {
  it("заводит задачу из текста без разбора, сняв «Надо»", async () => {
    const { deps, createTask, captureItems } = makeDeps([]);

    const result = await createTaskFromText("Надо купить билеты", deps);

    expect(captureItems).not.toHaveBeenCalled();
    expect(createTask).toHaveBeenCalledWith({
      title: "купить билеты",
      columnId: "col-backlog",
      priority: "normal",
    });
    expect(result.status === "captured" && result.tasks[0].title).toBe("купить билеты");
  });

  it("пустой текст задачей не становится", async () => {
    const { deps, createTask } = makeDeps([]);
    expect(await createTaskFromText("   ", deps)).toEqual({ status: "empty" });
    expect(createTask).not.toHaveBeenCalled();
  });
});

describe("кнопки захвата", () => {
  it("callback_data укладывается в лимит Telegram и разбирается обратно", () => {
    const data = captureCallback("retry", 987654321987);
    expect(Buffer.byteLength(data, "utf8")).toBeLessThanOrEqual(64);
    expect(parseCaptureCallback(data)).toEqual({ action: "retry", updateId: 987654321987 });
  });

  it("чужие и битые данные кнопки не разбираются", () => {
    expect(parseCaptureCallback("noop")).toBeNull();
    expect(parseCaptureCallback("cap:delete:1")).toBeNull();
    expect(parseCaptureCallback("cap:retry:abc")).toBeNull();
    expect(parseCaptureCallback(undefined)).toBeNull();
  });
});

describe("карточка ответа", () => {
  const captured = (over: Partial<Extract<CaptureResult, { status: "captured" }>> = {}) =>
    ({
      status: "captured",
      environmentName: "Работа",
      columnTitle: "Бэклог",
      tasks: [{ title: "заполнить итмо", priority: "normal" as const }],
      others: [],
      ...over,
    }) satisfies CaptureResult;

  it("первая строка подтверждает, дальше идёт заголовок задачи", () => {
    const card = renderCaptureCard(captured(), { updateId: 1 });
    const [first] = card.text.split("\n");

    expect(first).toContain("Задача");
    expect(first).toContain("Работа");
    expect(first).toContain("Бэклог");
    expect(card.text).toContain("<b>заполнить итмо</b>");
    // Задача создана — повторять разбор нечем, иначе появятся дубли.
    expect(card.replyMarkup).toBeUndefined();
  });

  it("несколько задач нумеруются и склоняются", () => {
    const card = renderCaptureCard(
      captured({
        tasks: [
          { title: "Сходить к суровцеву", priority: "normal" },
          { title: "заполнить итмо", priority: "normal" },
          { title: "ответить по вэду", priority: "normal", plannedDate: "2026-08-25" },
        ],
      }),
      { updateId: 1 }
    );

    expect(card.text).toContain("3 задачи");
    expect(card.text).toContain("1. <b>Сходить к суровцеву</b>");
    expect(card.text).toContain("3. <b>ответить по вэду</b>");
    expect(card.text).toContain("до 25.08");
  });

  it("экранирует разметку в заголовке задачи", () => {
    const card = renderCaptureCard(captured({ tasks: [{ title: "Цены & <ККУ>", priority: "normal" }] }), {
      updateId: 1,
    });

    expect(card.text).toContain("Цены &amp; &lt;ККУ&gt;");
    expect(card.text).not.toContain("<ККУ>");
  });

  it("сбой модели: причина, кнопка повтора и кнопка «задачей как есть»", () => {
    const card = renderCaptureCard({ status: "failed", reason: "Модель groq: 429" }, { updateId: 42 });

    expect(card.text).toContain("Сохранил сообщение");
    expect(card.text).toContain("429");
    expect(card.replyMarkup?.inline_keyboard.flat().map((b) => b.callback_data)).toEqual([
      "cap:retry:42",
      "cap:astask:42",
    ]);
  });

  it("ничего не распознано — те же две кнопки", () => {
    const card = renderCaptureCard({ status: "empty" }, { updateId: 7 });
    expect(card.replyMarkup?.inline_keyboard.flat()).toHaveLength(2);
  });

  it("одни мысли без задач — предлагаем завести задачу вручную", () => {
    const card = renderCaptureCard(
      captured({ tasks: [], others: [{ kind: "note", text: "нет синергии" }] }),
      { updateId: 8 }
    );

    expect(card.text).toContain("мысль: нет синергии");
    expect(card.replyMarkup?.inline_keyboard.flat().map((b) => b.callback_data)).toEqual([
      "cap:astask:8",
    ]);
  });

  it("расшифровка голосового показывается над карточкой", () => {
    const card = renderCaptureCard(captured(), { updateId: 1, transcript: "заполнить итмо" });
    expect(card.text.startsWith("🎤 <i>заполнить итмо</i>")).toBe(true);
  });

  it("частичная запись честно помечается предупреждением", () => {
    const card = renderCaptureCard(captured({ warning: "база недоступна" }), { updateId: 1 });
    expect(card.text).toContain("Часть задач сохранить не удалось");
    expect(card.text).toContain("база недоступна");
  });

  it("нет проекта — говорим об этом, а не молчим", () => {
    const card = renderCaptureCard({ status: "no_board" }, { updateId: 1 });
    expect(card.text).toContain("Складывать некуда");
  });
});

describe("plural", () => {
  it("склоняет по-русски", () => {
    const forms: [string, string, string] = ["задача", "задачи", "задач"];
    expect(plural(1, forms)).toBe("задача");
    expect(plural(2, forms)).toBe("задачи");
    expect(plural(5, forms)).toBe("задач");
    expect(plural(11, forms)).toBe("задач");
    expect(plural(21, forms)).toBe("задача");
    expect(plural(0, forms)).toBe("задач");
  });
});
