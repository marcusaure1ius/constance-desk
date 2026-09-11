import { describe, it, expect } from "vitest";
import { buildWeekSlideRequests, rgbColor, type BuildSlideInput } from "@/lib/slides-report/build-slide";
import {
  COLUMN_HEADERS,
  CONTINUATION_TITLE,
  TABLE_TITLE,
  tableSizes,
  type PageSize,
} from "@/lib/slides-report/layout";
import { STATUS_COLORS } from "@/lib/slides-report/status";
import { reportWeekFromMonday } from "@/lib/slides-report/week";
import type { SlideRow } from "@/lib/slides-report/types";
import type { SlidesRequest } from "@/lib/google/slides";

const PAGE: PageSize = { width: 9144000, height: 5143500 };
const WEEK = reportWeekFromMonday("2026-09-07");

function row(overrides: Partial<SlideRow> = {}): SlideRow {
  return {
    focus: "[МП_Q3'2026] Индикаторы риска",
    tasks: ["Макеты", "Аналитика"],
    status: "green",
    thisWeek: "Макеты прошли чек",
    nextWeek: "Разработка фронта",
    ...overrides,
  };
}

function build(
  rows: SlideRow[],
  pageSize: PageSize = PAGE,
  extra: Partial<Pick<BuildSlideInput, "sizes" | "firstNumber" | "continuation">> = {}
): SlidesRequest[] {
  return buildWeekSlideRequests({
    slideId: "cw_20260907",
    idSuffix: "k1",
    pageSize,
    week: WEEK,
    rows,
    sizes: tableSizes(11, pageSize),
    ...extra,
  });
}

// Тело запроса — глубоко вложенный JSON; в тесте удобнее без приведения на каждом шаге.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;

function bodies(requests: SlidesRequest[], kind: string): Body[] {
  return requests.filter((r) => kind in r).map((r) => (r as Record<string, Body>)[kind]);
}

/** Тексты ячеек таблицы: «строка:колонка» → текст. */
function cellTexts(requests: SlidesRequest[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const b of bodies(requests, "insertText")) {
    if (b.cellLocation) map.set(`${b.cellLocation.rowIndex}:${b.cellLocation.columnIndex}`, b.text);
  }
  return map;
}

function cellStyle(requests: SlidesRequest[], rowIndex: number, columnIndex: number): Body {
  return bodies(requests, "updateTextStyle").find(
    (b) => b.cellLocation?.rowIndex === rowIndex && b.cellLocation?.columnIndex === columnIndex
  )?.style;
}

describe("buildWeekSlideRequests", () => {
  it("красит фон слайда", () => {
    const [page] = bodies(build([row()]), "updatePageProperties");
    expect(page.objectId).toBe("cw_20260907");
    expect(page.pageProperties.pageBackgroundFill.solidFill.color.rgbColor).toEqual(rgbColor("#F1F1F3"));
  });

  it("рисует плашку недели", () => {
    const requests = build([row()]);
    const shape = bodies(requests, "createShape").find((b) => b.objectId === "cw_20260907_k1_hdr");
    expect(shape.shapeType).toBe("ROUND_RECTANGLE");
    expect(shape.elementProperties.pageObjectId).toBe("cw_20260907");
    const text = bodies(requests, "insertText").find((b) => b.objectId === "cw_20260907_k1_hdr");
    expect(text.text).toBe("07.09.2026 - 11.09.2026");
  });

  it("рисует легенду: красный, жёлтый, зелёный с подписями", () => {
    const requests = build([row()]);
    const circles = bodies(requests, "createShape")
      .filter((b) => b.shapeType === "ELLIPSE")
      .map((b) => b.objectId);
    expect(circles).toEqual(["cw_20260907_k1_leg1", "cw_20260907_k1_leg2", "cw_20260907_k1_leg3"]);
    const fills = circles.map(
      (id) =>
        bodies(requests, "updateShapeProperties").find((b) => b.objectId === id).shapeProperties.shapeBackgroundFill
          .solidFill.color.rgbColor
    );
    expect(fills).toEqual([rgbColor(STATUS_COLORS.red), rgbColor(STATUS_COLORS.yellow), rgbColor(STATUS_COLORS.green)]);
    const labels = ["legt1", "legt2", "legt3"].map(
      (role) => bodies(requests, "insertText").find((b) => b.objectId === `cw_20260907_k1_${role}`).text
    );
    expect(labels).toEqual(["риск сработал", "есть риск", "риска нет"]);
  });

  it("создаёт таблицу 2 + N строк на 6 колонок", () => {
    const [table] = bodies(build([row(), row()]), "createTable");
    expect(table).toMatchObject({ objectId: "cw_20260907_k1_tbl", rows: 4, columns: 6 });
  });

  it("объединяет первую строку и пишет в неё заголовок жирным", () => {
    const requests = build([row()]);
    const [merge] = bodies(requests, "mergeTableCells");
    expect(merge.tableRange).toEqual({ location: { rowIndex: 0, columnIndex: 0 }, rowSpan: 1, columnSpan: 6 });
    expect(cellTexts(requests).get("0:0")).toBe(TABLE_TITLE);
    expect(cellStyle(requests, 0, 0).bold).toBe(true);
  });

  it("пишет заголовки колонок во вторую строку", () => {
    const texts = cellTexts(build([row()]));
    expect(COLUMN_HEADERS.map((_, c) => texts.get(`1:${c}`))).toEqual([...COLUMN_HEADERS]);
  });

  it("заполняет строки эпиков", () => {
    const texts = cellTexts(build([row(), row({ focus: "Второй" })]));
    expect(texts.get("2:0")).toBe("1");
    expect(texts.get("2:1")).toBe("[МП_Q3'2026] Индикаторы риска");
    expect(texts.get("2:2")).toBe("• Макеты\n• Аналитика");
    expect(texts.get("2:3")).toBe("●");
    expect(texts.get("2:4")).toBe("Макеты прошли чек");
    expect(texts.get("2:5")).toBe("Разработка фронта");
    expect(texts.get("3:0")).toBe("2");
    expect(texts.get("3:1")).toBe("Второй");
  });

  it("красит ● в цвет статуса", () => {
    const requests = build([row({ status: "red" }), row({ status: "yellow" }), row({ status: "green" })]);
    const colors = [2, 3, 4].map((r) => cellStyle(requests, r, 3).foregroundColor.opaqueColor.rgbColor);
    expect(colors).toEqual([rgbColor(STATUS_COLORS.red), rgbColor(STATUS_COLORS.yellow), rgbColor(STATUS_COLORS.green)]);
  });

  it("не трогает пустые ячейки", () => {
    const requests = build([row({ tasks: [], thisWeek: "" })]);
    const texts = cellTexts(requests);
    expect(texts.has("2:2")).toBe(false);
    expect(texts.has("2:4")).toBe(false);
    expect(cellStyle(requests, 2, 4)).toBeUndefined();
  });

  it("берёт кегли таблицы из раскладки", () => {
    const requests = build([row()], PAGE, { sizes: tableSizes(8, PAGE) });
    expect(cellStyle(requests, 2, 1).fontSize.magnitude).toBe(8);
    expect(cellStyle(requests, 1, 3).fontSize.magnitude).toBe(8);
    expect(cellStyle(requests, 2, 3).fontSize.magnitude).toBe(13); // кружок = 1.6 × текст
    expect(cellStyle(requests, 0, 0).fontSize.magnitude).toBe(14);
  });

  it("слайд-продолжение: заголовок с пометкой, нумерация эпиков сквозная", () => {
    const texts = cellTexts(build([row(), row()], PAGE, { firstNumber: 6, continuation: true }));
    expect(texts.get("0:0")).toBe(CONTINUATION_TITLE);
    expect(texts.get("2:0")).toBe("6");
    expect(texts.get("3:0")).toBe("7");
  });

  it("ширины колонок не меньше 32 pt — меньше API не примет", () => {
    const widths = bodies(build([row()]), "updateTableColumnProperties").map(
      (b) => b.tableColumnProperties.columnWidth.magnitude
    );
    expect(widths).toHaveLength(6);
    widths.forEach((w) => expect(w).toBeGreaterThanOrEqual(406400));
  });

  it("id элементов уникальны и подходят под правила Slides API", () => {
    const requests = build([row()]);
    const ids = [...bodies(requests, "createShape"), ...bodies(requests, "createTable")].map((b) => b.objectId);
    expect(new Set(ids).size).toBe(ids.length);
    ids.forEach((id) => expect(id).toMatch(/^[a-zA-Z0-9_][a-zA-Z0-9_:-]{4,49}$/));
  });

  it("шрифт заголовков колонок не крупнее 9 pt — иначе «Статус» рвётся посередине", () => {
    const requests = build([row()]);
    expect(cellStyle(requests, 1, 3).fontSize.magnitude).toBe(9);
    // Тело таблицы при ≤5 эпиках остаётся на своей ступени — 11 pt.
    expect(cellStyle(requests, 2, 1).fontSize.magnitude).toBe(11);
  });

  it("последняя подпись легенды помещается в ширину страницы", () => {
    const requests = build([row()]);
    const label = bodies(requests, "createShape").find((b) => b.objectId === "cw_20260907_k1_legt3");
    const right = label.elementProperties.transform.translateX + label.elementProperties.size.width.magnitude;
    expect(right).toBeLessThanOrEqual(PAGE.width);
  });

  it("порядок: объединение первой строки — после стилизации всей таблицы и до заголовка", () => {
    const requests = build([row(), row()]);
    const wholeCellIdx = requests.findIndex((r) => "updateTableCellProperties" in r);
    const borderIdx = requests.findIndex((r) => "updateTableBorderProperties" in r);
    const mergeIdx = requests.findIndex((r) => "mergeTableCells" in r);
    const titleIdx = requests.findIndex(
      (r) =>
        "insertText" in r &&
        (r as Body).insertText.cellLocation?.rowIndex === 0 &&
        (r as Body).insertText.cellLocation?.columnIndex === 0
    );

    expect(mergeIdx).toBeGreaterThan(wholeCellIdx);
    expect(mergeIdx).toBeGreaterThan(borderIdx);
    expect(mergeIdx).toBeLessThan(titleIdx);

    const touchesHeaderCells = requests.slice(mergeIdx + 1).some((r) => {
      const body = Object.values(r)[0] as Body;
      const loc = body?.cellLocation ?? body?.tableRange?.location;
      return loc && loc.rowIndex === 0 && loc.columnIndex >= 1 && loc.columnIndex <= 5;
    });
    expect(touchesHeaderCells).toBe(false);
  });
});
