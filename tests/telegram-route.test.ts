import { describe, it, expect, vi } from "vitest";
import { CONFIRM_INSTRUCTIONS, decideRoute, ROUTE_CRITERIA } from "@/lib/telegram/route";
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
    expect(Object.keys(questions)).toEqual(["route"]);
    expect(Object.keys(questions.route.criteria)).toEqual(Object.keys(ROUTE_CRITERIA));
    expect(ask.mock.calls[0][0].state).toEqual({ message: "позвонить Маше", links: [] });
  });

  it("с черновиком спрашивает correction и кладёт его в state", async () => {
    const ask = jevReturns("capture", 0.9, 0.8);
    const d = await decideRoute(inbound({ text: "нет, вторую не надо" }), DRAFT, {
      askJev: ask as unknown as Ask,
    });
    expect(d.correction).toBe(true);
    expect(Object.keys(ask.mock.calls[0][0].questions)).toEqual(["route", "correction", "confirm"]);
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
    expect(Object.keys(ask.mock.calls[0][0].questions)).toEqual(["route"]);
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
});
