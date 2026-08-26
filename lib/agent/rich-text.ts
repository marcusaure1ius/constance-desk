/**
 * Лёгкий разбор ответа модели: то немногое из Markdown, чем модель реально
 * пользуется — жирный `**текст**`, курсив `*текст*`, моноширинный `` `текст` ``,
 * маркированные списки (строки на `-`, `*` или `•`), заголовки строкой
 * (`#`/`##`/`###` — показываются как жирная строка) и пустая строка как
 * граница абзаца. Ссылки, таблицы и вложенные списки не поддерживаются:
 * модель их здесь не порождает, а поддержка стоит дорого.
 *
 * Чистая функция без React и без браузерных API — тестируется в node,
 * где живёт весь основной прогон.
 */

export type InlineNode =
  | { type: "text"; text: string }
  | { type: "bold"; text: string }
  | { type: "italic"; text: string }
  | { type: "code"; text: string };

export type RichBlock =
  | { type: "paragraph"; inline: InlineNode[] }
  | { type: "heading"; inline: InlineNode[] }
  | { type: "list"; items: InlineNode[][] };

const HEADING_RE = /^#{1,3}\s+(.*)$/;
const BULLET_RE = /^[-*•]\s+(.*)$/;

/**
 * Разбирает инлайн-разметку одной строки: жирный, курсив, код.
 *
 * Незакрытый маркер (например, `**хвост` без второй пары звёздочек) не
 * считается разметкой и не съедает текст — символы маркера остаются
 * литеральными, разбор продолжается посимвольно дальше.
 */
export function parseInline(text: string): InlineNode[] {
  const nodes: InlineNode[] = [];
  let buffer = "";
  let i = 0;

  const flushText = () => {
    if (buffer) {
      nodes.push({ type: "text", text: buffer });
      buffer = "";
    }
  };

  while (i < text.length) {
    if (text.startsWith("**", i)) {
      const close = text.indexOf("**", i + 2);
      const content = close !== -1 ? text.slice(i + 2, close) : "";
      if (close !== -1 && content.length > 0) {
        flushText();
        nodes.push({ type: "bold", text: content });
        i = close + 2;
        continue;
      }
      // Незакрытая или пустая пара — не разметка, а два литеральных символа.
      buffer += "**";
      i += 2;
      continue;
    }

    if (text[i] === "`") {
      const close = text.indexOf("`", i + 1);
      if (close !== -1 && close > i + 1) {
        flushText();
        nodes.push({ type: "code", text: text.slice(i + 1, close) });
        i = close + 1;
        continue;
      }
      buffer += "`";
      i += 1;
      continue;
    }

    if (text[i] === "*") {
      const close = text.indexOf("*", i + 1);
      if (close !== -1 && close > i + 1) {
        flushText();
        nodes.push({ type: "italic", text: text.slice(i + 1, close) });
        i = close + 1;
        continue;
      }
      buffer += "*";
      i += 1;
      continue;
    }

    buffer += text[i];
    i += 1;
  }

  flushText();
  return nodes;
}

type Building = { kind: "paragraph"; lines: string[] } | { kind: "list"; items: string[] } | null;

/** Разбирает ответ модели на блоки: абзацы, заголовки, списки. */
export function parseRichText(input: string): RichBlock[] {
  const blocks: RichBlock[] = [];
  let current: Building = null;

  const flush = () => {
    if (!current) return;
    if (current.kind === "paragraph") {
      blocks.push({ type: "paragraph", inline: parseInline(current.lines.join("\n")) });
    } else {
      blocks.push({ type: "list", items: current.items.map(parseInline) });
    }
    current = null;
  };

  for (const rawLine of input.split("\n")) {
    const line = rawLine.trimEnd();

    if (line.trim() === "") {
      flush();
      continue;
    }

    const heading = HEADING_RE.exec(line);
    if (heading) {
      flush();
      blocks.push({ type: "heading", inline: parseInline(heading[1]) });
      continue;
    }

    const bullet = BULLET_RE.exec(line);
    if (bullet) {
      if (current?.kind !== "list") {
        flush();
        current = { kind: "list", items: [] };
      }
      current.items.push(bullet[1]);
      continue;
    }

    if (current?.kind !== "paragraph") {
      flush();
      current = { kind: "paragraph", lines: [] };
    }
    current.lines.push(line);
  }

  flush();
  return blocks;
}

/**
 * Убирает Markdown-разметку, оставляя только текст — для мест вроде свёрнутой
 * плашки ленты, где рисовать блоки некуда, но `**жирный**` в строке резать глаз.
 * Абзацы и пункты списка склеиваются пробелом, разбор — тот же `parseRichText`.
 */
export function toPlainText(text: string): string {
  return parseRichText(text)
    .map((block) => {
      if (block.type === "list") {
        return block.items.map((item) => item.map((n) => n.text).join("")).join(" ");
      }
      return block.inline.map((n) => n.text).join("");
    })
    .join(" ")
    .trim();
}
