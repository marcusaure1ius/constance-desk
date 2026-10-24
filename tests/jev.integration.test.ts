import { describe, it, expect } from "vitest";
import { askJev } from "@/lib/llm/jev";
import { decideRoute } from "@/lib/telegram/route";
import type { Inbound } from "@/lib/telegram/inbound";
import {
  CONFIRM_CASES,
  CORRECTION_CASES,
  NOT_CONFIRM_CASES,
  DRAFT_SUMMARY,
  NEW_ENTRY_CASES,
  ROUTE_CASES,
  ROUTE_HIT_RATIO,
} from "./fixtures/route-cases";

/*
 * Интеграционный тест — реальные запросы к Jev через OpenRouter. В основной
 * прогон (npm test) не попадает: маска *.integration.test.ts исключена в
 * vitest.config.ts, а из набора на базе файл вычтен в scripts/run-db-integration.sh.
 *
 * Запуск: npm run test:integration:llm (нужен OPENROUTER_API_KEY в .env.local)
 */

if (!process.env.OPENROUTER_API_KEY) {
  throw new Error(
    "OPENROUTER_API_KEY не задан — интеграционным тестам Jev нужен настоящий ключ. " +
      "Запуск: npm run test:integration:llm"
  );
}

function inbound(text: string): Inbound {
  return { text, links: [], hasUnreadableMedia: false };
}

// Живой запрос укладывается в 1,5 с с запасом, но сеть бывает медленной:
// тест даёт Jev больше времени, чем бот в бою.
const deps = { askJev: (input: Parameters<typeof askJev>[0]) => askJev({ ...input, timeoutMs: 8000 }) };

const MIN_HITS = Math.ceil(ROUTE_CASES.length * ROUTE_HIT_RATIO);

describe("decideRoute — реальный Jev", () => {
  it(`попадает в ожидаемый маршрут не меньше чем в ${MIN_HITS} из ${ROUTE_CASES.length} фраз`, async () => {
    const results = await Promise.all(
      ROUTE_CASES.map(async (c) => {
        const d = await decideRoute(inbound(c.text), null, deps);
        return { ...c, got: d.route, source: d.source, confidence: d.confidence, reason: d.reason };
      })
    );
    for (const r of results) {
      console.log(
        `${r.got === r.route ? "ok  " : "MISS"} ${r.route} -> ${r.got} (${r.source}, ${r.confidence ?? r.reason}) «${r.text.slice(0, 50)}»`
      );
    }
    const hits = results.filter((r) => r.got === r.route).length;
    console.log(`маршрутов угадано: ${hits}/${results.length}`);
    expect(hits).toBeGreaterThanOrEqual(MIN_HITS);
  }, 30000);

  it("узнаёт все поправки к открытому черновику", async () => {
    const draft = { summary: DRAFT_SUMMARY, createdAt: new Date() };
    const results = await Promise.all(
      CORRECTION_CASES.map(async (text) => ({
        text,
        d: await decideRoute(inbound(text), draft, deps),
      }))
    );
    for (const r of results) console.log(`correction=${r.d.correction} «${r.text}»`);
    expect(results.filter((r) => !r.d.correction).map((r) => r.text)).toEqual([]);
  }, 30000);

  it("новая запись и вопрос при открытом черновике — не поправка", async () => {
    const draft = { summary: DRAFT_SUMMARY, createdAt: new Date() };
    const results = await Promise.all(
      NEW_ENTRY_CASES.map(async (text) => ({
        text,
        d: await decideRoute(inbound(text), draft, deps),
      }))
    );
    for (const r of results) console.log(`correction=${r.d.correction} route=${r.d.route} «${r.text}»`);
    expect(results.filter((r) => r.d.correction).map((r) => r.text)).toEqual([]);
  }, 30000);

  it("узнаёт «отправляй» при открытом черновике", async () => {
    const draft = { summary: DRAFT_SUMMARY, createdAt: new Date() };
    const results = await Promise.all(
      CONFIRM_CASES.map(async (text) => ({ text, d: await decideRoute(inbound(text), draft, deps) }))
    );
    for (const r of results) console.log(`confirm=${r.d.confirm ?? false} «${r.text}»`);
    expect(results.filter((r) => !r.d.confirm).map((r) => r.text)).toEqual([]);
  }, 30000);

  it("новое дело со словом «отправить», поправки и новые записи — не «отправляй»", async () => {
    const draft = { summary: DRAFT_SUMMARY, createdAt: new Date() };
    const texts = [...NOT_CONFIRM_CASES, ...CORRECTION_CASES, ...NEW_ENTRY_CASES];
    const results = await Promise.all(
      texts.map(async (text) => ({ text, d: await decideRoute(inbound(text), draft, deps) }))
    );
    for (const r of results) {
      console.log(`confirm=${r.d.confirm ?? false} correction=${r.d.correction} route=${r.d.route} «${r.text}»`);
    }
    expect(results.filter((r) => r.d.confirm).map((r) => r.text)).toEqual([]);
  }, 30000);
});
