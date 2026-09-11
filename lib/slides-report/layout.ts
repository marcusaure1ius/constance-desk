import type { SlideRow } from "./types";

/**
 * Раскладка таблицы по слайдам: геометрия, оценка высоты, выбор шрифта.
 *
 * Slides API не умеет «ужать таблицу до слайда»: строки растут по тексту, и
 * таблица молча уезжает за нижний край. Поэтому высота оценивается здесь, до
 * выгрузки: слова переносятся по ширине колонки, строки умножаются на
 * межстрочный интервал. Коэффициенты сняты с живого слайда владельца и
 * воспроизводят его строки с точностью до пары пунктов
 * (`tests/slides-layout.test.ts`).
 *
 * Если таблица не влезает даже самым мелким шрифтом, эпики раскладываются по
 * слайдам-продолжениям. Эпик целиком живёт на одном слайде: строку таблицы
 * между слайдами не разорвать.
 */

export const TABLE_TITLE = "Статусы по развитию AI и ML";
export const CONTINUATION_TITLE = `${TABLE_TITLE} (продолжение)`;

export const COLUMN_HEADERS = [
  "№ п.п",
  "Что в фокусе",
  "Задачи",
  "Статус",
  "Текущая неделя",
  "Следующая неделя",
] as const;

/** Доли ширины таблицы. «Статус» 8 %: в 6 % заголовок рвался на «Стату / с». */
export const COLUMN_SHARES = [0.05, 0.19, 0.22, 0.08, 0.23, 0.23] as const;
export const STATUS_COLUMN = 3;

/** Таблица в долях страницы: слева, сверху (под плашкой), ширина, нижняя граница. */
export const TABLE_BOX = { x: 0.04, y: 0.13, width: 0.92, bottom: 0.97 } as const;

/** Высота стандартного слайда 16:9 в EMU — от неё масштабируются шрифты. */
export const BASE_PAGE_HEIGHT = 5143500;
export const EMU_PER_PT = 12700;
/** Колонку уже 32 pt Slides API не принимает. */
const MIN_COLUMN_WIDTH = 406400;

/** Размеры текста таблицы для слайда 16:9, от крупного к мелкому. */
const SIZE_LADDER = [11, 10.5, 10, 9.5, 9, 8.5, 8, 7.5, 7] as const;
const TITLE_SIZE = 14;
const HEADER_MAX_SIZE = 9;
const DOT_RATIO = 1.6;

// Замерено на живом слайде (Proxima Nova, 16:9).
/** Средняя ширина символа в долях кегля. */
const CHAR_EM = 0.53;
/** То же для жирной шапки. */
const BOLD_CHAR_EM = 0.58;
/** Высота строки в долях кегля. */
const LINE_HEIGHT = 1.17;
/** Внутренние отступы ячейки, сумма сверху и снизу. Абсолютные, от шрифта не зависят. */
const CELL_PADDING_V = 15;
/** То же слева и справа. */
const CELL_PADDING_H = 16;
/** Пустая ячейка держит строку шрифтом Slides по умолчанию. */
const EMPTY_CELL_SIZE = 14;
/** Запас на неточность оценки. */
const SAFETY = 1.05;

/** Размер страницы в EMU. */
export type PageSize = { width: number; height: number };

/** Итоговые кегли таблицы, pt, уже с масштабом страницы. */
export type TableSizes = { text: number; header: number; title: number; dot: number };

export type SlidePlan = {
  sizes: TableSizes;
  /** Строки по слайдам: первый — основной, остальные — продолжения. */
  pages: SlideRow[][];
  /** Эпики, которые не влезают даже одни на слайд самым мелким шрифтом. */
  oversized: string[];
};

/** Кегль с масштабом по высоте страницы, округлённый до 0.5 pt. */
export function scaledPt(size: number, page: PageSize): number {
  return Math.round(size * (page.height / BASE_PAGE_HEIGHT) * 2) / 2;
}

export function tableSizes(base: number, page: PageSize): TableSizes {
  return {
    text: scaledPt(base, page),
    header: scaledPt(Math.min(base, HEADER_MAX_SIZE), page),
    title: scaledPt(TITLE_SIZE, page),
    dot: scaledPt(base * DOT_RATIO, page),
  };
}

export function columnWidthsEmu(page: PageSize): number[] {
  const width = page.width * TABLE_BOX.width;
  return COLUMN_SHARES.map((share) => Math.max(MIN_COLUMN_WIDTH, width * share));
}

/** Ячейка «Задачи»: по задаче на строку, с маркером. */
export function formatTasksCell(tasks: string[]): string {
  return tasks.map((t) => `• ${t}`).join("\n");
}

/** Сколько строк займёт текст в колонке такой ширины: перенос по словам, как в Slides. */
export function estimateLines(text: string, widthPt: number, sizePt: number, charEm = CHAR_EM): number {
  if (!text) return 0;
  const perLine = Math.max(1, Math.floor(widthPt / (sizePt * charEm)));
  return text.split("\n").reduce((sum, paragraph) => sum + wrapParagraph(paragraph, perLine), 0);
}

function wrapParagraph(paragraph: string, perLine: number): number {
  const words = paragraph.split(/\s+/).filter(Boolean);
  if (words.length === 0) return 1;
  let lines = 1;
  let used = 0;
  for (const word of words) {
    const need = used === 0 ? word.length : used + 1 + word.length;
    if (need <= perLine) {
      used = need;
      continue;
    }
    if (used > 0) lines++;
    // Слово длиннее строки Slides режет по символам.
    let rest = word.length;
    while (rest > perLine) {
      rest -= perLine;
      lines++;
    }
    used = rest;
  }
  return lines;
}

function textHeight(text: string, widthPt: number, sizePt: number, charEm = CHAR_EM): number {
  const lines = estimateLines(text, widthPt - CELL_PADDING_H, sizePt, charEm);
  return lines === 0 ? EMPTY_CELL_SIZE * LINE_HEIGHT : lines * sizePt * LINE_HEIGHT;
}

/** Высота строки эпика, pt. `widthsPt` — ширины колонок в пунктах. */
export function estimateRowHeight(row: SlideRow, number: number, sizes: TableSizes, widthsPt: number[]): number {
  const cells = [String(number), row.focus, formatTasksCell(row.tasks), null, row.thisWeek, row.nextWeek];
  let tallest = sizes.dot * LINE_HEIGHT;
  cells.forEach((text, c) => {
    if (text !== null) tallest = Math.max(tallest, textHeight(text, widthsPt[c], sizes.text));
  });
  return tallest + CELL_PADDING_V;
}

/** Строка заголовка таблицы плюс шапка колонок, pt. */
export function estimateHeadHeight(sizes: TableSizes, widthsPt: number[]): number {
  const title = sizes.title * LINE_HEIGHT + CELL_PADDING_V;
  const header = Math.max(
    ...COLUMN_HEADERS.map((h, c) => textHeight(h, widthsPt[c], sizes.header, BOLD_CHAR_EM))
  );
  return title + header + CELL_PADDING_V;
}

/**
 * Как разложить эпики: всё на один слайд самым крупным шрифтом, который
 * влезает; иначе — по нескольким слайдам, и шрифт самый крупный из тех, что
 * не добавляют слайдов. Если какой-то эпик не влезает даже один, берётся
 * самый мелкий шрифт: пусть вылезает как можно меньше.
 */
export function planSlides(rows: SlideRow[], page: PageSize): SlidePlan {
  const widthsPt = columnWidthsEmu(page).map((w) => w / EMU_PER_PT);
  const availablePt = (page.height / EMU_PER_PT) * (TABLE_BOX.bottom - TABLE_BOX.y);
  const layout = (base: number) => paginate(rows, tableSizes(base, page), widthsPt, availablePt);

  for (const base of SIZE_LADDER) {
    const plan = layout(base);
    if (plan.pages.length === 1 && plan.oversized.length === 0) return plan;
  }

  const smallest = layout(SIZE_LADDER[SIZE_LADDER.length - 1]);
  if (smallest.oversized.length > 0) return smallest;
  for (const base of SIZE_LADDER) {
    const plan = layout(base);
    if (plan.pages.length <= smallest.pages.length && plan.oversized.length === 0) return plan;
  }
  return smallest;
}

function paginate(rows: SlideRow[], sizes: TableSizes, widthsPt: number[], availablePt: number): SlidePlan {
  const head = estimateHeadHeight(sizes, widthsPt);
  const pages: SlideRow[][] = [];
  const oversized: string[] = [];
  let current: SlideRow[] = [];
  let height = head;

  rows.forEach((row, i) => {
    const rowHeight = estimateRowHeight(row, i + 1, sizes, widthsPt);
    if ((head + rowHeight) * SAFETY > availablePt) oversized.push(row.focus);
    if (current.length > 0 && (height + rowHeight) * SAFETY > availablePt) {
      pages.push(current);
      current = [];
      height = head;
    }
    current.push(row);
    height += rowHeight;
  });
  pages.push(current);

  return { sizes, pages, oversized };
}
