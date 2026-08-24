import { describe, it, expect } from "vitest";
import { TELEGRAM_MESSAGE_LIMIT } from "@/lib/telegram/client";
import {
  MENU_PAGE_SIZE,
  NOOP_CALLBACK,
  SEARCH_CARD_SIZE,
  dueNote,
  monthKey,
  parseTaskCallback,
  renderAskInput,
  renderCalendar,
  renderColumnMenu,
  renderDeleteConfirm,
  renderDeletedCard,
  renderDueMenu,
  renderEmptySearch,
  renderEnvironmentMenu,
  renderEpicMenu,
  renderPriorityMenu,
  renderSearchCard,
  renderTaskCard,
  resolveDuePreset,
  shiftMonth,
  taskCallback,
  type InlineButton,
  type Keyboard,
  type TaskCard,
  type TaskCardData,
} from "@/lib/telegram/task-card";

/*
 * Граничные данные: длиннее и «тяжелее» в байтах уже не бывает.
 *
 * UUID из одних f — максимум для упаковки; кириллица в названиях — по два
 * байта на символ в UTF-8, а лимит Telegram считается именно в байтах.
 */
const MAX_ID = "ffffffff-ffff-ffff-ffff-ffffffffffff";
const LONG_TITLE = "Заполнить пилот по вэду и свести цены и ККУ по контрагентам ".repeat(8);
const LONG_NAME = "Проект «Стратегия и трансформация» — второй квартал ".repeat(4);

const TASK: TaskCardData = {
  id: MAX_ID,
  title: LONG_TITLE,
  description: LONG_TITLE,
  priority: "urgent",
  plannedDate: "2027-12-31",
  completedAt: null,
  createdAt: new Date("2026-08-01T09:00:00Z"),
  column: { id: MAX_ID, title: LONG_NAME },
  environment: { id: MAX_ID, name: LONG_NAME },
  epicName: LONG_NAME,
};

const TODAY = new Date("2026-08-25T12:00:00Z"); // вторник

/** Много вариантов с максимальными id: подменю обязано разложиться на страницы. */
const MANY = Array.from({ length: 40 }, (_, i) => ({
  id: `ffffffff-ffff-ffff-ffff-${String(i).padStart(12, "f")}`,
  name: `${LONG_NAME} ${i}`,
}));

const BOARD_URL = "https://constance.example/?task=" + MAX_ID;

/**
 * Все клавиатуры, какие бот вообще умеет рисовать, с граничными данными.
 * Перебор именно по рендерам, а не по списку примеров: кнопка, добавленная в
 * карточку, попадает в проверку сама, без правки теста.
 */
function everyCard(): { where: string; card: TaskCard }[] {
  const options = { today: TODAY, boardUrl: BOARD_URL, note: "✓ Готово" };
  const pages = Math.ceil(MANY.length / MENU_PAGE_SIZE);

  const cards: { where: string; card: TaskCard }[] = [
    { where: "карточка задачи", card: renderTaskCard(TASK, options) },
    { where: "карточка закрытой", card: renderTaskCard({ ...TASK, completedAt: TODAY }, options) },
    { where: "карточка без ссылки", card: renderTaskCard(TASK, { today: TODAY }) },
    { where: "подменю срока", card: renderDueMenu(TASK, options) },
    { where: "подменю приоритета", card: renderPriorityMenu(TASK, options) },
    { where: "подтверждение удаления", card: renderDeleteConfirm(TASK, options) },
    { where: "карточка удалённой", card: renderDeletedCard(LONG_TITLE) },
    { where: "вопрос про название", card: renderAskInput(TASK, "title", options) },
    { where: "вопрос про описание", card: renderAskInput(TASK, "description", options) },
    { where: "вопрос про эпик", card: renderAskInput(TASK, "epic", options) },
  ];

  // Календарь: каждый месяц года — разное число дней и разные пустые клетки.
  for (let month = 1; month <= 12; month++) {
    const key = `2027-${String(month).padStart(2, "0")}`;
    cards.push({ where: `календарь ${key}`, card: renderCalendar(TASK, key, options) });
  }

  for (let page = 1; page <= pages; page++) {
    cards.push({ where: `эпики, стр. ${page}`, card: renderEpicMenu(TASK, MANY, page, options) });
    cards.push({
      where: `колонки, стр. ${page}`,
      card: renderColumnMenu(
        TASK,
        MANY.map((o) => ({ id: o.id, title: o.name })),
        page,
        options
      ),
    });
    cards.push({
      where: `среды, стр. ${page}`,
      card: renderEnvironmentMenu(TASK, MANY, page, options),
    });
  }

  cards.push({ where: "эпики пустые", card: renderEpicMenu(TASK, [], 1, options) });

  const hits = MANY.slice(0, SEARCH_CARD_SIZE).map((option) => ({
    id: option.id,
    title: option.name,
    priority: "urgent" as const,
    completedAt: null,
    createdAt: new Date("2026-08-01T09:00:00Z"),
    column: { title: LONG_NAME },
    environment: { name: LONG_NAME },
  }));

  cards.push({
    where: "выдача поиска",
    card: renderSearchCard(hits, {
      query: LONG_TITLE,
      total: 99,
      page: 1,
      handleId: "AbCdEf-_09",
      boardUrl: BOARD_URL,
      now: TODAY,
    }),
  });
  cards.push({
    where: "выдача поиска, дальняя страница",
    card: renderSearchCard(hits, {
      query: LONG_TITLE,
      total: 9999,
      page: 999,
      handleId: "AbCdEf-_09",
      now: TODAY,
    }),
  });
  cards.push({
    where: "прошедшее время",
    card: renderSearchCard(hits, {
      query: LONG_TITLE,
      total: 3,
      page: 1,
      handleId: "AbCdEf-_09",
      looksDone: true,
      createAnywayCallback: "cap:astask:9007199254740991",
      now: TODAY,
    }),
  });
  cards.push({
    where: "ничего не нашлось",
    card: renderEmptySearch({
      query: LONG_TITLE,
      createAnywayCallback: "cap:astask:9007199254740991",
      boardUrl: BOARD_URL,
    }),
  });

  return cards;
}

function buttons(keyboard: Keyboard | undefined): InlineButton[] {
  return keyboard?.inline_keyboard.flat() ?? [];
}

describe("callback_data укладывается в лимит Telegram", () => {
  const collected = everyCard().flatMap(({ where, card }) =>
    buttons(card.replyMarkup).map((button) => ({ where, button }))
  );

  it("проверяемых кнопок действительно много — перебор не пустой", () => {
    // Страховка от «зелёного» теста, который ничего не обошёл.
    expect(collected.length).toBeGreaterThan(300);
  });

  it("каждая кнопка укладывается в 1–64 байта", () => {
    const tooLong = collected
      .filter((entry) => "callback_data" in entry.button)
      .map((entry) => ({
        where: entry.where,
        data: (entry.button as { callback_data: string }).callback_data,
      }))
      .map((entry) => ({ ...entry, bytes: Buffer.byteLength(entry.data, "utf8") }))
      .filter((entry) => entry.bytes < 1 || entry.bytes > 64);

    expect(tooLong).toEqual([]);
  });

  it("каждая собранная кнопка разбирается обратно", () => {
    // Лимит соблюсти можно и обрезкой — тогда код влезет, но перестанет
    // читаться. Проверяем, что кнопка осмысленна, а не просто коротка.
    const foreign = ["noop", "cap:astask:9007199254740991"];
    const unparsed = collected
      .filter((entry) => "callback_data" in entry.button)
      .map((entry) => ({
        where: entry.where,
        data: (entry.button as { callback_data: string }).callback_data,
      }))
      .filter((entry) => !foreign.includes(entry.data))
      .filter((entry) => parseTaskCallback(entry.data) === null);

    expect(unparsed).toEqual([]);
  });

  it("у кнопок-ссылок настоящий URL, а не callback_data", () => {
    const urls = collected
      .filter((entry) => "url" in entry.button)
      .map((entry) => (entry.button as { url: string }).url);

    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) expect(() => new URL(url)).not.toThrow();
  });

  it("текст любой карточки влезает в сообщение Telegram", () => {
    for (const { where, card } of everyCard()) {
      expect(card.text.length, where).toBeLessThanOrEqual(TELEGRAM_MESSAGE_LIMIT);
    }
  });
});

describe("разбор нажатий", () => {
  it("код кнопки разбирается в то же намерение, что и собирали", () => {
    expect(parseTaskCallback(taskCallback.done(MAX_ID))).toEqual({
      kind: "done",
      taskId: MAX_ID,
    });
    expect(parseTaskCallback(taskCallback.columnSet(MAX_ID, MAX_ID))).toEqual({
      kind: "column-set",
      taskId: MAX_ID,
      columnId: MAX_ID,
    });
    expect(parseTaskCallback(taskCallback.duePreset(MAX_ID, "friday"))).toEqual({
      kind: "due-preset",
      taskId: MAX_ID,
      preset: "friday",
    });
    expect(parseTaskCallback(taskCallback.dueCalendar(MAX_ID, "2026-08"))).toEqual({
      kind: "due-calendar",
      taskId: MAX_ID,
      month: "2026-08",
    });
    expect(parseTaskCallback(taskCallback.page(MAX_ID, "epic", 3))).toEqual({
      kind: "page",
      taskId: MAX_ID,
      menu: "epic",
      page: 3,
    });
    expect(parseTaskCallback(taskCallback.searchPage("AbCdEf-_09", 2))).toEqual({
      kind: "search-page",
      handleId: "AbCdEf-_09",
      page: 2,
    });
  });

  it("вопрос об удалении и само удаление — разные коды", () => {
    // Один код на «спросить» и «удалить» означал бы удаление в один тап.
    expect(taskCallback.removeAsk(MAX_ID)).not.toBe(taskCallback.removeConfirm(MAX_ID));
    expect(parseTaskCallback(taskCallback.removeAsk(MAX_ID))?.kind).toBe("remove-ask");
    expect(parseTaskCallback(taskCallback.removeConfirm(MAX_ID))?.kind).toBe("remove-confirm");
    expect(parseTaskCallback(taskCallback.removeCancel(MAX_ID))?.kind).toBe("remove-cancel");
  });

  it("чужое и битое не разбирается", () => {
    expect(parseTaskCallback(undefined)).toBeNull();
    expect(parseTaskCallback("")).toBeNull();
    expect(parseTaskCallback("cap:retry:42")).toBeNull();
    expect(parseTaskCallback("t:dn:не-упакованный-id")).toBeNull();
    expect(parseTaskCallback("t:zz:" + taskCallback.done(MAX_ID).slice(5))).toBeNull();
    expect(parseTaskCallback("t:du:" + taskCallback.done(MAX_ID).slice(5) + ":2026-13-45x")).toBeNull();
    expect(parseTaskCallback("t:ep:" + taskCallback.done(MAX_ID).slice(5) + ":p:0")).toBeNull();
    expect(parseTaskCallback("s:pg:короткий:2")).toBeNull();
  });

  it("месяц и дата разбираются по диапазону, а не по одной форме", () => {
    const id = taskCallback.done(MAX_ID).slice(5);

    // Тринадцатый месяц дал бы в шапке «undefined 2026», нулевой год — 1901.
    expect(parseTaskCallback(`t:du:${id}:cal:2026-13`)).toBeNull();
    expect(parseTaskCallback(`t:du:${id}:cal:2026-00`)).toBeNull();
    expect(parseTaskCallback(`t:du:${id}:cal:0001-01`)).toBeNull();
    expect(parseTaskCallback(`t:du:${id}:2026-13-01`)).toBeNull();
    expect(parseTaskCallback(`t:du:${id}:2026-08-32`)).toBeNull();

    // Настоящий месяц и настоящая дата разбираются по-прежнему: проверка
    // диапазона не должна заодно отрезать рабочие кнопки.
    expect(parseTaskCallback(`t:du:${id}:cal:2026-12`)).toMatchObject({
      kind: "due-calendar",
      month: "2026-12",
    });
    expect(parseTaskCallback(`t:du:${id}:2026-12-31`)).toMatchObject({
      kind: "due-date",
      date: "2026-12-31",
    });
  });

  it("заглушка календаря опознаётся и ничего не значит", () => {
    expect(parseTaskCallback(NOOP_CALLBACK)).toEqual({ kind: "noop" });
  });
});

describe("даты", () => {
  it("«Пт» и «Пн» дают строго будущие и разные дни", () => {
    // Иначе в пятницу кнопка «Пт» повторяла бы соседнюю «Сегодня».
    const friday = new Date("2026-08-28T12:00:00Z");
    expect(resolveDuePreset("friday", friday)).toBe("2026-09-04");
    expect(resolveDuePreset("monday", friday)).toBe("2026-08-31");

    const monday = new Date("2026-08-31T12:00:00Z");
    expect(resolveDuePreset("monday", monday)).toBe("2026-09-07");
    expect(resolveDuePreset("friday", monday)).toBe("2026-09-04");
  });

  it("в любой день недели «Пт» и «Пн» — разные будущие дни, а не сегодня", () => {
    // «Завтра» может совпасть с «Пт» (в четверг) или с «Пн» (в воскресенье) —
    // это ровно те же сутки, и спорить тут не о чем. А вот «Пт» = «Пн» или
    // «Пт» = сегодня означали бы кнопку, которая не делает ничего.
    for (let day = 0; day < 14; day++) {
      const today = new Date(Date.UTC(2026, 7, 20 + day));
      const iso = today.toISOString().slice(0, 10);
      const friday = resolveDuePreset("friday", today)!;
      const monday = resolveDuePreset("monday", today)!;

      expect(friday, iso).not.toBe(monday);
      expect(friday > iso, `${iso} → пт ${friday}`).toBe(true);
      expect(monday > iso, `${iso} → пн ${monday}`).toBe(true);
      expect(new Date(`${friday}T00:00:00Z`).getUTCDay()).toBe(5);
      expect(new Date(`${monday}T00:00:00Z`).getUTCDay()).toBe(1);
    }
  });

  it("«Сегодня» и «Завтра» считаются от переданного дня", () => {
    expect(resolveDuePreset("today", TODAY)).toBe("2026-08-25");
    expect(resolveDuePreset("tomorrow", TODAY)).toBe("2026-08-26");
  });

  it("«Убрать срок» — это null, а не сегодняшняя дата", () => {
    expect(resolveDuePreset("clear", TODAY)).toBeNull();
    expect(dueNote(null)).toContain("убран");
  });

  it("подпись называет дату по-русски", () => {
    expect(dueNote("2026-08-29")).toBe("✓ Срок 29 августа");
  });

  it("перелистывание месяцев переходит через год", () => {
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(monthKey(TODAY)).toBe("2026-08");
  });
});

describe("календарь", () => {
  it("дни идут по неделям и ни один не пропущен", () => {
    const card = renderCalendar(TASK, "2026-02", { today: TODAY });
    const days = buttons(card.replyMarkup)
      .filter((b) => "callback_data" in b)
      .map((b) => parseTaskCallback((b as { callback_data: string }).callback_data))
      .filter((action) => action?.kind === "due-date")
      .map((action) => (action as { date: string }).date);

    expect(days[0]).toBe("2026-02-01");
    expect(days.at(-1)).toBe("2026-02-28");
    expect(days).toHaveLength(28);
  });

  it("сетка выровнена по понедельникам", () => {
    // 1 августа 2026 — суббота: перед ней должно быть пять пустых клеток.
    const card = renderCalendar(TASK, "2026-08", { today: TODAY });
    const rows = card.replyMarkup!.inline_keyboard;
    const week = rows[2];

    expect(week).toHaveLength(7);
    expect(week.slice(0, 5).every((b) => "callback_data" in b && b.callback_data === NOOP_CALLBACK)).toBe(true);
    expect((week[5] as { callback_data: string }).callback_data).toBe(
      taskCallback.dueDate(TASK.id, "2026-08-01")
    );
  });
});

describe("карточка задачи", () => {
  it("закрытая задача помечается галочкой, а «Готово» меняется на возврат", () => {
    const open = renderTaskCard(TASK, { today: TODAY });
    const done = renderTaskCard({ ...TASK, completedAt: TODAY }, { today: TODAY });

    expect(open.text.startsWith("🔴")).toBe(true);
    expect(done.text.startsWith("✅")).toBe(true);

    const openCodes = buttons(open.replyMarkup).map((b) => "callback_data" in b && b.callback_data);
    const doneCodes = buttons(done.replyMarkup).map((b) => "callback_data" in b && b.callback_data);

    expect(openCodes).toContain(taskCallback.done(TASK.id));
    expect(doneCodes).not.toContain(taskCallback.done(TASK.id));
    expect(doneCodes).toContain(taskCallback.undone(TASK.id));
  });

  it("в карточке есть весь набор из спеки", () => {
    const card = renderTaskCard(TASK, { today: TODAY, boardUrl: BOARD_URL });
    const labels = buttons(card.replyMarkup).map((b) => b.text);

    for (const label of ["Срок", "Эпик", "Приоритет", "Колонка", "Название", "Описание", "Среда"]) {
      expect(labels).toContain(label);
    }
    expect(labels.some((l) => l.includes("Готово"))).toBe(true);
    expect(labels.some((l) => l.includes("Удалить"))).toBe(true);
    expect(labels).toContain("Открыть на доске");
  });

  it("без адреса приложения кнопки-ссылки нет", () => {
    const card = renderTaskCard(TASK, { today: TODAY });
    expect(buttons(card.replyMarkup).some((b) => "url" in b)).toBe(false);
  });

  it("разметка в названии экранируется", () => {
    const card = renderTaskCard(
      { ...TASK, title: "Цены & <ККУ>", description: null, epicName: null },
      { today: TODAY }
    );
    expect(card.text).toContain("Цены &amp; &lt;ККУ&gt;");
    expect(card.text).not.toContain("<ККУ>");
  });

  it("подпись о результате идёт первой строкой", () => {
    const card = renderTaskCard(TASK, { today: TODAY, note: "✓ Срок 29 августа" });
    expect(card.text.split("\n")[0]).toBe("✓ Срок 29 августа");
  });
});

describe("подменю", () => {
  const submenus: [string, TaskCard][] = [
    ["срок", renderDueMenu(TASK, { today: TODAY })],
    ["календарь", renderCalendar(TASK, "2026-08", { today: TODAY })],
    ["эпик", renderEpicMenu(TASK, MANY, 1, { today: TODAY })],
    ["приоритет", renderPriorityMenu(TASK, { today: TODAY })],
    ["колонка", renderColumnMenu(TASK, [{ id: MAX_ID, title: "Бэклог" }], 1, { today: TODAY })],
    ["среда", renderEnvironmentMenu(TASK, MANY, 1, { today: TODAY })],
    ["название", renderAskInput(TASK, "title", { today: TODAY })],
  ];

  it("у каждого подменю есть «← Назад»", () => {
    for (const [name, card] of submenus) {
      const codes = buttons(card.replyMarkup).map((b) => ("callback_data" in b ? b.callback_data : ""));
      expect(codes, name).toContain(taskCallback.back(TASK.id));
    }
  });

  it("список режется на страницы по шесть и предлагает «Ещё»", () => {
    const card = renderEpicMenu(TASK, MANY, 1, { today: TODAY });
    const codes = buttons(card.replyMarkup).map((b) => ("callback_data" in b ? b.callback_data : ""));
    const chosen = codes.filter((code) => parseTaskCallback(code)?.kind === "epic-set");

    expect(chosen).toHaveLength(MENU_PAGE_SIZE);
    expect(codes).toContain(taskCallback.page(TASK.id, "epic", 2));
    expect(buttons(card.replyMarkup).find((b) => b.text.startsWith("Ещё"))?.text).toBe(
      `Ещё ${MANY.length - MENU_PAGE_SIZE}`
    );
  });

  it("на последней странице «Ещё» не предлагается", () => {
    const lastPage = Math.ceil(MANY.length / MENU_PAGE_SIZE);
    const card = renderEpicMenu(TASK, MANY, lastPage, { today: TODAY });
    expect(buttons(card.replyMarkup).some((b) => b.text.startsWith("Ещё"))).toBe(false);
  });
});

describe("выдача поиска", () => {
  const item = (id: string, title: string, completedAt: Date | null = null) => ({
    id,
    title,
    priority: "normal" as const,
    completedAt,
    createdAt: new Date("2026-08-23T09:00:00Z"),
    column: { title: "Бэклог" },
    environment: { name: "Работа" },
  });

  const three = [
    item(MANY[0].id, "ответить по вэду"),
    item(MANY[1].id, "Заполнить пилот по вэду"),
    item(MANY[2].id, "Свести ККУ"),
  ];

  it("на каждую найденную задачу — своя кнопка с названием", () => {
    const card = renderSearchCard(three, { query: "вэду", total: 3, page: 1, now: TODAY });
    const labels = buttons(card.replyMarkup).map((b) => b.text);

    expect(labels).toContain("✓ ответить по вэду");
    expect(labels).toContain("✓ Заполнить пилот по вэду");
    expect(card.text).toContain("Нашёл 3");
  });

  it("упёршийся в потолок счётчик пишется «30+», а не точным числом", () => {
    const card = renderSearchCard(three, {
      query: "вэду",
      total: 30,
      capped: true,
      page: 1,
      now: TODAY,
    });

    expect(card.text).toContain("Нашёл 30+");

    // Без потолка то же число остаётся точным: «30+» не должно появляться там,
    // где мы действительно сосчитали всё.
    const exact = renderSearchCard(three, { query: "вэду", total: 30, page: 1, now: TODAY });
    expect(exact.text).toContain("Нашёл 30 ");
    expect(exact.text).not.toContain("30+");
  });

  it("больше трёх не показывает и предлагает «Ещё N»", () => {
    const many = [...three, item(MANY[3].id, "четвёртая"), item(MANY[4].id, "пятая")];
    const card = renderSearchCard(many, {
      query: "вэду",
      total: 7,
      page: 1,
      handleId: "AbCdEf-_09",
      now: TODAY,
    });

    const done = buttons(card.replyMarkup).filter(
      (b) => "callback_data" in b && parseTaskCallback(b.callback_data)?.kind === "done"
    );
    expect(done).toHaveLength(SEARCH_CARD_SIZE);
    expect(card.text).toContain("показываю 3");
    expect(buttons(card.replyMarkup).find((b) => b.text.startsWith("Ещё"))?.text).toBe("Ещё 4");
  });

  it("у закрытой задачи кнопки закрытия нет — нажимать второй раз нечего", () => {
    const card = renderSearchCard([item(MANY[0].id, "ответить по вэду", TODAY)], {
      query: "вэду",
      total: 1,
      page: 1,
      now: TODAY,
    });

    expect(card.text).toContain("✅");
    expect(buttons(card.replyMarkup).some((b) => b.text.startsWith("✓"))).toBe(false);
  });

  it("прошедшее время меняет заголовок и добавляет отказ", () => {
    const card = renderSearchCard(three, {
      query: "вэду",
      total: 3,
      page: 1,
      looksDone: true,
      createAnywayCallback: "cap:astask:42",
      now: TODAY,
    });

    expect(card.text).toContain("уже сделана");
    expect(buttons(card.replyMarkup).map((b) => b.text)).toContain("Нет, это новая задача");
  });

  it("пустая выдача не выдумывает задач", () => {
    const card = renderEmptySearch({ query: "вэду" });
    expect(card.text).toContain("Ничего не нашёл");
    expect(card.replyMarkup).toBeUndefined();
  });
});

/*
 * Обрезка перебором смещений — тем же приёмом, что и в карточке захвата.
 *
 * Пара примеров здесь ничего не доказывает: удачно выбранная длина проходит и
 * на наивном разрезе. Ошибка живёт ровно в одной точке — когда предел
 * приходится на середину суррогатной пары или сущности «&amp;», а это одно
 * смещение из сотни.
 */

/** Одинокая половина суррогатной пары: для Telegram это не UTF-8 → 400. */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
/** «&», не начинающая сущность: разрезанная пополам «&amp;» — битая разметка. */
const BROKEN_ENTITY = /&(?!amp;|lt;|gt;)/;
/** Тег, разрезанный пополам. */
const BROKEN_TAG = /<[^>]*$/;

/** Куда в карточке задачи попадает пользовательский текст. */
const SLOTS: Record<string, (text: string) => TaskCard> = {
  "заголовок задачи": (text) => renderTaskCard({ ...TASK, title: text }, { today: TODAY }),
  описание: (text) => renderTaskCard({ ...TASK, description: text }, { today: TODAY }),
  "имя проекта и колонки": (text) =>
    renderTaskCard(
      { ...TASK, environment: { id: MAX_ID, name: text }, column: { id: MAX_ID, title: text } },
      { today: TODAY }
    ),
  "имя эпика": (text) => renderTaskCard({ ...TASK, epicName: text }, { today: TODAY }),
  "подпись о результате": (text) => renderTaskCard(TASK, { today: TODAY, note: text }),
  "заголовок в подтверждении удаления": (text) =>
    renderDeleteConfirm({ ...TASK, title: text }, { today: TODAY }),
  "вариант в подменю": (text) =>
    renderEpicMenu(TASK, [{ id: MAX_ID, name: text }], 1, { today: TODAY }),
  "заголовок в выдаче поиска": (text) =>
    renderSearchCard(
      [
        {
          id: MAX_ID,
          title: text,
          priority: "normal" as const,
          completedAt: null,
          createdAt: new Date("2026-08-23T09:00:00Z"),
          column: { title: text },
          environment: { name: text },
        },
      ],
      { query: text, total: 1, page: 1, now: TODAY }
    ),
  "запрос без находок": (text) => renderEmptySearch({ query: text }),
};

/** Виды текста, на которых обрезка ломается по-разному. */
const SHAPES: Record<string, (offset: number) => string> = {
  "эмодзи посреди текста": (offset) => `${"я".repeat(offset)}😀${"я".repeat(400)}`,
  "сплошные эмодзи": (offset) => `${"😀".repeat(offset)}!${"😀".repeat(200)}`,
  "эмодзи вперемешку с амперсандами": (offset) => `${"&😀".repeat(offset)}😀&${"я".repeat(400)}`,
  "сплошные амперсанды": (offset) => `${"&".repeat(offset)}${"😀".repeat(200)}`,
  "разметка в тексте пользователя": (offset) => `${"<b>😀".repeat(offset)}<i>${"я".repeat(400)}`,
};

describe("карточка задачи — обрезка перебором смещений", () => {
  for (const [slot, render] of Object.entries(SLOTS)) {
    it(`${slot}: ни битых символов, ни битой разметки, ни выхода за лимит`, () => {
      // Пределы слотов — от 40 (кнопка) до 300 (описание); перебор идёт с
      // запасом по обе стороны, чтобы тест не зависел от конкретных чисел.
      for (const [shape, build] of Object.entries(SHAPES)) {
        for (let offset = 0; offset <= 330; offset++) {
          const where = `${slot} · ${shape} · смещение ${offset}`;
          const card = render(build(offset));

          expect(card.text.length, where).toBeLessThanOrEqual(TELEGRAM_MESSAGE_LIMIT);
          expect(card.text, where).not.toMatch(LONE_SURROGATE);
          expect(card.text, where).not.toMatch(BROKEN_ENTITY);
          expect(card.text, where).not.toMatch(BROKEN_TAG);

          // Надпись на кнопке — не HTML, экранировать её нечем и незачем;
          // но половина суррогатной пары не UTF-8 и в ней.
          for (const button of buttons(card.replyMarkup)) {
            expect(button.text, `${where} · кнопка`).not.toMatch(LONE_SURROGATE);
            expect(button.text.length, `${where} · кнопка`).toBeGreaterThan(0);
          }
        }
      }
    });
  }

  it("пользовательская строка меряется после экранирования, а не до", () => {
    // escapeHtml растит «&» впятеро: предел, посчитанный по сырому тексту,
    // длину сообщения не ограничивает вовсе.
    const plain = renderTaskCard({ ...TASK, title: "я".repeat(1000) }, { today: TODAY });
    const amps = renderTaskCard({ ...TASK, title: "&".repeat(1000) }, { today: TODAY });

    expect(amps.text.length).toBeLessThanOrEqual(plain.text.length);
  });
});
