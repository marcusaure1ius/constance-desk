import { describe, it, expect, vi } from "vitest";

/*
 * T-0009: основной прогон обязан быть офлайн и не зависеть от чужих квот.
 * Раньше npm test дёргал живой Groq и валился по HTTP 429 — гейт был красным
 * не из-за кода. Эти проверки ломаются, если из vitest.config.ts убрать
 * заглушку сети или подстановку пустого GROQ_API_KEY.
 */
describe("изоляция основного прогона", () => {
  it("не видит ключи провайдеров из .env.local", () => {
    expect(process.env.GROQ_API_KEY ?? "").toBe("");
    expect(process.env.OPENROUTER_API_KEY ?? "").toBe("");
  });

  it("не пускает fetch наружу", () => {
    expect(() => fetch("https://api.groq.com/openai/v1/models")).toThrow(/не ходит в сеть/);
  });

  it("не мешает тестам подменять fetch", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok"));
    const res = await fetch("https://example.com");
    expect(await res.text()).toBe("ok");
    vi.restoreAllMocks();
  });
});
