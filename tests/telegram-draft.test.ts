import { describe, it, expect } from "vitest";
import {
  draftCallback,
  parseDraftCallback,
  draftSummary,
  renderDraftCard,
  renderAppliedCard,
  renderClosedCard,
  parseDraftPayload,
  parseDraftFix,
  captureContextPayload,
  findMentionedEpic,
  intentQuestion,
  parseCaptureContext,
  draftMerged,
  isNonEmptyDraft,
  restatesDraft,
  renderEmptyAnswer,
  renderUnchangedAnswer,
  type DraftPayload,
} from "@/lib/telegram/draft";
import { A_CALLS, B_CALLS, MERGED_CALLS, subtaskCall } from "./fixtures/live-drafts";
import { LIVE_403 } from "./fixtures/route-cases";
import { taskCallback } from "@/lib/telegram/task-card";
import { TELEGRAM_MESSAGE_LIMIT } from "@/lib/telegram/client";

const HANDLE = "abcDEF_-12";
const TASK_ID = "11111111-2222-4333-8444-555555555555";

function draft(overrides: Partial<DraftPayload> = {}): DraftPayload {
  return {
    source: { text: "позвонить Маше", links: [], hasUnreadableMedia: false },
    corrections: [],
    calls: [
      { tool: "create_task", args: {}, label: "Задача «Позвонить Маше»" },
      { tool: "create_task", args: {}, label: "Задача «Купить хлеб» · срок 31.10" },
      { tool: "update_task", args: {}, label: "Изменить «Демка»: срок" },
    ],
    agentText: "Нашёл три дела",
    environmentId: "env-1",
    createdAt: "2026-10-24T10:00:00.000Z",
    ...overrides,
  };
}

function buttons(card: { replyMarkup?: { inline_keyboard: unknown[][] } }) {
  return (card.replyMarkup?.inline_keyboard ?? []).flat() as {
    text: string;
    callback_data?: string;
  }[];
}

describe("коды кнопок черновика", () => {
  it("укладываются в 64 байта и разбираются обратно", () => {
    expect(parseDraftCallback(draftCallback.send(HANDLE))).toEqual({
      action: "send",
      handleId: HANDLE,
    });
    expect(parseDraftCallback(draftCallback.fix(HANDLE))).toEqual({
      action: "fix",
      handleId: HANDLE,
    });
    expect(parseDraftCallback(draftCallback.cancel(HANDLE))).toEqual({
      action: "cancel",
      handleId: HANDLE,
    });
    expect(parseDraftCallback(draftCallback.retry(987654321))).toEqual({
      action: "retry",
      updateId: 987654321,
    });
    for (const code of [
      draftCallback.send(HANDLE),
      draftCallback.fix(HANDLE),
      draftCallback.cancel(HANDLE),
      draftCallback.retry(987654321),
    ]) {
      expect(Buffer.byteLength(code)).toBeLessThanOrEqual(64);
    }
  });

  it("чужие и испорченные коды дают null", () => {
    for (const data of [
      undefined,
      "",
      "t:dn:abc",
      "cap:retry:5",
      "d:ok:short",
      "d:ok:abcDEF_-12:extra",
      "d:xx:abcDEF_-12",
      "d:rt:abc",
      "d:rt:-5",
      "d:rt:1.5",
    ]) {
      expect(parseDraftCallback(data)).toBeNull();
    }
  });
});

describe("карточка черновика", () => {
  it("транскрипт, три пункта, текст агента и три кнопки в ряд", () => {
    const card = renderDraftCard(
      draft({
        source: {
          text: "позвонить Маше",
          transcript: "позвонить Маше & купить хлеб",
          links: [],
          hasUnreadableMedia: false,
        },
      }),
      HANDLE
    );

    expect(card.text).toContain("📝 Черновик");
    expect(card.text).toContain("🎙 «позвонить Маше &amp; купить хлеб»");
    expect(card.text).toContain("1. Задача «Позвонить Маше»");
    expect(card.text).toContain("2. Задача «Купить хлеб» · срок 31.10");
    expect(card.text).toContain("3. Изменить «Демка»: срок");
    expect(card.text).toContain("<i>Нашёл три дела</i>");
    expect(card.replyMarkup?.inline_keyboard).toHaveLength(1);
    expect(buttons(card).map((b) => b.callback_data)).toEqual([
      draftCallback.send(HANDLE),
      draftCallback.fix(HANDLE),
      draftCallback.cancel(HANDLE),
    ]);
  });

  it("транскрипт режется до 300 символов", () => {
    const card = renderDraftCard(
      draft({
        source: { text: "x", transcript: "я".repeat(1000), links: [], hasUnreadableMedia: false },
      }),
      HANDLE
    );
    expect(card.text).not.toContain("я".repeat(301));
  });

  it("после поправок заголовок показывает номер правки", () => {
    const card = renderDraftCard(draft({ corrections: ["срок пятница", "и хлеб"] }), HANDLE);
    expect(card.text).toContain("📝 Черновик · правка 2");
  });

  it("без label берёт имя инструмента, а HTML экранирует", () => {
    const card = renderDraftCard(
      draft({ calls: [{ tool: "create_task", args: {}, label: "<b>x</b>" }, { tool: "move_task", args: {} }] }),
      HANDLE
    );
    expect(card.text).toContain("1. &lt;b&gt;x&lt;/b&gt;");
    expect(card.text).toContain("2. move_task");
  });

  it("пустой черновик: без «Отправить», только «Исправить» и «Отмена»", () => {
    const card = renderDraftCard(draft({ calls: [], agentText: "" }), HANDLE);
    expect(card.text).toContain("Ничего не нашёл, что записать");
    expect(buttons(card).map((b) => b.callback_data)).toEqual([
      draftCallback.fix(HANDLE),
      draftCallback.cancel(HANDLE),
    ]);

    const withText = renderDraftCard(draft({ calls: [], agentText: "Это вопрос" }), HANDLE);
    expect(withText.text).toContain("Это вопрос");
    expect(withText.text).not.toContain("Ничего не нашёл");
  });

  it("60 пунктов не превышают лимит Telegram", () => {
    const calls = Array.from({ length: 60 }, (_, i) => ({
      tool: "create_task",
      args: {},
      label: `Задача «${"очень длинное название ".repeat(5)}${i}»`,
    }));
    const card = renderDraftCard(draft({ calls }), HANDLE);
    expect(card.text.length).toBeLessThanOrEqual(TELEGRAM_MESSAGE_LIMIT);
  });

  it("длинный черновик: пункты целиком, хвост «… и ещё N», и без «Отправить»", () => {
    const calls = Array.from({ length: 60 }, (_, i) => ({
      tool: "create_task",
      args: {},
      label: `Задача «${"очень длинное название ".repeat(5)}${i}»`,
    }));
    const card = renderDraftCard(draft({ calls }), HANDLE);

    expect(card.text.length).toBeLessThanOrEqual(TELEGRAM_MESSAGE_LIMIT);
    const shown = (card.text.match(/^\d+\. /gm) ?? []).length;
    expect(shown).toBeGreaterThan(0);
    expect(shown).toBeLessThan(60);
    expect(card.text).toContain(`… и ещё ${60 - shown} пункт`);
    expect(card.text).toContain("Слишком много пунктов — сократите поправкой");
    // Каждый показанный пункт — целиком, а не срезан посередине.
    expect(card.text).toContain(`${shown}. ${calls[shown - 1].label}`);
    expect(buttons(card).map((b) => b.callback_data)).toEqual([
      draftCallback.fix(HANDLE),
      draftCallback.cancel(HANDLE),
    ]);
  });

  it("длинный текст агента и расшифровки не срезают пункты и не прячут «Отправить»", () => {
    const card = renderDraftCard(
      draft({
        agentText: "я".repeat(3000),
        source: { text: "x", transcript: "т".repeat(3000), links: [], hasUnreadableMedia: false },
        correctionTranscript: "п".repeat(3000),
      }),
      HANDLE
    );
    expect(card.text.length).toBeLessThanOrEqual(TELEGRAM_MESSAGE_LIMIT);
    expect(card.text).toContain("3. Изменить «Демка»: срок");
    expect(buttons(card).map((b) => b.callback_data)).toContain(draftCallback.send(HANDLE));
  });

  it("подзадачи новой задачи видны вложенными строками, HTML экранирован", () => {
    const card = renderDraftCard(
      draft({
        calls: [
          {
            tool: "create_task",
            args: {
              title: "Отчёт",
              subtasks: [{ title: "Собрать <цифры>" }, { title: "Слайды", dueDate: "2026-10-31" }, { мусор: 1 }],
            },
            label: "Задача «Отчёт» · 3 подзадачи",
          },
          { tool: "create_epic_task", args: { title: "Б", subtasks: [{ title: "Шаг" }] }, label: "Задача «Б»" },
        ],
      }),
      HANDLE
    );
    expect(card.text).toContain("1. Задача «Отчёт» · 3 подзадачи\n   ◦ Собрать &lt;цифры&gt;\n   ◦ Слайды · срок 31.10");
    expect(card.text).toContain("2. Задача «Б»\n   ◦ Шаг");
  });

  it("голосовая поправка — её расшифровка под исходной", () => {
    const card = renderDraftCard(
      draft({ corrections: ["вторую не надо"], correctionTranscript: "вторую не надо & всё" }),
      HANDLE
    );
    expect(card.text).toContain("🎙 поправка: «вторую не надо &amp; всё»");
    expect(renderDraftCard(draft(), HANDLE).text).not.toContain("поправка:");
  });

  it("draftSummary склеивает подписи через «; »", () => {
    expect(draftSummary(draft())).toBe(
      "Задача «Позвонить Маше»; Задача «Купить хлеб» · срок 31.10; Изменить «Демка»: срок"
    );
  });
});

describe("отчёт о применении", () => {
  it("«Готово: 2 из 3», перечень пунктов, причина провала и кнопки на созданные задачи (L6)", () => {
    const card = renderAppliedCard(draft(), [
      { ok: true, data: { task: { id: TASK_ID, title: "Позвонить Маше" } } },
      { ok: true, data: { id: "99999999-2222-4333-8444-555555555555", title: "Купить хлеб" } },
      { ok: false, error: "Задача не найдена" },
    ]);

    expect(card.text).toContain("✅ Готово: 2 из 3");
    expect(card.text).toContain("✅ Задача «Позвонить Маше»");
    expect(card.text).toContain("✅ Задача «Купить хлеб» · срок 31.10");
    expect(card.text).toContain("⚠️ Изменить «Демка»: срок: Задача не найдена");
    const found = buttons(card);
    expect(found).toHaveLength(2);
    expect(found[0].callback_data).toBe(taskCallback.back(TASK_ID));
    expect(found[0].text).toContain("Позвонить Маше");
  });

  it("кнопка — только на задачу: заметка, эпик и дописка без кнопки, подзадача ведёт в свою задачу", () => {
    const SUB_PARENT = "22222222-3333-4444-8555-666666666666";
    const NOTE_ID = "33333333-4444-4555-8666-777777777777";
    const card = renderAppliedCard(
      draft({
        calls: [
          { tool: "create_note", args: {}, label: "Заметка «Синергия»" },
          { tool: "append_note", args: {}, label: "Дописать в «Входящие»" },
          { tool: "create_epic", args: {}, label: "Эпик «Отчёт»" },
          { tool: "create_subtask", args: {}, label: "Добавить подзадачу «Бюджет» в «Итмо»" },
          { tool: "update_task", args: {}, label: "Изменить «Слайды»: описание" },
          { tool: "create_epic_task", args: {}, label: "Задача «Б» в эпике «Отчёт»" },
        ],
      }),
      [
        { ok: true, data: { id: NOTE_ID, title: "Синергия" } },
        { ok: true, data: { id: NOTE_ID, title: "Входящие" } },
        { ok: true, data: { id: NOTE_ID, name: "Отчёт" } },
        { ok: true, data: { id: NOTE_ID, taskId: SUB_PARENT, title: "Бюджет" } },
        { ok: true, data: { id: TASK_ID, title: "Слайды" } },
        { ok: true, data: { task: { id: TASK_ID, title: "Б" }, category: { id: NOTE_ID } } },
      ]
    );

    const found = buttons(card);
    expect(found.map((b) => b.callback_data)).toEqual([
      taskCallback.back(SUB_PARENT),
      taskCallback.back(TASK_ID),
      taskCallback.back(TASK_ID),
    ]);
    expect(found[0].text).toContain("Добавить подзадачу");
    expect(found[1].text).toContain("Слайды");
    expect(found[2].text).toContain("Б");
  });

  it("всё провалилось — без кнопок", () => {
    const card = renderAppliedCard(draft({ calls: [draft().calls[0]] }), [
      { ok: false, error: "нет колонки" },
    ]);
    expect(card.text).toContain("Готово: 0 из 1");
    expect(card.replyMarkup).toBeUndefined();
  });
});

describe("отчёт о применении — длина (L6)", () => {
  it("длинный перечень укладывается в бюджет и говорит, сколько не показано", () => {
    const calls = Array.from({ length: 40 }, (_, i) => ({
      tool: "create_task",
      args: {},
      label: `Задача «${"очень длинное название ".repeat(5)}${i}»`,
    }));
    const results = calls.map(() => ({ ok: true as const, data: {} }));
    const card = renderAppliedCard(draft({ calls }), results);

    expect(card.text.length).toBeLessThanOrEqual(4096);
    expect(card.text).toContain("✅ Готово: 40 из 40");
    expect(card.text).toMatch(/… и ещё \d+ пункт/);
  });
});

describe("текст агента на карточке (L1)", () => {
  it("Markdown из ответа модели становится HTML, а не сырыми звёздочками", () => {
    const card = renderDraftCard(
      draft({ agentText: "Не нашёл **ИТМО** — завёл новую <задачу>" }),
      HANDLE
    );
    expect(card.text).toContain("<i>Не нашёл <b>ИТМО</b> — завёл новую &lt;задачу&gt;</i>");
    expect(card.text).not.toContain("**");
  });

  it("пустой текст агента не выводится", () => {
    const card = renderDraftCard(draft({ agentText: "   " }), HANDLE);
    expect(card.text).not.toContain("<i>");
  });

  it("длинный текст агента укорачивается, разметка остаётся целой", () => {
    const card = renderDraftCard(draft({ agentText: "**жирно** ".repeat(200) }), HANDLE);
    const note = card.text.slice(card.text.indexOf("<i>"));
    expect(note.length).toBeLessThanOrEqual(510);
    expect((note.match(/<b>/g) ?? []).length).toBe((note.match(/<\/b>/g) ?? []).length);
    expect(note.endsWith("</i>")).toBe(true);
  });
});

describe("закрытая карточка", () => {
  it("три причины — три разных текста, без кнопок", () => {
    const texts = (["cancelled", "already_sent", "expired"] as const).map((k) => {
      const card = renderClosedCard(k);
      expect(card.replyMarkup).toBeUndefined();
      return card.text;
    });
    expect(new Set(texts).size).toBe(3);
  });
});

describe("payload черновика из базы", () => {
  it("целый черновик разбирается как есть", () => {
    const stored = JSON.parse(JSON.stringify(draft()));
    expect(parseDraftPayload(stored)).toEqual(draft());
  });

  it("испорченный jsonb — null, а не исключение дальше по коду", () => {
    expect(parseDraftPayload(null)).toBeNull();
    expect(parseDraftPayload("строка")).toBeNull();
    expect(parseDraftPayload({ ...draft(), calls: "не массив" })).toBeNull();
    expect(parseDraftPayload({ ...draft(), calls: [{ args: {} }] })).toBeNull();
    expect(parseDraftPayload({ ...draft(), source: { links: [] } })).toBeNull();
    expect(parseDraftPayload({ ...draft(), corrections: [1] })).toBeNull();
    expect(parseDraftPayload({ ...draft(), environmentId: 7 })).toBeNull();
  });
});

describe("ожидание поправки", () => {
  it("payload «Исправить» разбирается, чужие — нет", () => {
    expect(parseDraftFix({ draftHandleId: HANDLE })).toEqual({ draftHandleId: HANDLE });
    expect(parseDraftFix({ taskId: TASK_ID, field: "title" })).toBeNull();
    expect(parseDraftFix({ draftHandleId: "коротко" })).toBeNull();
    expect(parseDraftFix(null)).toBeNull();
  });
});

describe("намерение без содержания: помощники", () => {
  it("findMentionedEpic: регистр, «ё» и пробелы не важны, берётся самое длинное название", () => {
    const epics = [
      { id: "1", name: "ML" },
      { id: "2", name: "ML  модели" },
      { id: "3", name: "Отчётность" },
    ];
    expect(findMentionedEpic("хочу создать новую задачу в блоке ml модели", epics)?.id).toBe("2");
    expect(findMentionedEpic("задачу в отчетность", epics)?.id).toBe("3");
    expect(findMentionedEpic("в блок ml", epics)?.id).toBe("1");
  });

  it("findMentionedEpic: только целым словом, иначе null", () => {
    const epics = [{ id: "1", name: "ИИ" }, { id: "2", name: "Слайды" }];
    expect(findMentionedEpic("надо завести задачу", epics)).toBeNull();
    // «ии» внутри «линии» не считается эпиком.
    expect(findMentionedEpic("хочу добавить подзадачу к задаче про отчёт и линии", epics)).toBeNull();
    expect(findMentionedEpic("задача (слайды)", epics)?.id).toBe("2");
  });

  it("intentQuestion: с эпиком — экранированный HTML, без — общий вопрос", () => {
    expect(intentQuestion({ name: "R&D <лаб>" })).toBe(
      "Какую задачу завести в эпике «R&amp;D &lt;лаб&gt;»? Напишите или надиктуйте."
    );
    expect(intentQuestion(null)).toBe("Что именно записать? Напишите или надиктуйте.");
  });

  it("ожидание «что записать?»: payload туда и обратно, мусор — null", () => {
    expect(parseCaptureContext(captureContextPayload("  хочу задачу  "))).toEqual({
      captureContext: "хочу задачу",
    });
    expect(captureContextPayload("я".repeat(5000)).captureContext).toHaveLength(1000);
    expect(parseCaptureContext({ captureContext: "  " })).toBeNull();
    expect(parseCaptureContext({ captureContext: 1 })).toBeNull();
    expect(parseCaptureContext({ draftHandleId: "DRAFT12345" })).toBeNull();
    expect(parseCaptureContext(null)).toBeNull();
  });

  it("parseDraftPayload: контекст намерения — строкой или никак", () => {
    const draft = {
      source: { text: "пайплайн", links: [], hasUnreadableMedia: false },
      corrections: [],
      calls: [],
      agentText: "",
      environmentId: "env-1",
      createdAt: "2026-10-26T10:00:00.000Z",
    };
    expect(parseDraftPayload({ ...draft, captureContext: "хочу задачу" })).not.toBeNull();
    expect(parseDraftPayload({ ...draft, captureContext: 42 })).toBeNull();
  });
});

describe("слияние черновиков и пустые черновики", () => {
  it("B слит в A, только когда ВСЕ его пункты стали подзадачами", () => {
    expect(draftMerged(B_CALLS, MERGED_CALLS)).toBe(true);
    // Половины мало: остальные пункты пропали бы вместе с закрытым черновиком.
    const half = [...A_CALLS, ...B_CALLS.slice(0, 3).map((c) => subtaskCall(String((c.args as { title: string }).title)))];
    expect(draftMerged(B_CALLS, half)).toBe(false);
    expect(draftMerged(B_CALLS, A_CALLS)).toBe(false);
  });

  it("частичное совпадение заголовка — не слияние", () => {
    const b = [
      { tool: "create_task", args: { title: "Подготовить отчёт" } },
      { tool: "create_task", args: { title: "Позвонить Маше" } },
    ];
    expect(draftMerged(b, [subtaskCall("Подготовить отчёт по продажам"), subtaskCall("Позвонить Маше")])).toBe(false);
    expect(draftMerged(b, [subtaskCall("Подготовить отчёт")])).toBe(false);
    expect(draftMerged(b, [subtaskCall("подготовить отчет."), subtaskCall("Позвонить Маше")])).toBe(true);
  });

  it("сравнение без регистра, «ё», знаков и номера в начале", () => {
    expect(draftMerged([{ tool: "create_task", args: { title: "3. Ёлка: купить!" } }], [subtaskCall("елка купить")])).toBe(true);
    expect(draftMerged([{ tool: "create_task", args: { title: "Ёлка" } }], [subtaskCall("елка купить")])).toBe(false);
    expect(draftMerged([], MERGED_CALLS)).toBe(false);
  });

  it("пустой черновик открытым не считается", () => {
    const base = {
      source: { text: "вот посмотри", links: [], hasUnreadableMedia: false },
      corrections: [],
      agentText: "Что именно записать?",
      environmentId: "env-1",
      createdAt: "2026-10-26T06:04:52.871Z",
    };
    expect(isNonEmptyDraft({ ...base, calls: [] })).toBe(false);
    expect(isNonEmptyDraft({ ...base, calls: A_CALLS })).toBe(true);
    expect(isNonEmptyDraft({ мусор: true })).toBe(false);
  });

  it("ответ без пунктов — без кнопок, HTML экранирован", () => {
    const card = renderEmptyAnswer("Что записать? <b>");
    expect(card.replyMarkup).toBeUndefined();
    expect(card.text).toContain("&lt;b&gt;");
    expect(renderEmptyAnswer("").text).toBe("Ничего не нашёл, что записать");
    expect(renderUnchangedAnswer("Не понял, что поменять").text).toBe("Ничего не поменял: Не понял, что поменять");
  });
});

describe("restatesDraft", () => {
  it("714077403 пересказывает черновик B — да; другой черновик и одна строка — нет", () => {
    expect(restatesDraft(LIVE_403, B_CALLS)).toBe(true);
    expect(restatesDraft(LIVE_403, A_CALLS)).toBe(false);
    expect(restatesDraft("1. Задача «Получить доступ в BCM и согласовать параметры непрерывности»", B_CALLS)).toBe(false);
    expect(restatesDraft("купить хлеб", B_CALLS)).toBe(false);
  });

  it("поиск со словом из черновика и новый список с одним общим пунктом — не пересказ", () => {
    const two = [
      { tool: "create_task", args: { title: "отчёт" }, label: "Задача «отчёт»" },
      { tool: "create_task", args: { title: "Позвонить Маше" }, label: "Задача «Позвонить Маше»" },
    ];
    expect(restatesDraft("найди:\n- отчёт\n- слайды", two)).toBe(false);
    expect(restatesDraft("1. Позвонить Маше\n2. Купить хлеб\n3. Сходить в банк", two)).toBe(false);
    expect(restatesDraft("1. отчёт\n2. Позвонить Маше", two)).toBe(true);
    // Вхождение не считается: «отчёт по продажам» — другой пункт.
    expect(restatesDraft("1. отчёт по продажам\n2. Позвонить Маше по слайдам", two)).toBe(false);
  });
});
