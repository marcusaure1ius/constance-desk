import { describe, it, expect, vi } from "vitest";
import {
  bareConfirm,
  CONFIRM_INSTRUCTIONS,
  decideRoute,
  INTENT_CRITERIA,
  INTENT_INSTRUCTIONS,
  ROUTE_CRITERIA,
} from "@/lib/telegram/route";
import type { askJev } from "@/lib/llm/jev";
import { LlmError } from "@/lib/llm/client";
import type { Inbound } from "@/lib/telegram/inbound";

type Ask = typeof askJev;

function inbound(over: Partial<Inbound> = {}): Inbound {
  return { text: "позвонить Маше", links: [], hasUnreadableMedia: false, ...over };
}

function jevReturns(
  choice: string,
  confidence: number,
  noul?: number,
  confirm?: number
): ReturnType<typeof vi.fn> {
  return vi.fn().mockResolvedValue({
    answers: {
      route: { type: "choice", choice, confidence, probabilities: { [choice]: confidence } },
      ...(noul === undefined ? {} : { correction: { type: "noul", noul } }),
      ...(confirm === undefined ? {} : { confirm: { type: "noul", noul: confirm } }),
    },
    latencyMs: 400,
  });
}

const DRAFT = { summary: "1. Позвонить Маше\n2. Купить хлеб", createdAt: new Date() };

describe("decideRoute", () => {
  it("пост из канала — forward без вызова Jev", async () => {
    const ask = vi.fn();
    const d = await decideRoute(
      inbound({ forward: { kind: "channel", from: "Хабр" } }),
      null,
      { askJev: ask as unknown as Ask }
    );
    expect(d).toMatchObject({ route: "forward", source: "rule" });
    expect(ask).not.toHaveBeenCalled();
  });

  it("пересылка от человека — capture без вызова Jev", async () => {
    const ask = vi.fn();
    const d = await decideRoute(
      inbound({ forward: { kind: "person", from: "Маша" } }),
      DRAFT,
      { askJev: ask as unknown as Ask }
    );
    expect(d).toEqual({ route: "capture", correction: false, source: "rule" });
    expect(ask).not.toHaveBeenCalled();
  });

  it("уверенный ответ принимается как есть", async () => {
    const ask = jevReturns("ask_board", 0.93);
    const d = await decideRoute(inbound({ text: "что на сегодня?" }), null, {
      askJev: ask as unknown as Ask,
    });
    expect(d).toMatchObject({
      route: "ask_board",
      correction: false,
      source: "jev",
      confidence: 0.93,
      latencyMs: 400,
    });
  });

  it("уверенность 0.52 — запасной capture с low_confidence", async () => {
    const ask = jevReturns("find_task", 0.52);
    const d = await decideRoute(inbound({ text: "я сделал отчёт" }), null, {
      askJev: ask as unknown as Ask,
    });
    expect(d).toMatchObject({
      route: "capture",
      source: "fallback",
      reason: "low_confidence",
    });
  });

  it("без черновика вопрос correction не задаётся", async () => {
    const ask = jevReturns("capture", 0.9);
    await decideRoute(inbound(), null, { askJev: ask as unknown as Ask });
    const questions = ask.mock.calls[0][0].questions;
    expect(Object.keys(questions)).toEqual(["route", "intent"]);
    expect(Object.keys(questions.route.criteria)).toEqual(Object.keys(ROUTE_CRITERIA));
    expect(ask.mock.calls[0][0].state).toEqual({ message: "позвонить Маше", links: [] });
  });

  it("с черновиком спрашивает correction и кладёт его в state", async () => {
    const ask = jevReturns("capture", 0.9, 0.8);
    const d = await decideRoute(inbound({ text: "нет, вторую не надо" }), DRAFT, {
      askJev: ask as unknown as Ask,
    });
    expect(d.correction).toBe(true);
    expect(Object.keys(ask.mock.calls[0][0].questions)).toEqual(["route", "intent", "correction", "confirm"]);
    expect(ask.mock.calls[0][0].state.draft).toBe(DRAFT.summary);
  });

  it("noul ниже 0.7 — не поправка", async () => {
    const ask = jevReturns("capture", 0.9, 0.69);
    const d = await decideRoute(inbound(), DRAFT, { askJev: ask as unknown as Ask });
    expect(d.correction).toBe(false);
  });

  it("при низкой уверенности correction всё равно берётся из ответа", async () => {
    const ask = jevReturns("smalltalk", 0.4, 0.9);
    const d = await decideRoute(inbound(), DRAFT, { askJev: ask as unknown as Ask });
    expect(d).toMatchObject({ route: "capture", correction: true, reason: "low_confidence" });
  });

  it("текст в state обрезается до 4000 знаков", async () => {
    const ask = jevReturns("capture", 0.9);
    await decideRoute(inbound({ text: "а".repeat(5000) }), null, {
      askJev: ask as unknown as Ask,
    });
    expect(ask.mock.calls[0][0].state.message).toHaveLength(4000);
  });

  it.each([
    ["timeout", new Error("Jev: timeout 1500 мс"), "timeout"],
    ["http", new LlmError("openrouter", 429, "x"), "http_429"],
    ["network", new TypeError("fetch failed"), "network"],
    ["bad_response", new Error("Jev: в ответе нет answers.route"), "bad_response"],
  ])("ошибка %s — fallback capture с причиной", async (_name, error, reason) => {
    const ask = vi.fn().mockRejectedValue(error);
    const d = await decideRoute(inbound(), DRAFT, { askJev: ask as unknown as Ask });
    expect(d).toEqual({ route: "capture", correction: false, source: "fallback", reason });
  });

  it("в state — сводка и возраст черновика в минутах", async () => {
    const ask = jevReturns("capture", 0.9, 0.8);
    const now = new Date("2026-10-24T12:00:00Z");
    await decideRoute(
      inbound(),
      { summary: DRAFT.summary, createdAt: new Date("2026-10-24T11:35:30Z") },
      { askJev: ask as unknown as Ask, now: () => now }
    );
    expect(ask.mock.calls[0][0].state).toMatchObject({ draft: DRAFT.summary, draft_age_minutes: 24 });
    expect(ask.mock.calls[0][0].questions.correction.instructions).toContain("draft_age_minutes");
  });

  it("черновик старше часа поправкой не считается и Jev о нём не спрашивают", async () => {
    const ask = jevReturns("capture", 0.9, 0.95);
    const now = new Date("2026-10-24T12:00:00Z");
    const d = await decideRoute(
      inbound({ text: "нет, вторую не надо" }),
      { summary: DRAFT.summary, createdAt: new Date("2026-10-24T11:00:00Z") },
      { askJev: ask as unknown as Ask, now: () => now }
    );
    expect(d.correction).toBe(false);
    expect(Object.keys(ask.mock.calls[0][0].questions)).toEqual(["route", "intent"]);
    expect(ask.mock.calls[0][0].state).not.toHaveProperty("draft");
  });

  it.each([
    ["ask_board", "что на сегодня?"],
    ["find_task", "закрой задачу про слайды"],
    ["smalltalk", "спасибо"],
  ])("уверенный %s при открытом черновике — не поправка, даже если noul высокий", async (route, text) => {
    const ask = jevReturns(route, 0.9, 0.95);
    const d = await decideRoute(inbound({ text }), DRAFT, { askJev: ask as unknown as Ask });
    expect(d).toMatchObject({ route, correction: false, source: "jev" });
  });

  it.each(["capture", "forward"])("уверенный %s с высоким noul — поправка", async (route) => {
    const ask = jevReturns(route, 0.9, 0.95);
    const d = await decideRoute(inbound(), DRAFT, { askJev: ask as unknown as Ask });
    expect(d).toMatchObject({ route, correction: true });
  });

  describe("«отправляй» при открытом черновике", () => {
    it("confirm ≥ 0.7 — confirm, не поправка, даже при высоком noul поправки", async () => {
      const ask = jevReturns("capture", 0.9, 0.9, 0.85);
      const d = await decideRoute(inbound({ text: "да, записывай" }), DRAFT, {
        askJev: ask as unknown as Ask,
      });
      expect(d).toMatchObject({ route: "capture", correction: false, confirm: true, source: "jev" });
      expect(ask.mock.calls[0][0].questions.confirm).toEqual({
        type: "noul",
        instructions: CONFIRM_INSTRUCTIONS,
      });
    });

    it.each(["find_task", "smalltalk", "ask_board"])(
      "confirm важнее маршрута %s: «отправляй» Jev может счесть чем угодно",
      async (route) => {
        const ask = jevReturns(route, 0.9, 0.1, 0.8);
        const d = await decideRoute(inbound({ text: "ок, на доску" }), DRAFT, {
          askJev: ask as unknown as Ask,
        });
        expect(d.confirm).toBe(true);
      }
    );

    it("confirm ниже 0.7 — обычный разбор, поля confirm нет", async () => {
      const ask = jevReturns("capture", 0.9, 0.9, 0.69);
      const d = await decideRoute(inbound(), DRAFT, { askJev: ask as unknown as Ask });
      expect(d).toMatchObject({ route: "capture", correction: true });
      expect(d).not.toHaveProperty("confirm");
    });

    it("без черновика и при черновике старше часа confirm не спрашивается", async () => {
      const ask = jevReturns("capture", 0.9, undefined, 0.99);
      const none = await decideRoute(inbound({ text: "отправляй" }), null, {
        askJev: ask as unknown as Ask,
      });
      const now = new Date("2026-10-24T12:00:00Z");
      const old = await decideRoute(
        inbound({ text: "отправляй" }),
        { summary: DRAFT.summary, createdAt: new Date("2026-10-24T10:00:00Z") },
        { askJev: ask as unknown as Ask, now: () => now }
      );
      for (const call of ask.mock.calls) expect(call[0].questions).not.toHaveProperty("confirm");
      expect(none).not.toHaveProperty("confirm");
      expect(old).not.toHaveProperty("confirm");
    });
  });

  it("добавление к существующей задаче — в критерии capture, а «поправить» ушло из find_task", () => {
    expect(ROUTE_CRITERIA.capture).toMatch(/к уже существующей задаче/);
    expect(ROUTE_CRITERIA.capture).toMatch(/подзадачу/);
    expect(ROUTE_CRITERIA.capture).toMatch(/ссылку/);
    expect(ROUTE_CRITERIA.find_task).not.toMatch(/поправ/);
  });

  describe("намерение без содержания", () => {
    function jevIntent(
      choice: string,
      confidence: number,
      intent: number,
      extra: { correction?: number; confirm?: number } = {}
    ): ReturnType<typeof vi.fn> {
      return vi.fn().mockResolvedValue({
        answers: {
          route: { type: "choice", choice, confidence, probabilities: { [choice]: confidence } },
          intent: { type: "noul", noul: intent },
          ...(extra.correction === undefined ? {} : { correction: { type: "noul", noul: extra.correction } }),
          ...(extra.confirm === undefined ? {} : { confirm: { type: "noul", noul: extra.confirm } }),
        },
        latencyMs: 400,
      });
    }
    const TEXT = "хочу создать новую задачу в блоке ml модели";

    it("вопрос intent задаётся в том же запросе, с критериями да/нет", async () => {
      const ask = jevIntent("capture", 0.99, 0.97);
      await decideRoute(inbound({ text: TEXT }), null, { askJev: ask as unknown as Ask });
      expect(ask).toHaveBeenCalledTimes(1);
      expect(ask.mock.calls[0][0].questions.intent).toEqual({
        type: "noul",
        instructions: INTENT_INSTRUCTIONS,
        criteria: INTENT_CRITERIA,
      });
    });

    it("capture и noul ≥ 0.7 — intentOnly", async () => {
      const ask = jevIntent("capture", 0.99, 0.7);
      const d = await decideRoute(inbound({ text: TEXT }), null, { askJev: ask as unknown as Ask });
      expect(d).toMatchObject({ route: "capture", correction: false, intentOnly: true, source: "jev" });
    });

    it("noul ниже 0.7 — обычная запись, поля intentOnly нет", async () => {
      const ask = jevIntent("capture", 0.99, 0.69);
      const d = await decideRoute(inbound({ text: "Создай задачу позвонить Маше" }), null, {
        askJev: ask as unknown as Ask,
      });
      expect(d).not.toHaveProperty("intentOnly");
    });

    it("запасной capture по низкой уверенности тоже спрашивает «что записать»", async () => {
      const ask = jevIntent("find_task", 0.5, 0.9);
      const d = await decideRoute(inbound({ text: TEXT }), null, { askJev: ask as unknown as Ask });
      expect(d).toMatchObject({ route: "capture", source: "fallback", intentOnly: true });
    });

    it.each(["ask_board", "find_task", "smalltalk", "forward"])(
      "маршрут %s — не intentOnly, даже при высоком noul",
      async (route) => {
        const ask = jevIntent(route, 0.95, 0.95);
        const d = await decideRoute(inbound({ text: TEXT }), null, { askJev: ask as unknown as Ask });
        expect(d).not.toHaveProperty("intentOnly");
      }
    );

    it("поправка к черновику важнее намерения", async () => {
      const ask = jevIntent("capture", 0.9, 0.95, { correction: 0.9, confirm: 0.1 });
      const d = await decideRoute(inbound({ text: "и добавь задачу" }), DRAFT, {
        askJev: ask as unknown as Ask,
      });
      expect(d.correction).toBe(true);
      expect(d).not.toHaveProperty("intentOnly");
    });

    it("«отправляй» важнее намерения", async () => {
      const ask = jevIntent("capture", 0.9, 0.95, { correction: 0.1, confirm: 0.9 });
      const d = await decideRoute(inbound({ text: "да, записывай" }), DRAFT, {
        askJev: ask as unknown as Ask,
      });
      expect(d.confirm).toBe(true);
      expect(d).not.toHaveProperty("intentOnly");
    });

    it("со ссылкой не спрашивается: ссылка — уже содержание", async () => {
      const ask = jevIntent("capture", 0.9, 0.95);
      const d = await decideRoute(
        inbound({ text: "запиши https://example.com", links: [{ url: "https://example.com" }] }),
        null,
        { askJev: ask as unknown as Ask }
      );
      expect(ask.mock.calls[0][0].questions).not.toHaveProperty("intent");
      expect(d).not.toHaveProperty("intentOnly");
    });

    it("сбой Jev — запасной capture без intentOnly", async () => {
      const ask = vi.fn().mockRejectedValue(new Error("Jev: timeout 1500 мс"));
      const d = await decideRoute(inbound({ text: TEXT }), null, { askJev: ask as unknown as Ask });
      expect(d).toMatchObject({ route: "capture", source: "fallback" });
      expect(d).not.toHaveProperty("intentOnly");
    });
  });
});

/** Живой случай 714077403: просьба переделать черновик со списком — Jev ответил «отправляй» 0.97. */
const LIVE_403 =
  "Давай вот эти подзадачи добавим в создание ии-агента по почте\n\n" +
  "1. Задача «Разобраться, может ли визуальная модель читать картинки и таблицы во вложениях»\n" +
  "2. Задача «Собрать прототип агента без коннектора и показать на следующей встрече»\n" +
  "6. Задача «Узнать про групповые ящики в MCP-сервере, доработку ждут в ноябре»";

function jevAnswers(answers: Record<string, number>, route = "capture"): ReturnType<typeof vi.fn> {
  return vi.fn().mockResolvedValue({
    answers: {
      route: { type: "choice", choice: route, confidence: 0.95, probabilities: { [route]: 0.95 } },
      ...Object.fromEntries(
        Object.entries(answers).map(([name, noul]) => [name, { type: "noul", noul }])
      ),
    },
    latencyMs: 300,
  });
}

describe("«отправляй» — только без нового содержания", () => {
  it("bareConfirm: короткие «отправляй» — да; список и просьба переделать — нет", () => {
    for (const text of ["да, отправляй", "ок, на доску", "Все, отправляй короче на доску. Пофиг.",
      "Ну, нет, команда, вот, отправляй, отправляй сообщение. Точнее, задачу отправляй."]) {
      expect(bareConfirm(text), text).toBe(true);
    }
    for (const text of [LIVE_403, "отправляй, но сделай их подзадачами", "1. отправляй"]) {
      expect(bareConfirm(text), text).toBe(false);
    }
  });

  it("714077403: Jev сказал «отправляй» 0.97, а это поправка к черновику", async () => {
    const ask = jevAnswers({ confirm: 0.97, correction: 0.4, intent: 0.1 });
    const d = await decideRoute(inbound({ text: LIVE_403 }), DRAFT, { askJev: ask as unknown as Ask });
    expect(d.confirm).toBeUndefined();
    expect(d.correction).toBe(true);
    expect(d.intentOnly).toBeUndefined();
  });

  it("«да, отправляй» по-прежнему confirm", async () => {
    const ask = jevAnswers({ confirm: 0.92, correction: 0.2 });
    const d = await decideRoute(inbound({ text: "да, отправляй" }), DRAFT, { askJev: ask as unknown as Ask });
    expect(d.confirm).toBe(true);
  });

  it("вопрос confirm требует «КАК ЕСТЬ, без изменений»", () => {
    expect(CONFIRM_INSTRUCTIONS).toContain("КАК ЕСТЬ");
    expect(CONFIRM_INSTRUCTIONS).toContain("без нового содержания");
  });
});

describe("разговор и ответ (reply) в маршруте", () => {
  const CONVERSATION = [
    { role: "bot" as const, text: "Отправил черновик на доску: 6 из 6." },
    { role: "owner" as const, text: "1. a" },
    { role: "bot" as const, text: "Черновик: 1. a" },
    { role: "owner" as const, text: "2. b" },
    { role: "bot" as const, text: "Черновик: 1. b" },
  ];

  it("последние 4 реплики уходят Jev как state.previous", async () => {
    const ask = jevAnswers({ intent: 0.1 });
    await decideRoute(inbound(), null, { askJev: ask as unknown as Ask }, CONVERSATION);
    const state = ask.mock.calls[0][0].state;
    expect(state.previous).toEqual(CONVERSATION.slice(-4));
  });

  it("без разговора previous в state нет", async () => {
    const ask = jevAnswers({ intent: 0.1 });
    await decideRoute(inbound(), null, { askJev: ask as unknown as Ask });
    expect(ask.mock.calls[0][0].state.previous).toBeUndefined();
  });

  it("«я просил сделать их в виде подзадачи» после отчёта — не «только намерение»", async () => {
    const ask = jevAnswers({ intent: 0.91 });
    const d = await decideRoute(
      inbound({ text: "я просил сделать их в виде подзадачи" }),
      null,
      { askJev: ask as unknown as Ask },
      CONVERSATION
    );
    expect(d.route).toBe("capture");
    expect(d.intentOnly).toBeUndefined();
  });

  it("та же отсылка без разговора — намерение по Jev остаётся", async () => {
    const ask = jevAnswers({ intent: 0.91 });
    const d = await decideRoute(inbound({ text: "хочу создать задачу" }), null, { askJev: ask as unknown as Ask });
    expect(d.intentOnly).toBe(true);
  });

  it("ответ на сообщение с текстом: вопрос «только намерение» не задаётся, текст — в state.reply", async () => {
    const ask = jevAnswers({ intent: 0.99 });
    const d = await decideRoute(
      inbound({
        text: "это в дополнении к двум задач выше",
        replyTo: { messageId: 140, text: "📝 Черновик\n\n1. Добавить подзадачу", fromBot: true },
      }),
      null,
      { askJev: ask as unknown as Ask }
    );
    const call = ask.mock.calls[0][0];
    expect(call.questions.intent).toBeUndefined();
    expect(call.state.reply).toContain("Черновик");
    expect(d.intentOnly).toBeUndefined();
  });
});

describe("порог поправки при отсылке к разговору", () => {
  const conversation = [{ role: "bot" as const, text: "Черновик: 1. Задача «X»" }];

  it("«это в дополнении…» с разговором: 0.65 — уже поправка", async () => {
    const ask = jevAnswers({ correction: 0.65, confirm: 0.3, intent: 0.2 });
    const d = await decideRoute(inbound({ text: "это в дополнении к двум задач выше" }), DRAFT, { askJev: ask as unknown as Ask }, conversation);
    expect(d.correction).toBe(true);
  });

  it("без отсылки или без разговора 0.65 — не поправка", async () => {
    const ask = jevAnswers({ correction: 0.65, confirm: 0.3, intent: 0.2 });
    expect((await decideRoute(inbound({ text: "купить хлеб" }), DRAFT, { askJev: ask as unknown as Ask }, conversation)).correction).toBe(false);
    expect((await decideRoute(inbound({ text: "это в дополнении к двум задач выше" }), DRAFT, { askJev: ask as unknown as Ask })).correction).toBe(false);
  });
});
