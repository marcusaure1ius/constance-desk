import { parseRichText, type InlineNode } from "@/lib/agent/rich-text";
import { escapeHtml } from "./client";

/**
 * Ответ модели (лёгкий Markdown) → HTML, который понимает Телеграм
 * (`parse_mode: HTML`). Весь текст проходит через escapeHtml, теги ставим сами.
 */

function inlineToHtml(nodes: InlineNode[]): string {
  return nodes
    .map((node) => {
      const text = escapeHtml(node.text);
      switch (node.type) {
        case "bold":
          return `<b>${text}</b>`;
        case "italic":
          return `<i>${text}</i>`;
        case "code":
          return `<code>${text}</code>`;
        default:
          return text;
      }
    })
    .join("");
}

export function richTextToTelegramHtml(markdown: string): string {
  return parseRichText(markdown)
    .map((block) => {
      if (block.type === "heading") return `<b>${inlineToHtml(block.inline)}</b>`;
      if (block.type === "list") {
        return block.items.map((item) => `• ${inlineToHtml(item)}`).join("\n");
      }
      return inlineToHtml(block.inline);
    })
    .join("\n\n");
}
