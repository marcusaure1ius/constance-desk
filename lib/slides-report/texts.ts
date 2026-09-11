import type { DraftTask } from "./types";

export type EpicTexts = {
  /** Ячейка «Задачи»: все отмеченные задачи эпика. */
  tasks: string[];
  /** «Текущая неделя»: закрытые на неделе отчёта, по одной на строку. */
  thisWeek: string;
  /** «Следующая неделя»: открытые, по одной на строку. */
  nextWeek: string;
};

/** Тексты строки эпика из отмеченных задач. Порядок задач сохраняется. */
export function buildEpicTexts(tasks: DraftTask[]): EpicTexts {
  return {
    tasks: tasks.map((t) => t.title),
    thisWeek: tasks.filter((t) => t.doneThisWeek).map((t) => t.title).join("\n"),
    nextWeek: tasks.filter((t) => !t.completedAt).map((t) => t.title).join("\n"),
  };
}
