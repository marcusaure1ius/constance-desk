import { describe, it, expect } from "vitest";
import { field, formatShortDate, plural } from "@/lib/telegram/format";

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

describe("formatShortDate", () => {
  const today = new Date("2026-08-24T09:00:00Z");

  it("в этом году — без года", () => {
    expect(formatShortDate("2026-08-25", today)).toBe("25.08");
  });

  it("в другом году — с годом", () => {
    expect(formatShortDate("2027-01-05", today)).toBe("05.01.2027");
  });
});

describe("field", () => {
  it("экранирует разметку", () => {
    expect(field("<b>&</b>", 100)).toBe("&lt;b&gt;&amp;&lt;/b&gt;");
  });

  it("короткое не трогает, длинное режет с многоточием в пределе", () => {
    expect(field("короткое", 20)).toBe("короткое");
    const cut = field("а".repeat(50), 10);
    expect(cut).toHaveLength(10);
    expect(cut.endsWith("…")).toBe(true);
  });

  it("меряет готовый HTML: «&» считается за пять символов", () => {
    const cut = field("&".repeat(10), 12);
    expect(cut.length).toBeLessThanOrEqual(12);
    // Сущность целиком или никак: «&am» — ошибка разметки.
    expect(cut).toBe("&amp;&amp;…");
  });

  it("не разрезает суррогатную пару", () => {
    const cut = field("😀".repeat(10), 6);
    expect(cut.length).toBeLessThanOrEqual(6);
    expect(cut).toBe("😀😀…");
  });

  it("нулевой предел — пустая строка", () => {
    expect(field("что угодно", 0)).toBe("");
  });
});
