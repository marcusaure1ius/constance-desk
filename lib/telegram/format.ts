import { escapeHtml, safeCutIndex } from "@/lib/telegram/client";

/**
 * Мелкие форматтеры для сообщений бота: подстановка пользовательской строки в
 * HTML, склонение числительных и короткая дата. Общие для карточки задачи и
 * карточки черновика — правило обрезки должно быть одно на весь бот.
 */

const ELLIPSIS = "…";

/** «2026-08-25» → «25.08», а в другом году — «25.08.2027». */
export function formatShortDate(iso: string, today: Date = new Date()): string {
  const [year, month, day] = iso.split("-");
  const sameYear = Number(year) === today.getUTCFullYear();
  return sameYear ? `${day}.${month}` : `${day}.${month}.${year}`;
}

export function plural(count: number, forms: [string, string, string]): string {
  const mod100 = Math.abs(count) % 100;
  const mod10 = mod100 % 10;
  if (mod100 >= 11 && mod100 <= 14) return forms[2];
  if (mod10 === 1) return forms[0];
  if (mod10 >= 2 && mod10 <= 4) return forms[1];
  return forms[2];
}

/**
 * Пользовательская строка → готовый кусок HTML не длиннее `limit`.
 *
 * Экранируем до обрезки, а меряем после: escapeHtml растит «&» впятеро
 * («&amp;»), поэтому предел, посчитанный по сырому тексту, длину сообщения не
 * ограничивает вовсе.
 *
 * Резать готовый HTML можно не в любом месте. Разрезанная пополам сущность
 * («&am») — такая же ошибка разметки, как разрезанный тег, а половина
 * суррогатной пары вообще не UTF-8: на неё Telegram отвечает 400, которую
 * клиент не ретраит и не понижает до plain text. Тегов здесь быть не может —
 * они уже экранированы.
 */
export function field(value: string, limit: number): string {
  if (limit <= 0) return "";

  const html = escapeHtml(value);
  if (html.length <= limit) return html;

  let cut = limit - ELLIPSIS.length;

  // Каждая «&» в экранированном тексте начинает сущность, поэтому «& без ;»
  // слева от разреза значит, что разрез пришёлся внутрь неё.
  const amp = html.lastIndexOf("&", cut - 1);
  const semi = html.lastIndexOf(";", cut - 1);
  if (amp > semi) cut = amp;

  return html.slice(0, safeCutIndex(html, cut)) + ELLIPSIS;
}

/**
 * Чужой текст не должен закрыть обёртку раньше времени и выйти «наружу».
 * Теги не вырезаются, а обезвреживаются: однопроходная вырезка собирала тег
 * обратно («<</attachment>/attachment>» → «</attachment>»). Угловые скобки
 * заменены похожими «‹ ›» — читать текст модели это не мешает, а ни одна
 * обёртка (`<forwarded>`, `<attachment>`, `<reply>`) изнутри уже не откроется
 * и не закроется.
 */
export function wrapperBody(value: string): string {
  return value.replace(/</g, "‹").replace(/>/g, "›");
}
