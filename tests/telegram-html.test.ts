import { describe, it, expect } from "vitest";
import { richTextToTelegramHtml } from "@/lib/telegram/telegram-html";

describe("richTextToTelegramHtml", () => {
  it("экранирует < и & в тексте", () => {
    expect(richTextToTelegramHtml("a < b & c")).toBe("a &lt; b &amp; c");
  });

  it("жирный, курсив и код", () => {
    expect(richTextToTelegramHtml("**да** и *нет* и `x<y`")).toBe(
      "<b>да</b> и <i>нет</i> и <code>x&lt;y</code>",
    );
  });

  it("заголовок становится жирным", () => {
    expect(richTextToTelegramHtml("## Сегодня")).toBe("<b>Сегодня</b>");
  });

  it("список — через «• »", () => {
    expect(richTextToTelegramHtml("- раз\n- два")).toBe("• раз\n• два");
  });

  it("абзацы разделены пустой строкой", () => {
    expect(richTextToTelegramHtml("один\n\nдва")).toBe("один\n\nдва");
  });
});
