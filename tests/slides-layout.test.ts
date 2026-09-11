import { describe, it, expect } from "vitest";
import {
  COLUMN_HEADERS,
  EMU_PER_PT,
  TABLE_BOX,
  columnWidthsEmu,
  estimateHeadHeight,
  estimateLines,
  estimateRowHeight,
  planSlides,
  tableSizes,
  type PageSize,
  type TableSizes,
} from "@/lib/slides-report/layout";
import type { SlideRow } from "@/lib/slides-report/types";

const PAGE: PageSize = { width: 9144000, height: 5143500 }; // 10 × 5.625 in
const PAGE_PT = { width: PAGE.width / EMU_PER_PT, height: PAGE.height / EMU_PER_PT };
const AVAILABLE_PT = PAGE_PT.height * (TABLE_BOX.bottom - TABLE_BOX.y);

function row(overrides: Partial<SlideRow> = {}): SlideRow {
  return { focus: "Эпик", tasks: ["Задача"], status: "green", thisWeek: "", nextWeek: "Задача", ...overrides };
}

/**
 * Пять эпиков с живого слайда владельца: те же длины слов, имена и продукты
 * заменены. На слайде 16:9 при 11 pt таблица вылезла за нижний край.
 */
const LIVE_ROWS: SlideRow[] = [
  row({
    focus: "Поручения со статусов по ИИ",
    tasks: ["Запустить опрос по использованию ИИ в РФ", "Погружение в направление Иванова А."],
    nextWeek: "Запустить опрос по использованию ИИ в РФ\nПогружение в направление Иванова А.",
  }),
  row({
    focus: "Прайсинг. Текущие задачи",
    tasks: ["Необходимо помочь прайсингу с Бета-Прогнозами"],
    status: "red",
    nextWeek: "Необходимо помочь прайсингу с Бета-Прогнозами",
  }),
  row({
    focus: "Формирование бэклога РФ",
    tasks: ["Внести в бэклог все задачи прайсинга", "Презентация для Сидоровой по штаткам DS"],
    status: "red",
    nextWeek: "Внести в бэклог все задачи прайсинга\nПрезентация для Сидоровой по штаткам DS",
  }),
  row({ focus: "Хакатон ИТМО и ВШЭ", tasks: ["Участие в QA сессиях"], status: "red", nextWeek: "Участие в QA сессиях" }),
  row({
    focus: "ML модели",
    tasks: ["Закончить задачу по Бета-Сегменту", "Разработка дизайна АБ по моделям для Бета-Плюс"],
    status: "red",
    nextWeek: "Закончить задачу по Бета-Сегменту\nРазработка дизайна АБ по моделям для Бета-Плюс",
  }),
];

describe("estimateLines", () => {
  // 10 pt × 0.53 = 5.3 pt на символ → в 53 pt ровно 10 символов.
  const WIDTH_10_CHARS = 53;

  it("пустой текст — ноль строк", () => {
    expect(estimateLines("", WIDTH_10_CHARS, 10)).toBe(0);
  });

  it("короткий текст — одна строка", () => {
    expect(estimateLines("коротко", WIDTH_10_CHARS, 10)).toBe(1);
  });

  it("переносит по словам, а не по символам", () => {
    expect(estimateLines("аааа бббб вввв", WIDTH_10_CHARS, 10)).toBe(2); // «аааа бббб» + «вввв»
  });

  it("слово длиннее строки режется по символам", () => {
    expect(estimateLines("а".repeat(25), WIDTH_10_CHARS, 10)).toBe(3);
  });

  it("каждый абзац начинается с новой строки", () => {
    expect(estimateLines("раз\nдва\nтри", WIDTH_10_CHARS, 10)).toBe(3);
  });
});

describe("калибровка по живому слайду", () => {
  // Геометрия, на которой владелец выгрузил слайд: «Статус» 6 %, кружок 24 pt.
  const liveWidthsPt = [0.05, 0.2, 0.23, 0.06, 0.23, 0.23].map(
    (share) => (PAGE_PT.width * TABLE_BOX.width * share)
  );
  const liveSizes: TableSizes = { text: 11, header: 9, title: 14, dot: 24 };
  // Высоты строк, снятые со скриншота (pt): эпики 1–5, затем заголовок и шапка.
  const measured = [67, 54, 67, 43, 79];

  it.each(LIVE_ROWS.map((r, i) => [i + 1, r, measured[i]] as const))(
    "эпик %i: оценка совпадает с замером ±2 pt",
    (number, liveRow, height) => {
      expect(Math.abs(estimateRowHeight(liveRow, number, liveSizes, liveWidthsPt) - height)).toBeLessThanOrEqual(2);
    }
  );

  it("заголовок таблицы и шапка: 31 + 36 pt («Статус» переносится в узкой колонке)", () => {
    expect(Math.abs(estimateHeadHeight(liveSizes, liveWidthsPt) - (31 + 36))).toBeLessThanOrEqual(2);
  });
});

describe("tableSizes", () => {
  it("кружок в 1.6 раза крупнее текста, шапка не крупнее 9 pt, заголовок 14 pt", () => {
    expect(tableSizes(11, PAGE)).toEqual({ text: 11, header: 9, title: 14, dot: 17.5 });
    expect(tableSizes(8, PAGE)).toEqual({ text: 8, header: 8, title: 14, dot: 13 });
  });

  it("масштабирует всё по высоте страницы", () => {
    expect(tableSizes(11, { width: 12192000, height: 6858000 }).text).toBe(14.5); // 13.33 × 7.5 in
  });
});

describe("columnWidthsEmu", () => {
  it("«Статус» — 8 % таблицы, ни одна колонка не уже 32 pt", () => {
    const widths = columnWidthsEmu(PAGE);
    expect(widths).toHaveLength(COLUMN_HEADERS.length);
    expect(widths[3]).toBeCloseTo(PAGE.width * TABLE_BOX.width * 0.08, 0);
    widths.forEach((w) => expect(w).toBeGreaterThanOrEqual(406400));
  });
});

describe("planSlides", () => {
  it("немного текста — один слайд крупным шрифтом", () => {
    const plan = planSlides([row(), row()], PAGE);
    expect(plan.pages).toHaveLength(1);
    expect(plan.sizes.text).toBe(11);
    expect(plan.oversized).toEqual([]);
  });

  it("живой пример владельца помещается на один слайд, шрифт уменьшен", () => {
    const plan = planSlides(LIVE_ROWS, PAGE);
    expect(plan.pages).toEqual([LIVE_ROWS]);
    expect(plan.sizes.text).toBeLessThan(11);
    expect(plan.sizes.text).toBeGreaterThanOrEqual(9);
  });

  it("не влезает даже мелким шрифтом — эпики уходят на слайды-продолжения", () => {
    const heavy = Array.from({ length: 12 }, (_, i) =>
      row({ focus: `Эпик ${i + 1}`, nextWeek: "Длинная формулировка плана на неделю. ".repeat(12) })
    );
    const plan = planSlides(heavy, PAGE);

    expect(plan.pages.length).toBeGreaterThan(1);
    expect(plan.pages.flat()).toEqual(heavy); // порядок и состав сохранены
    const widthsPt = columnWidthsEmu(PAGE).map((w) => w / EMU_PER_PT);
    let number = 1;
    for (const page of plan.pages) {
      const height =
        estimateHeadHeight(plan.sizes, widthsPt) +
        page.reduce((sum, r) => sum + estimateRowHeight(r, number++, plan.sizes, widthsPt), 0);
      expect(height).toBeLessThanOrEqual(AVAILABLE_PT);
    }
    expect(plan.oversized).toEqual([]);
  });

  it("эпик, который не влезает даже один на слайд, попадает в oversized", () => {
    const giant = row({ focus: "Огромный", nextWeek: "Очень длинный текст плана. ".repeat(110) });
    const plan = planSlides([row(), giant], PAGE);
    expect(plan.oversized).toEqual(["Огромный"]);
    expect(plan.pages.flat()).toEqual([row(), giant]);
    // Раз уж не влезает, пусть вылезает как можно меньше — самый мелкий шрифт.
    expect(plan.sizes.text).toBe(7);
  });
});
