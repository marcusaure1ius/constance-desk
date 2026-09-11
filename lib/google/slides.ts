import { getGoogleAccess } from "./auth";
import { GOOGLE_MESSAGES, GoogleSlidesError } from "./errors";

export const SLIDES_API = "https://slides.googleapis.com/v1/presentations";

export type Dimension = { magnitude?: number; unit?: "EMU" | "PT" };

/** Ровно те поля, которые запрашиваем в `getPresentation`. */
export type Presentation = {
  pageSize: { width: Dimension; height: Dimension };
  slides?: { objectId: string; pageElements?: { objectId: string }[] }[];
};

type SlidesRequestKind =
  | "createSlide"
  | "deleteObject"
  | "updatePageProperties"
  | "createShape"
  | "updateShapeProperties"
  | "insertText"
  | "updateTextStyle"
  | "updateParagraphStyle"
  | "createTable"
  | "mergeTableCells"
  | "updateTableColumnProperties"
  | "updateTableCellProperties"
  | "updateTableBorderProperties";

/**
 * Один запрос batchUpdate — объект с одним ключом из используемых видов.
 * Поля внутри — как в REST-документации Slides API. Полные типы всех 40 с
 * лишним видов запросов ради дюжины используемых не заводим.
 */
export type SlidesRequest = Partial<Record<SlidesRequestKind, Record<string, unknown>>>;

export async function getPresentation(presentationId: string): Promise<Presentation> {
  const fields = "pageSize,slides(objectId,pageElements(objectId))";
  const url = `${SLIDES_API}/${encodeURIComponent(presentationId)}?fields=${encodeURIComponent(fields)}`;
  return (await callSlides(url, { method: "GET" })) as Presentation;
}

/** Атомарно: либо применятся все запросы, либо ни один. */
export async function batchUpdate(presentationId: string, requests: SlidesRequest[]): Promise<void> {
  await callSlides(`${SLIDES_API}/${encodeURIComponent(presentationId)}:batchUpdate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ requests }),
  });
}

async function callSlides(url: string, init: RequestInit): Promise<unknown> {
  const { accessToken, clientEmail } = await getGoogleAccess();
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: { ...(init.headers as Record<string, string> | undefined), Authorization: `Bearer ${accessToken}` },
    });
  } catch (err) {
    console.error("[google] запрос к Slides не дошёл", err);
    throw new GoogleSlidesError(GOOGLE_MESSAGES.unavailable);
  }

  if (!response.ok) {
    const body = await response.text();
    console.error("[google] slides", response.status, body);
    throw new GoogleSlidesError(slidesErrorMessage(response.status, body, clientEmail));
  }
  return response.json();
}

/** Ответ Slides API с ошибкой → текст для пользователя. */
const SERVICE_DISABLED = /SERVICE_DISABLED|accessNotConfigured|has not been used in project/;

export function slidesErrorMessage(status: number, body: string, clientEmail: string): string {
  if (status === 401) return GOOGLE_MESSAGES.badKey;
  if (status === 403) return SERVICE_DISABLED.test(body) ? GOOGLE_MESSAGES.apiDisabled : GOOGLE_MESSAGES.forbidden(clientEmail);
  if (status === 404) return GOOGLE_MESSAGES.notFound;
  if (status === 429 || status >= 500) return GOOGLE_MESSAGES.unavailable;
  return GOOGLE_MESSAGES.rejected(extractGoogleMessage(body) ?? `HTTP ${status}`);
}

function extractGoogleMessage(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as { error?: { message?: unknown } };
    return typeof parsed.error?.message === "string" ? parsed.error.message : null;
  } catch {
    return null;
  }
}
