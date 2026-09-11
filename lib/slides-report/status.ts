import { addBusinessDaysIso } from "./dates";
import type { DraftTask, EpicStatus } from "./types";

/** Цвета статусов — общие для кружков в модалке, легенды и таблицы слайда. */
export const STATUS_COLORS: Record<EpicStatus, string> = {
  red: "#E03C31",
  yellow: "#E8B931",
  green: "#6A9A45",
};

/** Подписи легенды на слайде. */
export const STATUS_LABELS: Record<EpicStatus, string> = {
  red: "риск сработал",
  yellow: "есть риск",
  green: "риска нет",
};

/** Сколько рабочих дней до срока уже считается риском не успеть. */
const RISK_BUSINESS_DAYS = 2;

/**
 * Статус эпика по отмеченным задачам.
 *
 * Закрытые задачи на статус не влияют: закрытая с опозданием — уже не риск.
 * Открытая без срока — тоже не риск: судить не по чему.
 */
export function computeEpicStatus(tasks: DraftTask[], today: string): EpicStatus {
  const riskEdge = addBusinessDaysIso(today, RISK_BUSINESS_DAYS);
  let status: EpicStatus = "green";
  for (const task of tasks) {
    if (task.completedAt || !task.plannedDate) continue;
    if (task.plannedDate < today) return "red";
    if (task.plannedDate <= riskEdge) status = "yellow";
  }
  return status;
}

/** Открыта, и срок уже прошёл — для пометки ⚠ в модалке. */
export function isOverdue(task: DraftTask, today: string): boolean {
  return !task.completedAt && task.plannedDate !== null && task.plannedDate < today;
}
