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
  type CreatedTask,
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
    questions: [],
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

/*
 * Причина сбоя — единственное место, где режется сырой текст, а не готовый
 * HTML: `reason` и `warning` уходят полями результата, а экранирует их уже
 * карточка. Правило разреза при этом то же самое, и проверять его надо
 * отдельно: слот «причина сбоя» в переборе ниже собирает строку карточки, до
 * этой обрезки не доходя, — то есть регресс в ней прошёл бы молча.
 *
 * Через captureMessage, а не через экспорт: обрезка живёт внутри модуля, и
 * бот пользуется именно этим путём.
 */
describe("причина сбоя обрезается по законному месту", () => {
  /** REASON_LIMIT из capture.ts. Предел — часть договора, не деталь. */
  const REASON_LIMIT = 160;

  /** Модель упала тем, что передали. Возвращается причина из результата. */
  const reasonOfFailure = async (error: unknown): Promise<string> => {
    const { deps } = makeDeps([], { captureItems: vi.fn().mockRejectedValue(error) });
    const result = await captureMessage("заполнить итмо", deps);
    if (result.status !== "failed") throw new Error(`ожидался failed, получен ${result.status}`);
    return result.reason;
  };

  it("короткая причина доезжает дословно, без многоточия", async () => {
    expect(await reasonOfFailure(new Error("Модель groq: 429 Rate limit"))).toBe(
      "Модель groq: 429 Rate limit"
    );
  });

  it("многословная причина режется ровно до предела вместе с многоточием", async () => {
    // Чужие сообщения об ошибках бывают на тысячу символов, а причина идёт в
    // первую строку карточки — ту, что видно в списке чатов.
    const message = "Модель groq упала на попытке разбора: ".repeat(50);
    const reason = await reasonOfFailure(new Error(message));

    // Ровно предел, а не «хоть сколько-то короче»: обрезка по limit вместо
    // limit минус многоточие даёт 161 символ и тихо разъезжается с бюджетом
    // карточки, а обрезка вдвое короче молча теряет текст.
    expect(reason).toHaveLength(REASON_LIMIT);
    expect(reason.endsWith("…")).toBe(true);
    expect(message.startsWith(reason.slice(0, -1))).toBe(true);
  });

  it("причина длиной ровно в предел не трогается", async () => {
    const message = "я".repeat(REASON_LIMIT);
    expect(await reasonOfFailure(new Error(message))).toBe(message);
  });

  it("не-Error не превращается в «undefined» посреди карточки", async () => {
    expect(await reasonOfFailure("строка вместо ошибки")).toBe("неизвестная ошибка");
  });

  it("эмодзи на месте разреза не разрубается пополам", async () => {
    // Перебор по одному символу: суррогатная пара занимает две позиции, и в
    // разрез она попадает ровно при одном смещении из двух сотен. Одинокая
    // половинка — не UTF-8, Telegram отвечает на неё 400, а такую 400 клиент
    // не ретраит и не понижает до plain text: пользователь не получит ничего.
    for (let offset = 0; offset <= 200; offset++) {
      const reason = await reasonOfFailure(new Error(`${"я".repeat(offset)}😀${"я".repeat(300)}`));
      const where = `смещение ${offset}`;

      expect(reason.length, where).toBeLessThanOrEqual(REASON_LIMIT);
      expect(reason, where).not.toMatch(LONE_SURROGATE);
    }
  });

  it("предупреждение о частичной записи режется тем же правилом", async () => {
    const message = "база недоступна: ".repeat(40);
    const createTask = vi
      .fn()
      .mockResolvedValueOnce({ id: "task-1" })
      .mockRejectedValueOnce(new Error(message));
    const { deps } = makeDeps(
      [
        { kind: "task", text: "первая" },
        { kind: "task", text: "вторая" },
      ],
      { createTask }
    );

    const result = await captureMessage("первая, вторая", deps);

    expect(result.status === "captured" && result.warning).toHaveLength(REASON_LIMIT);
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
  "неотвеченный вопрос": (text) =>
    renderCaptureCard(captured({ questions: [{ text }] }), { updateId: 1 }).text,
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

  it("вопрос без ответа не выдавливает подтверждение задач", () => {
    // Вопрос в сообщении с задачами — подсказка, а не главное: при полной
    // карточке он обязан уступить место подтверждению, а не наоборот.
    const card = renderCaptureCard(
      captured({
        tasks: ceiling(25, 200),
        questions: [{ text: "что там с вэду и итмо ".repeat(10) }],
        others: Array.from({ length: 10 }, () => ({
          kind: "note" as const,
          text: "мысль ".repeat(40),
        })),
        warning: "база недоступна",
      }),
      { updateId: 1, transcript: "расшифровка ".repeat(80) }
    );

    expect(card.text.length).toBeLessThanOrEqual(TELEGRAM_MESSAGE_LIMIT);
    expect(card.text).toContain("✅ 25 задач · Работа · Бэклог");
    expect(card.text).toMatch(/…и ещё \d+ задач\S* — все на доске/);
    expect(card.text).toContain("Часть задач сохранить не удалось: база недоступна");
  });

  it("в свободной карточке вопрос виден и назван словами автора", () => {
    const card = renderCaptureCard(
      captured({ questions: [{ text: "вэду" }] }),
      { updateId: 1 }
    );

    expect(card.text).toContain("Про «вэду» ничего не менял");
    expect(card.text).toContain("<b>заполнить итмо</b>");
  });

  it("вопрос меряется после экранирования, а не до", () => {
    // escapeHtml растит «&» впятеро, поэтому предел, посчитанный по сырому
    // тексту, длину сообщения не ограничивает вовсе: восемьдесят амперсандов
    // превращаются в четыреста символов.
    const plain = renderCaptureCard(captured({ questions: [{ text: "я".repeat(500) }] }), {
      updateId: 1,
    });
    const amps = renderCaptureCard(captured({ questions: [{ text: "&".repeat(500) }] }), {
      updateId: 1,
    });

    expect(amps.text.length).toBeLessThanOrEqual(plain.text.length);
  });

  it("без созданных задач вопрос в карточку не пишется — он уходит в поиск", () => {
    // Когда задач не нашлось, обработчик показывает выдачу поиска вместо этой
    // карточки. Подсказка «ничего не менял» там была бы неправдой.
    const card = renderCaptureCard(
      captured({ tasks: [], questions: [{ text: "вэду" }] }),
      { updateId: 1 }
    );

    expect(card.text).not.toContain("ничего не менял");
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

/*
 * Экранируемые символы при бюджете на исходе.
 *
 * Дыра, из-за которой мутант «экранировать после обрезки, а не до» когда-то
 * проходил весь файл: перебор слотов выше гоняет амперсанды на пустой
 * карточке, где до потолка ещё три тысячи символов, а тесты на потолок берут
 * расшифровку из букв, которых escapeHtml не касается. Сочетание «текст,
 * растущий впятеро» плюс «остаток бюджета в сотню символов» не проверял никто,
 * а карточка вырастала на нём до 5023 символов при лимите 4096.
 *
 * Слабое место здесь ровно одно: расшифровка приписывается к готовому телу
 * карточки, и её предел считается из остатка — то есть длину пятикратно
 * выросшего текста никто уже не пересчитает.
 *
 * «На исходе» — не фигура речи, а требование к наполнению: перебор, у которого
 * максимум встал в семи сотнях символов от 4096, гоняет экранирование там, где
 * остаток ничего не режет. Так и было до T-0016 — остаток под расшифровку не
 * опускался ниже восьмисот, окна 40–600 перебор не касался вовсе, и мутант
 * «field отдаёт на четыре символа больше предела» жил на нём припеваючи.
 * Поэтому каждый перебор ниже упирается в expectAtCeiling.
 */
describe("карточка ответа — экранируемые символы при бюджете на исходе", () => {
  /** Задачи, забивающие карточку почти до потолка. */
  const bulk = (count: number, size: number) =>
    Array.from({ length: count }, (_, i) => ({
      title: `${i + 1} ${"я".repeat(size)}`,
      priority: "normal" as const,
    }));

  /** Мысли в хвосте: перечисляются после задач, ими и доедается остаток бюджета. */
  const notes = (count: number, size: number): CapturedItem[] =>
    Array.from({ length: count }, () => ({ kind: "note", text: "м".repeat(size) }));

  /** Обёртка расшифровки — по ней же цитата и вырезается из готовой карточки. */
  const TRANSCRIPT_OPEN = "🎤 <i>";
  const TRANSCRIPT_CLOSE = "</i>\n\n";
  /** Предел цитаты и порог, ниже которого её не показывают вовсе. */
  const TRANSCRIPT_LIMIT = 600;
  const TRANSCRIPT_MIN = 40;

  /** Расшифровка, как её видно в карточке. Пусто — значит, её выбросили целиком. */
  const quoteOf = (text: string) =>
    text.startsWith(TRANSCRIPT_OPEN)
      ? text.slice(TRANSCRIPT_OPEN.length, text.indexOf(TRANSCRIPT_CLOSE))
      : "";

  /**
   * Карточка обязана стоять у потолка. Проверка не на лимит, а на то, что
   * наполнение всё ещё доводит до него: подрастёт заголовок или подпись — и
   * перебор тихо съедет в область, где бюджет никого не ограничивает.
   */
  const expectAtCeiling = (length: number, where: string) => {
    expect(length, where).toBeLessThanOrEqual(TELEGRAM_MESSAGE_LIMIT);
    expect(length, `${where}: наполнение перестало доводить карточку до потолка`).toBeGreaterThan(
      TELEGRAM_MESSAGE_LIMIT - 64
    );
  };

  it("расшифровка из амперсандов над забитой до потолка карточкой остаётся в лимите", () => {
    // Двадцать задач и пять мыслей оставляют под расшифровку полторы сотни
    // символов — предел ей ставит остаток бюджета, а не TRANSCRIPT_LIMIT.
    const card = renderCaptureCard(captured({ tasks: bulk(20, 200), others: notes(5, 120) }), {
      updateId: 1,
      transcript: "&".repeat(2000),
    });

    expectAtCeiling(card.text.length, "амперсанды над забитой карточкой");
    expect(card.text.startsWith(TRANSCRIPT_OPEN)).toBe(true);
    expect(quoteOf(card.text).length).toBeLessThan(TRANSCRIPT_LIMIT);
    expect(card.text).toContain("✅ 20 задач · Работа · Бэклог");
    expect(card.text).toContain("Остальное сохранил как есть");
    expect(card.text).not.toMatch(BROKEN_ENTITY);
  });

  it("перебор длины расшифровки: экранируемый текст меряется в готовом HTML", () => {
    // Шаг в один символ по обе стороны от предела расшифровки (600): окно,
    // где сырой текст ещё влезает, а экранированный уже нет, — узкое, и
    // прыжками его не поймать.
    //
    // Наполнения два, и обе карточки стоят у потолка: в первой расшифровку
    // режет её собственный предел в 600 (остатка ей отведено 612), во второй —
    // остаток бюджета (139). Мутанта «field отдаёт на четыре символа больше
    // предела» убивает каждое из них само по себе — проверено прогоном с
    // выброшенным соседом: на 612 карточка вылезает до 4100 (амперсанды,
    // расшифровка в 116 символов), на 139 — до 4098 (амперсанды, 21 символ).
    //
    // Во всём прогоне (638 тестов) этого мутанта не ловит больше никто — и
    // соседний перебор объёма в том числе: там расшифровка всегда в 900
    // символов, то есть длиннее любого своего предела вместе с четырьмя
    // лишними, и в окно (предел, предел + 4] не попадает ни разу.
    const fills = {
      "остаток 612 — режет предел цитаты": notes(3, 49),
      "остаток 139 — режет бюджет": notes(5, 120),
    };
    const shapes = { амперсанды: "&", "открывающие скобки": "<", "закрывающие скобки": ">" };
    let longest = 0;

    for (const [fill, others] of Object.entries(fills)) {
      for (const [shape, char] of Object.entries(shapes)) {
        for (let size = 1; size <= 700; size++) {
          const card = renderCaptureCard(captured({ tasks: bulk(20, 200), others }), {
            updateId: 1,
            transcript: char.repeat(size),
          });
          const where = `${fill} · ${shape} · расшифровка в ${size} символов`;

          expect(card.text.length, where).toBeLessThanOrEqual(TELEGRAM_MESSAGE_LIMIT);
          expect(card.text, where).not.toMatch(BROKEN_ENTITY);
          expect(card.text, where).not.toMatch(BROKEN_TAG);
          // Цитату держит предел в 600 — сколько бы места ни оставалось.
          expect(quoteOf(card.text).length, where).toBeLessThanOrEqual(TRANSCRIPT_LIMIT);
          // Подтверждение важнее цитаты: под нож идёт расшифровка, не оно.
          expect(card.text, where).toContain("✅ 20 задач · Работа · Бэклог");

          longest = Math.max(longest, card.text.length);
        }
      }
    }

    expectAtCeiling(longest, "максимум перебора длины расшифровки");
  });

  /** Строка про непоказанные задачи вместе с отступом: под неё и занимают место. */
  const HIDDEN_TASKS_LINE = /\n…и ещё \d+ задач\S* — все на доске/;

  /**
   * Сколько места карточка занимает под «…и ещё N», ещё не зная N: по общему
   * числу задач и по самой длинной форме склонения («задача»).
   */
  const reserveFor = (total: number) => `\n…и ещё ${total} задача — все на доске`.length;

  /**
   * Наполнения от лёгкого к тяжёлому — грубый шаг перебора объёма.
   *
   * Пятнадцать перечисленных задач упираются в свой предел по числу, а не в
   * бюджет, и оставляют под расшифровку восемь сотен символов: до нуля его
   * доедают мысли в хвосте. Тридцать четыре задачи с эпиком, сроком и
   * приоритетом съедают бюджет сами — их строка длиннее трёх сотен символов.
   *
   * Задач именно тридцать четыре, а не двадцать пять: место под «…и ещё N»
   * занимается заранее — по общему числу задач и по самой длинной форме
   * склонения, потому что N в тот момент ещё неизвестно. Израсходован этот
   * запас дочиста только там, где у скрытых задач столько же разрядов, а форма
   * той же длины: «…и ещё 22 задачи» при тридцати четырёх созданных. Где он
   * израсходован не дочиста, остаток съедает лишний символ и мутант живёт —
   * прогон с двадцатью пятью задачами вместо тридцати четырёх зелёный.
   */
  const fills: { what: string; tasks: CreatedTask[]; others: CapturedItem[] }[] = [
    ...Array.from({ length: 27 }, (_, i) => ({
      what: `20 задач и 5 мыслей по ${i * 5} символов`,
      tasks: bulk(20, 200),
      others: notes(5, i * 5),
    })),
    ...Array.from({ length: 25 }, (_, i) => ({
      what: `34 задачи с эпиком и сроком, заголовок в ${176 + i} символов`,
      tasks: Array.from({ length: 34 }, (_, n) => ({
        title: `${n + 1} ${"я".repeat(176 + i)}`,
        priority: "urgent" as const,
        plannedDate: "2026-08-25",
        epic: "эпик с довольно длинным названием про вэд, итмо и физюриков",
      })),
      others: [],
    })),
  ];

  it("перебор объёма карточки: остаток под расшифровку проходит окно от 600 до нуля", () => {
    // Здесь меняется не расшифровка, а то, сколько от лимита ей достаётся.
    // Наполнение задаёт грубый шаг, длина имени проекта — точный: имя стоит в
    // заголовке, который в бюджет не просится, поэтому каждый его символ
    // двигает остаток ровно на единицу. Без этого перебор идёт прыжками в три
    // сотни символов и всё окно 40–600 перешагивает, ни разу в него не попав.
    //
    // Что этот перебор ловит — по прогону поимённо, а не по замыслу. Мутанта
    // «add ошибается на символ в проверке „влезает ли кусок“» во всём прогоне
    // (638 тестов) убивает только он: 4097 на тридцати четырёх задачах с
    // заголовком в 195 символов и именем проекта в 53. Мутанта «withTranscript
    // без минимума в 40» убивает и он, и «подтверждение и „…и ещё N“ переживают
    // любую длину заголовков». А «field отдаёт на четыре символа больше предела»
    // этому перебору не по зубам — его ловит соседний перебор длины расшифровки.
    const shapes = { буквы: "я", амперсанды: "&", "скобки и амперсанды": "&<>" };

    let longest = 0;
    let shortestQuote = Infinity;
    let dropped = 0;
    const lengths = new Set<number>();
    /** Наполнения, на которых запас под «…и ещё N» израсходован дочиста. */
    const tightFills = new Set<string>();

    for (const fill of fills) {
      for (let name = 1; name <= 64; name++) {
        const result = captured({
          tasks: fill.tasks,
          others: fill.others,
          environmentName: "п".repeat(name),
          warning: "база недоступна",
        });

        for (const [shape, char] of Object.entries(shapes)) {
          // Расшифровка заведомо длиннее любого остатка: режется всегда.
          const card = renderCaptureCard(result, { updateId: 1, transcript: char.repeat(900) });
          const where = `${fill.what} · имя проекта в ${name} символов · ${shape}`;
          const quote = quoteOf(card.text);

          expect(card.text.length, where).toBeLessThanOrEqual(TELEGRAM_MESSAGE_LIMIT);
          expect(card.text, where).not.toMatch(BROKEN_ENTITY);
          expect(card.text, where).not.toMatch(BROKEN_TAG);
          expect(quote.length, where).toBeLessThanOrEqual(TRANSCRIPT_LIMIT);
          expect(card.text, where).toMatch(/✅ \d+ задач\S* · /);
          expect(card.text, where).toMatch(HIDDEN_TASKS_LINE);
          expect(card.text, where).toContain("Часть задач сохранить не удалось: база недоступна");

          const hidden = card.text.match(HIDDEN_TASKS_LINE)?.[0] ?? "";
          if (
            card.text.length === TELEGRAM_MESSAGE_LIMIT &&
            hidden.length === reserveFor(fill.tasks.length)
          ) {
            tightFills.add(fill.what);
          }

          longest = Math.max(longest, card.text.length);
          if (quote.length === 0) dropped++;
          else {
            shortestQuote = Math.min(shortestQuote, quote.length);
            lengths.add(quote.length);
          }
        }
      }
    }

    // Перебор обязан пройти окно целиком, а не задеть его краем: цитату и
    // держали потолком в 600, и резали остатком бюджета, и выбрасывали.
    expectAtCeiling(longest, "максимум перебора объёма");
    expect(Math.max(...lengths), "самая длинная расшифровка").toBe(TRANSCRIPT_LIMIT);
    expect(lengths.size, "сколько разных длин расшифровки встретилось").toBeGreaterThan(400);
    expect(dropped, "сколько раз расшифровку выбросило целиком").toBeGreaterThan(100);
    // Огрызок короче порога не показывается вовсе. Ниже порога длину опускает
    // только отступ до границы сущности — и тот на считаные символы.
    expect(shortestQuote, "самая короткая показанная расшифровка").toBeGreaterThan(
      TRANSCRIPT_MIN - 8
    );
    // Состав наполнений — не деталь оформления: выброси отсюда 34-задачные
    // случаи, и мутант add воскресает, а перебор молча остаётся зелёным
    // (проверено прогоном). Дочиста запас расходуют только они: у лёгких
    // наполнений скрытых задач пять при двадцати созданных, и на разряде числа
    // с формой склонения набегает запас в два символа, которым лишний и
    // съедается.
    expect(
      [...tightFills].filter((what) => what.startsWith("34 задачи")),
      "наполнения, где запас под «…и ещё N» израсходован дочиста"
    ).not.toHaveLength(0);
  });

  it("экранируемые заголовки у потолка не выдавливают карточку за лимит", () => {
    // Тот же угол, но экранируемое стоит в заголовках, а не в расшифровке:
    // двадцать пять названий из одних амперсандов и скобок при пределе в 200
    // символов — это до двадцати пяти тысяч символов готового HTML.
    let longest = 0;

    for (const char of ["&", "<", ">"]) {
      for (let size = 190; size <= 210; size++) {
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
          { updateId: 1, transcript: `${"&".repeat(300)}${"я".repeat(300)}` }
        );
        const where = `«${char}» × ${size} в заголовке`;

        expect(card.text.length, where).toBeLessThanOrEqual(TELEGRAM_MESSAGE_LIMIT);
        expect(card.text, where).not.toMatch(BROKEN_ENTITY);
        expect(card.text, where).not.toMatch(BROKEN_TAG);
        expect(quoteOf(card.text).length, where).toBeLessThanOrEqual(TRANSCRIPT_LIMIT);
        expect(card.text, where).toContain("✅ 25 задач · Работа · Бэклог");
        expect(card.text, where).toMatch(HIDDEN_TASKS_LINE);

        longest = Math.max(longest, card.text.length);
      }
    }

    expectAtCeiling(longest, "максимум перебора экранируемых заголовков");
  });
});

describe("карточка ответа — целость разметки", () => {
  it("срок экранируется наравне с остальными подстановками", () => {
    // Сегодня недостижимо: срок доезжает до карточки только через
    // normalizeDate («lib/llm/capture.ts»), а тот пропускает лишь
    // /^\d{4}-\d{2}-\d{2}$/. Но renderCaptureCard экспортирована, и целость
    // разметки не должна держаться на валидаторе тремя слоями выше.
    const card = renderCaptureCard(
      captured({ tasks: [{ title: "итмо", priority: "normal", plannedDate: "9999-<b>-08" }] }),
      { updateId: 1 }
    );

    expect(card.text).toContain("до 08.&lt;b&gt;.9999");
    expect(card.text).not.toContain("до 08.<b>");
  });

  it("разметка карточки не вкладывается глубже двух тегов", () => {
    // На это опирается запас под закрывающие теги в клиенте: обрезав текст, он
    // дописывает их сам и отводит под них 32 символа. Двум тегам («</i></b>»)
    // хватает восьми, пяти вложенным <code> — уже нет. Свой тег пользователь
    // не вставит: его текст проходит escapeHtml, — так что глубину задаёт
    // только карточка, и мерить её надо здесь.
    const card = renderCaptureCard(
      captured({
        tasks: [
          {
            title: "заполнить <b>итмо</b> & <i>вэд</i>",
            priority: "urgent",
            plannedDate: "2026-08-25",
            epic: "Тех<code>долг</code>",
          },
        ],
        questions: [{ text: "что там с <pre>вэду</pre>" }],
        others: [{ kind: "note", text: "нет <s>синергии</s>" }],
        warning: "база <u>недоступна</u>",
      }),
      { updateId: 1, transcript: "надиктовал <b><i>это</i></b>" }
    );

    // Не ноль: иначе тест прошёл бы и на карточке вовсе без разметки.
    expect(maxTagDepth(card.text)).toBeGreaterThanOrEqual(1);
    expect(maxTagDepth(card.text)).toBeLessThanOrEqual(2);
  });
});

/** Наибольшая вложенность тегов разметки в готовом тексте сообщения. */
function maxTagDepth(text: string): number {
  let depth = 0;
  let max = 0;

  for (const [, slash] of text.matchAll(/<(\/?)(?:b|i|u|s|code|pre)>/g)) {
    depth += slash ? -1 : 1;
    max = Math.max(max, depth);
  }

  return max;
}

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
