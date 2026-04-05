import PptxGenJS from "pptxgenjs";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import type { ExtendedWeeklyReport, ExtendedReportTask } from "@/lib/services/reports";

/** Цвета статусов */
const STATUS_COLORS = {
  done: "22c55e",
  inProgress: "eab308",
  new: "ef4444",
} as const;

/** Белый текст для бейджей */
const BADGE_TEXT_COLOR = "FFFFFF";

/** Определяем статус задачи */
function getTaskStatus(task: ExtendedReportTask): {
  label: string;
  color: string;
} {
  if (task.completedAt) return { label: "Готово", color: STATUS_COLORS.done };
  return { label: "В работе", color: STATUS_COLORS.inProgress };
}

/** Форматирует диапазон дат для заголовка */
function formatDateRange(weekStart: Date, weekEnd: Date): string {
  const start = format(new Date(weekStart), "d MMMM", { locale: ru });
  const end = format(new Date(weekEnd), "d MMMM yyyy", { locale: ru });
  return `${start} — ${end}`;
}

/** Строит строки таблицы: название задачи + бейдж статуса */
function buildTaskRows(
  tasks: ExtendedReportTask[],
): PptxGenJS.TableRow[] {
  return tasks.map((task) => {
    const { label, color } = getTaskStatus(task);
    return [
      {
        text: task.title,
        options: {
          fontSize: 10,
          color: "333333",
          valign: "middle" as const,
          border: { pt: 0.5, color: "E5E7EB" },
          margin: [4, 6, 4, 6] as [number, number, number, number],
        },
      },
      {
        text: label,
        options: {
          fontSize: 9,
          bold: true,
          color: BADGE_TEXT_COLOR,
          fill: { color },
          align: "center" as const,
          valign: "middle" as const,
          border: { pt: 0.5, color: "E5E7EB" },
          margin: [4, 4, 4, 4] as [number, number, number, number],
        },
      },
    ];
  });
}

/** Строит заголовок таблицы */
function buildHeaderRow(title: string): PptxGenJS.TableRow {
  return [
    {
      text: title,
      options: {
        colspan: 2,
        fontSize: 12,
        bold: true,
        color: "1F2937",
        fill: { color: "F3F4F6" },
        valign: "middle" as const,
        border: { pt: 0.5, color: "D1D5DB" },
        margin: [6, 6, 6, 6] as [number, number, number, number],
      },
    },
  ];
}

/**
 * Генерирует PPTX-файл из данных отчёта.
 * Возвращает Buffer с содержимым .pptx файла.
 */
export async function generateReportPptx(
  report: ExtendedWeeklyReport,
): Promise<Buffer> {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE"; // 13.33 x 7.5 inches

  const slide = pptx.addSlide();

  const dateRange = formatDateRange(report.weekStart, report.weekEnd);

  // --- Заголовок ---
  slide.addText(`Constance / ${dateRange}`, {
    x: 0.5,
    y: 0.3,
    w: 8,
    h: 0.5,
    fontSize: 20,
    bold: true,
    color: "1F2937",
  });

  // --- Легенда статусов (верхний правый угол) ---
  const legendItems: PptxGenJS.TextProps[] = [
    {
      text: "  Новая  ",
      options: {
        fontSize: 9,
        bold: true,
        color: BADGE_TEXT_COLOR,
        highlight: STATUS_COLORS.new,
      },
    },
    {
      text: "  ",
      options: { fontSize: 9 },
    },
    {
      text: "  В работе  ",
      options: {
        fontSize: 9,
        bold: true,
        color: BADGE_TEXT_COLOR,
        highlight: STATUS_COLORS.inProgress,
      },
    },
    {
      text: "  ",
      options: { fontSize: 9 },
    },
    {
      text: "  Готово  ",
      options: {
        fontSize: 9,
        bold: true,
        color: BADGE_TEXT_COLOR,
        highlight: STATUS_COLORS.done,
      },
    },
  ];

  slide.addText(legendItems, {
    x: 8.8,
    y: 0.35,
    w: 4,
    h: 0.4,
    align: "right",
  });

  // --- Таблица "Трек прошлых задач" (слева) ---
  const carryoverRows: PptxGenJS.TableRow[] = [
    buildHeaderRow("Трек прошлых задач"),
    ...buildTaskRows(report.carryoverTasks),
  ];

  // Если нет задач, показываем пустую строку
  if (report.carryoverTasks.length === 0) {
    carryoverRows.push([
      {
        text: "Нет задач",
        options: {
          colspan: 2,
          fontSize: 10,
          color: "9CA3AF",
          align: "center" as const,
          valign: "middle" as const,
          border: { pt: 0.5, color: "E5E7EB" },
          margin: [8, 6, 8, 6] as [number, number, number, number],
        },
      },
    ]);
  }

  slide.addTable(carryoverRows, {
    x: 0.5,
    y: 1.1,
    w: 5.9,
    colW: [4.5, 1.4],
    border: { pt: 0.5, color: "E5E7EB" },
    fontSize: 10,
  });

  // --- Таблица "Новые задачи" (справа) ---
  const newTaskRows: PptxGenJS.TableRow[] = [
    buildHeaderRow("Новые задачи"),
    ...buildTaskRows(report.newTasks),
  ];

  if (report.newTasks.length === 0) {
    newTaskRows.push([
      {
        text: "Нет задач",
        options: {
          colspan: 2,
          fontSize: 10,
          color: "9CA3AF",
          align: "center" as const,
          valign: "middle" as const,
          border: { pt: 0.5, color: "E5E7EB" },
          margin: [8, 6, 8, 6] as [number, number, number, number],
        },
      },
    ]);
  }

  slide.addTable(newTaskRows, {
    x: 6.8,
    y: 1.1,
    w: 5.9,
    colW: [4.5, 1.4],
    border: { pt: 0.5, color: "E5E7EB" },
    fontSize: 10,
  });

  // --- Экспорт в Buffer ---
  const output = await pptx.write({ outputType: "nodebuffer" });
  return output as Buffer;
}
