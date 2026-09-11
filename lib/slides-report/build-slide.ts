import type { SlidesRequest } from "@/lib/google/slides";
import {
  COLUMN_HEADERS,
  CONTINUATION_TITLE,
  STATUS_COLUMN,
  TABLE_BOX,
  TABLE_TITLE,
  columnWidthsEmu,
  formatTasksCell,
  scaledPt,
  type PageSize,
  type TableSizes,
} from "./layout";
import { STATUS_COLORS, STATUS_LABELS } from "./status";
import type { EpicStatus, ReportWeek, SlideRow } from "./types";

/**
 * Шаблон недельного слайда.
 *
 * Внешний вид — здесь: плашка, легенда, цвета, шрифт, оформление таблицы.
 * Геометрию таблицы и кегли решает раскладка (`./layout`): она знает, сколько
 * текста влезет на слайд. Функция чистая и возвращает список запросов
 * batchUpdate, поэтому шаблон проверяется тестами без Google.
 */

const FONT_FAMILY = "Proxima Nova";
const COLORS = {
  background: "#F1F1F3",
  border: "#D0D0D0",
  text: "#222222",
  white: "#FFFFFF",
} as const;

const LEGEND_ORDER: EpicStatus[] = ["red", "yellow", "green"];
const TEXT_STYLE_FIELDS = "fontFamily,fontSize,foregroundColor,bold";

export type BuildSlideInput = {
  slideId: string;
  /** Свежий на каждую выгрузку: новые элементы не пересекаются с только что удалёнными. */
  idSuffix: string;
  pageSize: PageSize;
  week: ReportWeek;
  rows: SlideRow[];
  /** Кегли таблицы из раскладки — одинаковые на всех слайдах недели. */
  sizes: TableSizes;
  /** Номер первого эпика на слайде: на продолжениях нумерация сквозная. */
  firstNumber?: number;
  /** Слайд-продолжение: заголовок таблицы с пометкой. */
  continuation?: boolean;
};

type Box = { x: number; y: number; w: number; h: number };
type Align = "START" | "CENTER";

/** `#E03C31` → доли 0…1, как их ждёт Slides API. */
export function rgbColor(hex: string): { red: number; green: number; blue: number } {
  const n = parseInt(hex.slice(1), 16);
  return { red: ((n >> 16) & 255) / 255, green: ((n >> 8) & 255) / 255, blue: (n & 255) / 255 };
}

export function buildWeekSlideRequests(input: BuildSlideInput): SlidesRequest[] {
  const { slideId, idSuffix, pageSize: page, week, rows, sizes, firstNumber = 1, continuation = false } = input;
  const id = (role: string) => `${slideId}_${idSuffix}_${role}`;
  const pt = (size: number) => scaledPt(size, page);
  const requests: SlidesRequest[] = [];

  requests.push({
    updatePageProperties: {
      objectId: slideId,
      pageProperties: { pageBackgroundFill: { solidFill: { color: solid(COLORS.background) } } },
      fields: "pageBackgroundFill.solidFill.color",
    },
  });

  // Плашка недели — слева сверху, как на рабочем слайде.
  const badge: Box = { x: page.width * 0.03, y: page.height * 0.03, w: page.width * 0.28, h: page.height * 0.06 };
  requests.push(
    ...shape({
      objectId: id("hdr"),
      slideId,
      shapeType: "ROUND_RECTANGLE",
      box: badge,
      fill: STATUS_COLORS.red,
      text: { value: week.label, size: pt(14), color: COLORS.white, align: "CENTER" },
    })
  );

  // Легенда — в одну линию правее плашки.
  const dot = page.height * 0.05;
  const labelWidth = page.width * 0.16;
  let x = page.width * 0.33;
  LEGEND_ORDER.forEach((status, i) => {
    requests.push(
      ...shape({
        objectId: id(`leg${i + 1}`),
        slideId,
        shapeType: "ELLIPSE",
        box: { x, y: badge.y + (badge.h - dot) / 2, w: dot, h: dot },
        fill: STATUS_COLORS[status],
      })
    );
    x += dot + page.width * 0.005;
    requests.push(
      ...shape({
        objectId: id(`legt${i + 1}`),
        slideId,
        shapeType: "TEXT_BOX",
        box: { x, y: badge.y, w: labelWidth, h: badge.h },
        text: { value: STATUS_LABELS[status], size: pt(13), color: COLORS.text, align: "START" },
      })
    );
    x += labelWidth + page.width * 0.02;
  });

  requests.push(
    ...table({
      slideId,
      tableId: id("tbl"),
      page,
      rows,
      sizes,
      firstNumber,
      title: continuation ? CONTINUATION_TITLE : TABLE_TITLE,
    })
  );
  return requests;
}

function shape(o: {
  objectId: string;
  slideId: string;
  shapeType: "ROUND_RECTANGLE" | "ELLIPSE" | "TEXT_BOX";
  box: Box;
  fill?: string;
  text?: { value: string; size: number; color: string; align: Align };
}): SlidesRequest[] {
  const out: SlidesRequest[] = [
    { createShape: { objectId: o.objectId, shapeType: o.shapeType, elementProperties: placement(o.slideId, o.box) } },
    {
      updateShapeProperties: {
        objectId: o.objectId,
        shapeProperties: {
          ...(o.fill ? { shapeBackgroundFill: { solidFill: { color: solid(o.fill) } } } : {}),
          outline: { propertyState: "NOT_RENDERED" },
          contentAlignment: "MIDDLE",
        },
        fields: [...(o.fill ? ["shapeBackgroundFill.solidFill.color"] : []), "outline.propertyState", "contentAlignment"].join(","),
      },
    },
  ];
  if (o.text) {
    out.push(
      { insertText: { objectId: o.objectId, text: o.text.value, insertionIndex: 0 } },
      {
        updateTextStyle: {
          objectId: o.objectId,
          textRange: { type: "ALL" },
          style: textStyle(o.text.size, o.text.color, false),
          fields: TEXT_STYLE_FIELDS,
        },
      },
      {
        updateParagraphStyle: {
          objectId: o.objectId,
          textRange: { type: "ALL" },
          style: { alignment: o.text.align },
          fields: "alignment",
        },
      }
    );
  }
  return out;
}

function table(o: {
  slideId: string;
  tableId: string;
  page: PageSize;
  rows: SlideRow[];
  sizes: TableSizes;
  firstNumber: number;
  title: string;
}): SlidesRequest[] {
  const { slideId, tableId, page, rows, sizes, firstNumber, title } = o;
  const rowCount = rows.length + 2;
  const columnCount = COLUMN_HEADERS.length;
  const whole = { location: { rowIndex: 0, columnIndex: 0 }, rowSpan: rowCount, columnSpan: columnCount };

  const out: SlidesRequest[] = [
    {
      createTable: {
        objectId: tableId,
        // Высота — стартовая: строки дорастут по тексту сами.
        elementProperties: placement(slideId, {
          x: page.width * TABLE_BOX.x,
          y: page.height * TABLE_BOX.y,
          w: page.width * TABLE_BOX.width,
          h: page.height * 0.05 * rowCount,
        }),
        rows: rowCount,
        columns: columnCount,
      },
    },
  ];

  columnWidthsEmu(page).forEach((width, columnIndex) =>
    out.push({
      updateTableColumnProperties: {
        objectId: tableId,
        columnIndices: [columnIndex],
        tableColumnProperties: { columnWidth: emu(width) },
        fields: "columnWidth",
      },
    })
  );

  out.push(
    {
      updateTableCellProperties: {
        objectId: tableId,
        tableRange: whole,
        tableCellProperties: {
          tableCellBackgroundFill: { solidFill: { color: solid(COLORS.background) } },
          contentAlignment: "TOP",
        },
        fields: "tableCellBackgroundFill.solidFill.color,contentAlignment",
      },
    },
    {
      updateTableBorderProperties: {
        objectId: tableId,
        tableRange: whole,
        borderPosition: "ALL",
        tableBorderProperties: {
          tableBorderFill: { solidFill: { color: solid(COLORS.border) } },
          weight: { magnitude: 1, unit: "PT" },
          dashStyle: "SOLID",
        },
        fields: "tableBorderFill.solidFill.color,weight,dashStyle",
      },
    },
    verticalAlign(tableId, { location: { rowIndex: 1, columnIndex: 0 }, rowSpan: 1, columnSpan: columnCount })
  );
  if (rows.length > 0) {
    out.push(
      verticalAlign(tableId, { location: { rowIndex: 2, columnIndex: STATUS_COLUMN }, rowSpan: rows.length, columnSpan: 1 })
    );
  }

  out.push({
    mergeTableCells: {
      objectId: tableId,
      tableRange: { location: { rowIndex: 0, columnIndex: 0 }, rowSpan: 1, columnSpan: columnCount },
    },
  });
  out.push(...cellText(tableId, 0, 0, title, { size: sizes.title, bold: true }));
  COLUMN_HEADERS.forEach((header, c) =>
    out.push(...cellText(tableId, 1, c, header, { size: sizes.header, bold: true, align: "CENTER" }))
  );

  rows.forEach((row, i) => {
    const r = i + 2;
    const text = { size: sizes.text };
    out.push(
      ...cellText(tableId, r, 0, String(firstNumber + i), { ...text, align: "CENTER" }),
      ...cellText(tableId, r, 1, row.focus, text),
      ...cellText(tableId, r, 2, formatTasksCell(row.tasks), text),
      ...cellText(tableId, r, STATUS_COLUMN, "●", { size: sizes.dot, align: "CENTER", color: STATUS_COLORS[row.status] }),
      ...cellText(tableId, r, 4, row.thisWeek, text),
      ...cellText(tableId, r, 5, row.nextWeek, text)
    );
  });

  return out;
}

/** Текст ячейки со стилем. Пустую ячейку не трогаем: ни вставлять, ни красить в ней нечего. */
function cellText(
  tableId: string,
  rowIndex: number,
  columnIndex: number,
  text: string,
  o: { size: number; bold?: boolean; align?: Align; color?: string }
): SlidesRequest[] {
  if (!text) return [];
  const cellLocation = { rowIndex, columnIndex };
  const out: SlidesRequest[] = [
    { insertText: { objectId: tableId, cellLocation, text, insertionIndex: 0 } },
    {
      updateTextStyle: {
        objectId: tableId,
        cellLocation,
        textRange: { type: "ALL" },
        style: textStyle(o.size, o.color ?? COLORS.text, o.bold ?? false),
        fields: TEXT_STYLE_FIELDS,
      },
    },
  ];
  if (o.align === "CENTER") {
    out.push({
      updateParagraphStyle: {
        objectId: tableId,
        cellLocation,
        textRange: { type: "ALL" },
        style: { alignment: "CENTER" },
        fields: "alignment",
      },
    });
  }
  return out;
}

function verticalAlign(tableId: string, tableRange: Record<string, unknown>): SlidesRequest {
  return {
    updateTableCellProperties: {
      objectId: tableId,
      tableRange,
      tableCellProperties: { contentAlignment: "MIDDLE" },
      fields: "contentAlignment",
    },
  };
}

function placement(pageObjectId: string, box: Box) {
  return {
    pageObjectId,
    size: { width: emu(box.w), height: emu(box.h) },
    transform: { scaleX: 1, scaleY: 1, translateX: Math.round(box.x), translateY: Math.round(box.y), unit: "EMU" },
  };
}

function emu(value: number) {
  return { magnitude: Math.round(value), unit: "EMU" };
}

function solid(hex: string) {
  return { rgbColor: rgbColor(hex) };
}

function textStyle(size: number, color: string, bold: boolean) {
  return {
    fontFamily: FONT_FAMILY,
    fontSize: { magnitude: size, unit: "PT" },
    foregroundColor: { opaqueColor: { rgbColor: rgbColor(color) } },
    bold,
  };
}
