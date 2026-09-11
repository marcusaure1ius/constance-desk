import { addDaysIso, dayOfWeek, formatDm, formatDmy } from "./dates";
import type { ReportWeek } from "./types";

/**
 * Неделя, за которую собирается слайд.
 *
 * Слайд готовят в пятницу, а иногда — в начале следующей недели. Поэтому с
 * пятницы по воскресенье берётся текущая неделя, а с понедельника по четверг —
 * прошлая: в понедельник 14.09 отчитываются за 07.09–11.09, а не за неделю,
 * которая только началась.
 */
export function getReportWeek(today: string): ReportWeek {
  const dow = dayOfWeek(today);
  const currentMonday = addDaysIso(today, -((dow + 6) % 7));
  const weekIsOver = dow === 5 || dow === 6 || dow === 0;
  return reportWeekFromMonday(weekIsOver ? currentMonday : addDaysIso(currentMonday, -7));
}

/** Неделя по её понедельнику: пятница и подписи. */
export function reportWeekFromMonday(monday: string): ReportWeek {
  const friday = addDaysIso(monday, 4);
  return {
    monday,
    friday,
    label: `${formatDmy(monday)} - ${formatDmy(friday)}`,
    shortLabel: `${formatDm(monday)}–${formatDm(friday)}`,
  };
}

/** ID слайда недели: по нему повторная выгрузка находит «свой» слайд. */
export function slideIdForWeek(monday: string): string {
  return `cw_${monday.replaceAll("-", "")}`;
}
