import { describe, expect, it } from "vitest";
import { parseInline, parseRichText, toPlainText } from "@/lib/agent/rich-text";

describe("parseInline", () => {
  it("разбирает жирный текст внутри строки", () => {
    const nodes = parseInline("Просроченные — **важно** — три штуки");
    expect(nodes).toContainEqual({ type: "bold", text: "важно" });
    expect(nodes.some((n) => n.type === "text" && n.text.includes("Просроченные"))).toBe(true);
  });

  it("разбирает курсив и код внутри строки", () => {
    const nodes = parseInline("*курсив* и `код`");
    expect(nodes).toContainEqual({ type: "italic", text: "курсив" });
    expect(nodes).toContainEqual({ type: "code", text: "код" });
  });

  it("незакрытая звёздочка не ломает разбор и не съедает текст", () => {
    const input = "Текст **хвост без закрытия";
    const nodes = parseInline(input);
    // Ни один фрагмент разметки не найден — весь текст должен остаться, включая звёздочки.
    expect(nodes.every((n) => n.type === "text")).toBe(true);
    expect(nodes.map((n) => n.text).join("")).toBe(input);
  });

  it("незакрытый одиночный курсив тоже не съедает текст", () => {
    const input = "Ещё *хвост без пары";
    const nodes = parseInline(input);
    expect(nodes.map((n) => n.text).join("")).toBe(input);
  });

  it("текст без разметки проходит как есть", () => {
    const input = "Просто текст без разметки.";
    const nodes = parseInline(input);
    expect(nodes).toEqual([{ type: "text", text: input }]);
  });
});

describe("parseRichText", () => {
  it("собирает список из нескольких пунктов в один блок", () => {
    const blocks = parseRichText("- Пункт один\n- Пункт два\n* Пункт три\n• Пункт четыре");
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ type: "list" });
    if (blocks[0].type !== "list") throw new Error("ожидался список");
    expect(blocks[0].items).toHaveLength(4);
    expect(blocks[0].items[0]).toEqual([{ type: "text", text: "Пункт один" }]);
    expect(blocks[0].items[3]).toEqual([{ type: "text", text: "Пункт четыре" }]);
  });

  it("разделяет абзацы пустой строкой", () => {
    const blocks = parseRichText("Первый абзац.\n\nВторой абзац.");
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toEqual({
      type: "paragraph",
      inline: [{ type: "text", text: "Первый абзац." }],
    });
    expect(blocks[1]).toEqual({
      type: "paragraph",
      inline: [{ type: "text", text: "Второй абзац." }],
    });
  });

  it("заголовок разбирается как отдельный блок с той же инлайн-разметкой", () => {
    const blocks = parseRichText("## Просрочено");
    expect(blocks).toEqual([
      { type: "heading", inline: [{ type: "text", text: "Просрочено" }] },
    ]);
  });

  it("незакрытая звёздочка на уровне абзаца не рвёт весь ответ", () => {
    const input = "Смотри: **хвост без закрытия\n\nВторой абзац цел.";
    const blocks = parseRichText(input);
    expect(blocks).toHaveLength(2);
    if (blocks[0].type !== "paragraph") throw new Error("ожидался абзац");
    expect(blocks[0].inline.map((n) => n.text).join("")).toBe(
      "Смотри: **хвост без закрытия"
    );
    expect(blocks[1]).toEqual({
      type: "paragraph",
      inline: [{ type: "text", text: "Второй абзац цел." }],
    });
  });

  it("текст вообще без разметки проходит как один абзац как есть", () => {
    const input = "Просроченного нет. В «В работе» две задачи.";
    const blocks = parseRichText(input);
    expect(blocks).toEqual([
      { type: "paragraph", inline: [{ type: "text", text: input }] },
    ]);
  });

  it("список между двумя абзацами не поглощает соседний текст", () => {
    const blocks = parseRichText("Вот что нашёл:\n- один\n- два\nИтого готово.");
    expect(blocks.map((b) => b.type)).toEqual(["paragraph", "list", "paragraph"]);
  });
});

describe("toPlainText", () => {
  it("снимает жирный и курсив", () => {
    expect(toPlainText("**жирный** и *курсив*")).toBe("жирный и курсив");
  });

  it("снимает моноширинный текст", () => {
    expect(toPlainText("используй `код`")).toBe("используй код");
  });

  it("снимает маркер списка", () => {
    expect(toPlainText("- один\n- два")).toBe("один два");
  });

  it("снимает заголовок", () => {
    expect(toPlainText("## Просрочено")).toBe("Просрочено");
  });

  it("текст без разметки не меняется", () => {
    expect(toPlainText("Просто текст.")).toBe("Просто текст.");
  });
});
