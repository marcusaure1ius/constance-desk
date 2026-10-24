/**
 * Превью ссылки: заголовок и описание страницы. Нужно, чтобы агент понимал,
 * о чём ссылка, не ходя в сеть сам. Функция никогда не бросает: недоступная
 * страница — не повод ронять разбор сообщения.
 */

const TIMEOUT_MS = 3000;
/** Заголовок и мета-теги лежат в начале документа — остальное читать незачем. */
const MAX_BYTES = 256 * 1024;

export type LinkPreview = { title?: string; description?: string };

export async function fetchLinkPreview(
  url: string,
  options: { fetchFn?: typeof fetch; timeoutMs?: number } = {}
): Promise<LinkPreview> {
  const fetchFn = options.fetchFn ?? fetch;
  const timeoutMs = options.timeoutMs ?? TIMEOUT_MS;
  const target = webUrl(url);
  if (!target) return {};
  const signal = AbortSignal.timeout(timeoutMs);

  try {
    const response = await fetchFn(target, {
      method: "GET",
      signal,
      redirect: "follow",
      headers: { accept: "text/html", "user-agent": "Mozilla/5.0 (compatible; ConstanceBot/1.0)" },
    });
    if (!response.ok) return {};
    const type = response.headers.get("content-type") ?? "";
    if (!/^text\/html\b/i.test(type)) return {};

    return parsePreview(await readLimited(response, signal));
  } catch {
    return {};
  }
}

/**
 * Адрес для запроса. Entity `url` у Telegram — это и голый домен
 * («example.com»): схемы нет, и fetch на нём падает. Дописываем https://;
 * кроме http и https не ходим никуда (ftp:, file:, mailto: превью не дают).
 */
function webUrl(raw: string): string | null {
  const trimmed = raw.trim();
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withScheme);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

/** Читает тело не дальше лимита; на таймаут бросает — ловит вызывающий. */
async function readLimited(response: Response, signal: AbortSignal): Promise<string> {
  if (!response.body) return (await response.text()).slice(0, MAX_BYTES);

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  const onAbort = () => void reader.cancel().catch(() => {});
  signal.addEventListener("abort", onAbort);
  try {
    while (total < MAX_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.byteLength;
    }
  } finally {
    signal.removeEventListener("abort", onAbort);
    await reader.cancel().catch(() => {});
  }
  if (signal.aborted) throw new Error("таймаут");

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8").decode(bytes.subarray(0, MAX_BYTES));
}

function parsePreview(html: string): LinkPreview {
  const title =
    metaContent(html, "property", "og:title") ?? tagText(html, "title");
  const description =
    metaContent(html, "property", "og:description") ??
    metaContent(html, "name", "description");

  const preview: LinkPreview = {};
  if (title) preview.title = title;
  if (description) preview.description = description;
  return preview;
}

/** Значение `content` у <meta>, у которого атрибут `attr` равен `key` (порядок атрибутов любой). */
function metaContent(html: string, attr: string, key: string): string | undefined {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    if (attribute(tag, attr)?.toLowerCase() !== key) continue;
    const content = attribute(tag, "content");
    if (content?.trim()) return clean(content);
  }
  return undefined;
}

function attribute(tag: string, name: string): string | undefined {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return match ? (match[1] ?? match[2] ?? match[3]) : undefined;
}

function tagText(html: string, tag: string): string | undefined {
  const match = html.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  const text = match ? clean(match[1]) : "";
  return text || undefined;
}

const NAMED: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", laquo: "«", raquo: "»",
  mdash: "—", ndash: "–", hellip: "…",
};

function clean(value: string): string {
  return decodeEntities(value).replace(/\s+/g, " ").trim();
}

function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === "#") {
      const code = body[1].toLowerCase() === "x" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      try {
        return String.fromCodePoint(code);
      } catch {
        return whole;
      }
    }
    return NAMED[body.toLowerCase()] ?? whole;
  });
}
