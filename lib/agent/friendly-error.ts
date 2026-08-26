/**
 * Человеческие формулировки ошибок агента для ленты.
 *
 * Событие `error` и упавший `fetch` несут сырой текст — статус провайдера,
 * причину 401, обрывки стека («Не настроен ни один провайдер модели: …»).
 * Пользователю это ни о чём не говорит и читается как поломка кода: сырой
 * текст остаётся в консоли (`console.error`), в ленте — понятная строка.
 */

export const AGENT_UNAVAILABLE_MESSAGE = "Модель недоступна. Попробуйте ещё раз.";
export const SESSION_EXPIRED_MESSAGE = "Сессия истекла — войдите заново.";

/** Формулировка по статусу ответа `fetch` на роут агента. */
export function fetchErrorMessage(status: number): string {
  if (status === 401) return SESSION_EXPIRED_MESSAGE;
  return AGENT_UNAVAILABLE_MESSAGE;
}
