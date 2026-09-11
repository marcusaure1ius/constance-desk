/**
 * Даты недельного слайда — строки `YYYY-MM-DD` и арифметика в UTC.
 *
 * Строки, а не Date, потому что «сегодня» приходит из браузера: сервер на
 * Vercel живёт в UTC и в пятницу до 03:00 по Москве посчитал бы четверг.
 * Считаем в UTC, чтобы результат не зависел от часового пояса машины, где
 * крутится код: браузер, сервер, CI.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function toUtc(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

function fromUtc(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Строка вида `2026-09-11`, и такая дата существует (не `2026-02-30`). */
export function isIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return (
    date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
  );
}

/** День недели: 0 — воскресенье, 1 — понедельник … 6 — суббота. */
export function dayOfWeek(iso: string): number {
  return toUtc(iso).getUTCDay();
}

export function addDaysIso(iso: string, days: number): string {
  const date = toUtc(iso);
  date.setUTCDate(date.getUTCDate() + days);
  return fromUtc(date);
}

/** Как `addBusinessDays` из date-fns: суббота и воскресенье не считаются. */
export function addBusinessDaysIso(iso: string, days: number): string {
  let current = iso;
  let left = days;
  while (left > 0) {
    current = addDaysIso(current, 1);
    const dow = dayOfWeek(current);
    if (dow !== 0 && dow !== 6) left--;
  }
  return current;
}

/** `2026-09-07` → `07.09.2026`. */
export function formatDmy(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

/** `2026-09-07` → `07.09`. */
export function formatDm(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${d}.${m}`;
}

/** Полночь UTC этой даты — граница окна «закрыта на неделе». */
export function utcMidnight(iso: string): Date {
  return toUtc(iso);
}
