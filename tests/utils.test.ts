import { describe, it, expect } from "vitest";
import { cn, getWeekRange, formatDate } from "@/lib/utils";

describe("cn", () => {
  it("объединяет классы", () => {
    expect(cn("a", "b")).toBe("a b");
  });

  it("мержит tailwind-классы", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
  });

  it("обрабатывает условные классы", () => {
    expect(cn("base", false && "hidden", "extra")).toBe("base extra");
  });
});

describe("getWeekRange", () => {
  it("возвращает начало и конец недели (понедельник-воскресенье)", () => {
    // Среда, 2 апреля 2026
    const date = new Date(2026, 2, 4); // March 4, 2026 — Wednesday
    const { start, end } = getWeekRange(date);

    expect(start.getDay()).toBe(1); // понедельник
    expect(end.getDay()).toBe(0); // воскресенье
    expect(start <= date).toBe(true);
    expect(end >= date).toBe(true);
  });

  it("обрабатывает понедельник как начало недели", () => {
    // Понедельник, 2 марта 2026
    const date = new Date(2026, 2, 2);
    const { start } = getWeekRange(date);
    expect(start.getDate()).toBe(date.getDate());
  });
});

describe("formatDate", () => {
  it("форматирует Date объект в русскую локаль", () => {
    const date = new Date(2026, 0, 15); // 15 января 2026
    const result = formatDate(date);
    expect(result).toBe("15.01.2026");
  });

  it("форматирует строку даты", () => {
    const result = formatDate("2026-03-20");
    expect(result).toMatch(/20\.03\.2026/);
  });
});
