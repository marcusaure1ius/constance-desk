"use server";

import { GoogleSlidesError } from "@/lib/google/errors";
import { getSlidesDraft } from "@/lib/services/slides-draft";
import { exportWeekSlide } from "@/lib/services/slides-export";
import { isIsoDate } from "@/lib/slides-report/dates";
import { exportPayloadSchema, type ExportPayload, type SlidesDraft } from "@/lib/slides-report/types";
import { explainPayloadError } from "@/lib/slides-report/validate";

export type ExportWeekSlideResult =
  | { ok: true; url: string; slideCount: number; oversized: string[] }
  | { ok: false; error: string };

/** Черновик для модалки. `today` — дата браузера: сервер живёт в UTC. */
export async function getSlidesDraftAction(environmentId: string, today: string): Promise<SlidesDraft> {
  if (!isIsoDate(today)) throw new Error("Дата «сегодня» должна быть в формате YYYY-MM-DD");
  return getSlidesDraft(environmentId, today);
}

/**
 * Возвращает результат, а не бросает: в продакшене Next.js подменяет текст
 * ошибки, брошенной из server action, на общий, и подсказка «поделитесь
 * презентацией с …» до модалки не дошла бы.
 */
export async function exportWeekSlideAction(payload: ExportPayload): Promise<ExportWeekSlideResult> {
  const parsed = exportPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    console.error("[slides] payload отклонён", parsed.error.issues);
    return { ok: false, error: explainPayloadError(payload, parsed.error.issues) };
  }
  try {
    return { ok: true, ...(await exportWeekSlide(parsed.data)) };
  } catch (err) {
    if (err instanceof GoogleSlidesError) return { ok: false, error: err.message };
    console.error("[slides] выгрузка упала", err);
    return { ok: false, error: "Не удалось выгрузить слайд" };
  }
}
