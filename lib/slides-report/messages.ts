/** Тексты уведомлений после выгрузки. */

/** «Слайд за 07.09–11.09 обновлён» или «Слайды за … обновлены (3 слайда)». */
export function exportDoneMessage(shortLabel: string, slideCount: number): string {
  if (slideCount <= 1) return `Слайд за ${shortLabel} обновлён`;
  return `Слайды за ${shortLabel} обновлены (${slideCount} ${slidesWord(slideCount)})`;
}

/** Предупреждение про эпики, которые вылезают за слайд даже по одному. */
export function oversizedMessage(names: string[]): string {
  const list = names.map((name) => `«${name}»`).join(", ");
  return names.length === 1
    ? `Эпик ${list} не помещается на слайд — сократите текст`
    : `Эпики ${list} не помещаются на слайд — сократите текст`;
}

function slidesWord(n: number): string {
  const lastTwo = n % 100;
  const last = n % 10;
  if (lastTwo >= 11 && lastTwo <= 14) return "слайдов";
  if (last === 1) return "слайд";
  if (last >= 2 && last <= 4) return "слайда";
  return "слайдов";
}
