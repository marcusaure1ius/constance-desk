import { GOOGLE_MESSAGES, GoogleSlidesError } from "@/lib/google/errors";
import { batchUpdate, getPresentation, type Dimension, type Presentation, type SlidesRequest } from "@/lib/google/slides";
import { buildWeekSlideRequests } from "@/lib/slides-report/build-slide";
import { EMU_PER_PT, planSlides, type PageSize } from "@/lib/slides-report/layout";
import type { ExportPayload } from "@/lib/slides-report/types";
import { reportWeekFromMonday, slideIdForWeek } from "@/lib/slides-report/week";

/** Стандартный 16:9 — на случай, если Google не вернул размер страницы. */
const DEFAULT_PAGE: PageSize = { width: 9144000, height: 5143500 };

export type ExportWeekSlideOutcome = {
  /** Ссылка на основной слайд недели. */
  url: string;
  /** Сколько слайдов заняла неделя вместе с продолжениями. */
  slideCount: number;
  /** Эпики, которые не влезают на слайд даже одни. */
  oversized: string[];
};

/**
 * Выгрузка слайдов недели.
 *
 * Основной слайд ищется по предсказуемому ID (`cw_20260907`). Нет — создаётся
 * первым в презентации: свежая неделя сверху. Есть — очищается от элементов
 * и рисуется заново, оставаясь на своём месте.
 *
 * Если таблица не влезает, раскладка отдаёт несколько страниц, и за основным
 * слайдом встают продолжения `cw_20260907_p2_<суффикс>`. Суффикс свежий на
 * каждую выгрузку: старые продолжения этой недели удаляются целиком, новые
 * создаются заново, и ID не пересекаются в одном запросе.
 *
 * Всё уходит одним batchUpdate: он атомарен, и при ошибке слайды остаются
 * прежними, а не наполовину стёртыми.
 *
 * `createSlide` без `slideLayoutReference`: тогда API берёт пустой макет и не
 * падает на темах, где макета BLANK нет.
 */
export async function exportWeekSlide(payload: ExportPayload): Promise<ExportWeekSlideOutcome> {
  const presentationId = process.env.GOOGLE_SLIDES_PRESENTATION_ID?.trim();
  if (!presentationId) throw new GoogleSlidesError(GOOGLE_MESSAGES.config);

  const week = reportWeekFromMonday(payload.weekMonday);
  const mainId = slideIdForWeek(week.monday);
  const continuationPrefix = `${mainId}_p`;
  const presentation = await getPresentation(presentationId);
  const slides = presentation.slides ?? [];
  const page = pageSizeInEmu(presentation);
  const plan = planSlides(payload.rows, page);
  const suffix = Date.now().toString(36);

  const isOldContinuation = (objectId: string) => objectId.startsWith(continuationPrefix);
  const requests: SlidesRequest[] = slides
    .filter((slide) => isOldContinuation(slide.objectId))
    .map((slide) => ({ deleteObject: { objectId: slide.objectId } }));

  // Где окажется основной слайд, когда старые продолжения уже удалены.
  const mainIndex = slides.findIndex((slide) => slide.objectId === mainId);
  let mainPosition = 0;
  if (mainIndex >= 0) {
    const main = slides[mainIndex];
    requests.push(...(main.pageElements ?? []).map((element) => ({ deleteObject: { objectId: element.objectId } })));
    mainPosition = mainIndex - slides.slice(0, mainIndex).filter((slide) => isOldContinuation(slide.objectId)).length;
  } else {
    requests.push({ createSlide: { objectId: mainId, insertionIndex: 0 } });
  }

  let firstNumber = 1;
  plan.pages.forEach((rows, i) => {
    const slideId = i === 0 ? mainId : `${continuationPrefix}${i + 1}_${suffix}`;
    if (i > 0) requests.push({ createSlide: { objectId: slideId, insertionIndex: mainPosition + i } });
    requests.push(
      ...buildWeekSlideRequests({
        slideId,
        idSuffix: suffix,
        pageSize: page,
        week,
        rows,
        sizes: plan.sizes,
        firstNumber,
        continuation: i > 0,
      })
    );
    firstNumber += rows.length;
  });

  await batchUpdate(presentationId, requests);
  return {
    url: `https://docs.google.com/presentation/d/${presentationId}/edit#slide=id.${mainId}`,
    slideCount: plan.pages.length,
    oversized: plan.oversized,
  };
}

function pageSizeInEmu(presentation: Presentation): PageSize {
  const toEmu = (d: Dimension | undefined) => (d?.magnitude ?? 0) * (d?.unit === "PT" ? EMU_PER_PT : 1);
  return {
    width: toEmu(presentation.pageSize?.width) || DEFAULT_PAGE.width,
    height: toEmu(presentation.pageSize?.height) || DEFAULT_PAGE.height,
  };
}
