import { exportPayloadSchema, type ExportPayload } from "./types";

/**
 * Понятная причина отказа для payload выгрузки слайда.
 *
 * Чистый модуль: то же, что `build-slide.ts` — ни `db`, ни Next.js, ни
 * `lib/google/*`, чтобы модалка (клиентский компонент) могла проверить
 * данные до похода на сервер.
 *
 * Реальные данные доски могут упереться в лимиты схемы (эпик с полусотней
 * открытых задач, заголовок задачи без ограничения в приложении), и
 * «Данные слайда не прошли проверку» на любой из этих причин ничего не
 * объясняет. Здесь — по конкретному пути ошибки zod к тексту, который можно
 * показать пользователю.
 */

const GENERIC_ERROR = "Данные слайда не прошли проверку";

type PayloadIssue = { path: PropertyKey[]; code: string };

/** `payload.rows[i].focus`, а если его нет — «№i» (сам payload уже мог не пройти проверку). */
function epicLabel(payload: ExportPayload, index: number): string {
  const focus = payload.rows[index]?.focus;
  return focus || `№${index + 1}`;
}

export function explainPayloadError(payload: ExportPayload, issues: readonly PayloadIssue[]): string {
  const issue = issues[0];
  if (!issue) return GENERIC_ERROR;
  const path = issue.path;

  if (path.length === 1 && path[0] === "rows") {
    if (issue.code === "too_small") return "Отметьте хотя бы один эпик";
    if (issue.code === "too_big") return "Больше 40 эпиков — снимите лишние";
    return GENERIC_ERROR;
  }

  if (path[0] === "rows" && typeof path[1] === "number") {
    const epic = epicLabel(payload, path[1]);
    if (path.length === 3 && path[2] === "tasks") return `Эпик «${epic}»: больше 50 задач — снимите лишние галочки`;
    if (path.length === 4 && path[2] === "tasks") return `Эпик «${epic}»: название задачи длиннее 500 символов`;
    if (path.length === 3 && path[2] === "thisWeek")
      return `Эпик «${epic}»: текст «Текущая неделя» длиннее 3000 символов`;
    if (path.length === 3 && path[2] === "nextWeek")
      return `Эпик «${epic}»: текст «Следующая неделя» длиннее 3000 символов`;
    if (path.length === 3 && path[2] === "focus") return "Название эпика длиннее 300 символов";
  }

  return GENERIC_ERROR;
}

export function validateExportPayload(
  payload: ExportPayload
): { ok: true; data: ExportPayload } | { ok: false; error: string } {
  const parsed = exportPayloadSchema.safeParse(payload);
  if (parsed.success) return { ok: true, data: parsed.data };
  return { ok: false, error: explainPayloadError(payload, parsed.error.issues) };
}
