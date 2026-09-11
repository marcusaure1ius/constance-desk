/**
 * Ошибка выгрузки в Google, текст которой можно показать пользователю как
 * есть. Всё сверх этого (код, тело ответа) уходит в console.error, а не в
 * интерфейс.
 *
 * Отдельным файлом, чтобы `auth.ts` и `slides.ts` не импортировали друг друга.
 */
export class GoogleSlidesError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoogleSlidesError";
  }
}

export const GOOGLE_MESSAGES = {
  config:
    "Не настроен доступ к Google: задайте GOOGLE_SERVICE_ACCOUNT_KEY и GOOGLE_SLIDES_PRESENTATION_ID",
  badKey: "Ключ сервисного аккаунта не принят Google",
  forbidden: (email: string) =>
    `Нет доступа к презентации — поделитесь ею с ${email} как с редактором`,
  apiDisabled:
    "Google Slides API не включён в проекте сервисного аккаунта — включите его в Google Cloud Console (APIs & Services → Library)",
  notFound:
    "Презентация не найдена — проверьте GOOGLE_SLIDES_PRESENTATION_ID и что она открыта для сервисного аккаунта",
  unavailable: "Google временно недоступен, повторите позже",
  rejected: (detail: string) => `Google отклонил изменения слайда: ${detail}`,
} as const;
