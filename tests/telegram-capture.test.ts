import { describe, it, expect, vi } from "vitest";
import type { CapturedItem } from "@/lib/llm/capture";
import { TELEGRAM_MESSAGE_LIMIT } from "@/lib/telegram/client";
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

/** Удачный захват: одна задача в первой колонке. Поля переопределяются точечно. */
const captured = (over: Partial<Extract<CaptureResult, { status: "captured" }>> = {}) =>
  ({
    status: "captured",
    environmentName: "Работа",
    columnTitle: "Бэклог",
    tasks: [{ title: "заполнить итмо", priority: "normal" as const }],
    others: [],
    ...over,
  }) satisfies CaptureResult;

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

  it("длинная расшифровка не выносит карточку за лимит Telegram", () => {
    // Голосовое на 4-5 минут — штатный случай. Telegram на текст длиннее 4096
    // отвечает 400 «message is too long»: это не 429 и не «can't parse
    // entities», поэтому sendMessage бросал, и пользователь не получал ничего,
    // хотя задачи уже лежали на доске.
    const transcript = "сходить к суровцеву и заполнить итмо ".repeat(150);
    expect(transcript.length).toBeGreaterThan(TELEGRAM_MESSAGE_LIMIT);

    const card = renderCaptureCard(
      captured({
        tasks: [
          { title: "Сходить к суровцеву", priority: "normal" },
          { title: "заполнить итмо", priority: "normal" },
          { title: "ответить по вэду", priority: "normal" },
        ],
      }),
      { updateId: 1, transcript }
    );

    expect(card.text.length).toBeLessThanOrEqual(TELEGRAM_MESSAGE_LIMIT);
    // Режется расшифровка, а не подтверждение: список созданных задач — то,
    // ради чего пользователь на карточку и смотрит.
    expect(card.text).toContain("3 задачи");
    expect(card.text).toContain("ответить по вэду");
    expect(card.text).toContain("…");
  });

  it("гигантский заголовок подрезается в карточке (в задаче он остаётся целым)", () => {
    const title = "заполнить итмо ".repeat(400);
    const card = renderCaptureCard(
      captured({ tasks: [{ title, priority: "normal" }] }),
      { updateId: 1 }
    );

    expect(card.text.length).toBeLessThanOrEqual(TELEGRAM_MESSAGE_LIMIT);
    expect(card.text).toContain("заполнить итмо");
  });

  it("много задач: карточка в лимите и честно говорит, сколько не показала", () => {
    const tasks = Array.from({ length: 40 }, (_, i) => ({
      title: `задача номер ${i + 1} с довольно длинным названием про вэд и итмо`,
      priority: "normal" as const,
    }));

    const card = renderCaptureCard(captured({ tasks }), { updateId: 1 });

    expect(card.text.length).toBeLessThanOrEqual(TELEGRAM_MESSAGE_LIMIT);
    expect(card.text).toContain("40 задач");
    expect(card.text).toMatch(/ещё \d+/);
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

/*
 * Пределы карточки — перебором, а не парой примеров.
 *
 * Все три беды здесь одного класса: Telegram отвечает 400, а это не 429 и не
 * «can't parse entities», поэтому ни ретрай, ни фолбэк без parse_mode отправку
 * не спасают — пользователь не получает ничего, хотя задачи уже на доске.
 * Ошибиться легко: удачно выбранное смещение проходит и на сломанном коде.
 */

/** Одинокая половина суррогатной пары: для Telegram это не UTF-8 → 400. */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
/** «&», не начинающая сущность: разрезанная пополам «&amp;» — битая разметка. */
const BROKEN_ENTITY = /&(?!amp;|lt;|gt;)/;
/** Тег, разрезанный пополам. */
const BROKEN_TAG = /<[^>]*$/;

/** Куда попадает пользовательский текст: у каждого слота свой предел. */
const SLOTS: Record<string, (text: string) => string> = {
  расшифровка: (text) => renderCaptureCard(captured(), { updateId: 1, transcript: text }).text,
  "заголовок единственной задачи": (text) =>
    renderCaptureCard(captured({ tasks: [{ title: text, priority: "normal" }] }), { updateId: 1 })
      .text,
  "заголовок в списке": (text) =>
    renderCaptureCard(
      captured({
        tasks: [
          { title: "первая", priority: "normal" },
          { title: text, priority: "normal" },
        ],
      }),
      { updateId: 1 }
    ).text,
  "имя проекта": (text) =>
    renderCaptureCard(captured({ environmentName: text, columnTitle: text }), { updateId: 1 }).text,
  "имя эпика": (text) =>
    renderCaptureCard(
      captured({ tasks: [{ title: "заполнить итмо", priority: "normal", epic: text }] }),
      { updateId: 1 }
    ).text,
  остальное: (text) =>
    renderCaptureCard(captured({ tasks: [], others: [{ kind: "note", text }] }), { updateId: 1 })
      .text,
  "причина сбоя": (text) => renderCaptureCard({ status: "failed", reason: text }, { updateId: 1 }).text,
  "предупреждение о частичной записи": (text) =>
    renderCaptureCard(captured({ warning: text }), { updateId: 1 }).text,
};

/**
 * Виды текста, на которых обрезка ломается по-разному: эмодзи (суррогатные
 * пары), «&» (экранирование растит его впятеро), угловые скобки (после
 * экранирования это тоже сущности).
 */
const SHAPES: Record<string, (offset: number) => string> = {
  "эмодзи посреди текста": (offset) => `${"я".repeat(offset)}😀${"я".repeat(700)}`,
  "сплошные эмодзи": (offset) => `${"😀".repeat(offset)}!${"😀".repeat(400)}`,
  "эмодзи вперемешку с амперсандами": (offset) => `${"&😀".repeat(offset)}😀&${"я".repeat(700)}`,
  "сплошные амперсанды": (offset) => `${"&".repeat(offset)}${"😀".repeat(400)}`,
  "разметка в тексте пользователя": (offset) => `${"<b>😀".repeat(offset)}<i>${"я".repeat(700)}`,
};

describe("карточка ответа — обрезка перебором смещений", () => {
  for (const [slot, render] of Object.entries(SLOTS)) {
    it(`${slot}: ни битых символов, ни битой разметки, ни выхода за лимит`, () => {
      // Расшифровке отведено 600 символов, остальным слотам — от 64 до 200;
      // перебор идёт с запасом по обе стороны от каждого предела, чтобы тест
      // не зависел от конкретных чисел.
      const maxOffset = slot === "расшифровка" ? 640 : 230;

      for (const [shape, build] of Object.entries(SHAPES)) {
        for (let offset = 0; offset <= maxOffset; offset++) {
          const where = `${slot} · ${shape} · смещение ${offset}`;
          const text = render(build(offset));

          expect(text.length, where).toBeLessThanOrEqual(TELEGRAM_MESSAGE_LIMIT);
          expect(text, where).not.toMatch(LONE_SURROGATE);
          expect(text, where).not.toMatch(BROKEN_ENTITY);
          expect(text, where).not.toMatch(BROKEN_TAG);
        }
      }
    });
  }
});

describe("карточка ответа — лимит 4096 при любых данных", () => {
  const ceiling = (count: number, size: number, prefix = "") =>
    Array.from({ length: count }, (_, i) => ({
      title: `${i + 1} ${prefix}${"я".repeat(size)}`,
      priority: "normal" as const,
      plannedDate: "2026-08-25",
      epic: "Техдолг",
    }));

  it("двадцать заголовков у потолка и длинная расшифровка укладываются в лимит", () => {
    // Ровно тот угол, из-за которого задача и заведена: 20 × 200 символов плюс
    // эпик, срок и расшифровка на 600 давали 4444 символа.
    const card = renderCaptureCard(captured({ tasks: ceiling(20, 200) }), {
      updateId: 1,
      transcript: "надиктованная расшифровка голосового ".repeat(30),
    });

    expect(card.text.length).toBeLessThanOrEqual(TELEGRAM_MESSAGE_LIMIT);
    // Подтверждение — и первая строка, и хвост списка — на месте: режется
    // расшифровка, ради которой сообщение точно не слали.
    expect(card.text).toContain("✅ 20 задач · Работа · Бэклог");
    expect(card.text).toContain("15. <b>");
    expect(card.text).toContain("…и ещё 5 задач — все на доске");
    expect(card.text.startsWith("🎤 <i>")).toBe(true);
  });

  it("подтверждение и «…и ещё N» переживают любую длину заголовков", () => {
    // Перебор по одному символу: окно, в котором строка «…и ещё N» перестаёт
    // помещаться в остаток бюджета, шириной в три десятка символов — прыжками
    // его не поймать, а именно она и есть то, ради чего пределы вводились.
    // Задачи здесь с эпиком, сроком и приоритетом: на одних заголовках у
    // потолка карточка ещё укладывается, а вместе с подписями — уже нет.
    const shapes = { обычный: "я", "экранируемый впятеро": "&" };

    for (const [shape, char] of Object.entries(shapes)) {
      for (let size = 1; size <= 250; size++) {
        const card = renderCaptureCard(
          captured({
            tasks: Array.from({ length: 25 }, (_, i) => ({
              title: `${i + 1} ${char.repeat(size)}`,
              priority: "urgent" as const,
              plannedDate: "2026-08-25",
              epic: "эпик с довольно длинным названием про вэд, итмо и физюриков",
            })),
            warning: "база недоступна",
          }),
          { updateId: 1, transcript: "надиктованная расшифровка ".repeat(40) }
        );

        const where = `${shape} заголовок в ${size} символов`;
        expect(card.text.length, where).toBeLessThanOrEqual(TELEGRAM_MESSAGE_LIMIT);
        expect(card.text, where).toContain("✅ 25 задач · Работа · Бэклог");
        expect(card.text, where).toMatch(/…и ещё \d+ задач\S* — все на доске/);
        expect(card.text, where).toContain("Часть задач сохранить не удалось: база недоступна");
        expect(card.text, where).not.toMatch(BROKEN_ENTITY);
      }
    }
  });

  it("список остального ограничен по числу и говорит про хвост", () => {
    const others: CapturedItem[] = Array.from({ length: 30 }, (_, i) => ({
      kind: "note",
      text: `мысль номер ${i + 1}`,
    }));

    const card = renderCaptureCard(captured({ others }), { updateId: 1 });

    expect(card.text.split("• ").length - 1).toBe(5);
    expect(card.text).toContain("…и ещё 25 элементов");
    expect(card.text.length).toBeLessThanOrEqual(TELEGRAM_MESSAGE_LIMIT);
  });

  it("остальное не выдавливает задачи из карточки", () => {
    const others: CapturedItem[] = Array.from({ length: 30 }, () => ({
      kind: "note",
      text: "мысль ".repeat(40),
    }));

    const card = renderCaptureCard(captured({ tasks: ceiling(25, 200), others }), {
      updateId: 1,
      transcript: "расшифровка ".repeat(80),
    });

    expect(card.text.length).toBeLessThanOrEqual(TELEGRAM_MESSAGE_LIMIT);
    expect(card.text).toContain("✅ 25 задач · Работа · Бэклог");
    expect(card.text).toMatch(/…и ещё \d+ задач\S* — все на доске/);
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
