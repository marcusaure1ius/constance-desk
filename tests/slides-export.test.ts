import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/google/slides", () => ({ getPresentation: vi.fn(), batchUpdate: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: {} }));

import { batchUpdate, getPresentation, type Presentation } from "@/lib/google/slides";
import { GOOGLE_MESSAGES, GoogleSlidesError } from "@/lib/google/errors";
import { exportWeekSlide } from "@/lib/services/slides-export";
import { exportWeekSlideAction } from "@/lib/actions/slides";
import { CONTINUATION_TITLE } from "@/lib/slides-report/layout";
import type { ExportPayload, SlideRow } from "@/lib/slides-report/types";

const PAYLOAD: ExportPayload = {
  weekMonday: "2026-09-07",
  rows: [{ focus: "Эпик", tasks: ["Задача"], status: "green", thisWeek: "", nextWeek: "Задача" }],
};
const SLIDE_URL = "https://docs.google.com/presentation/d/pres-1/edit#slide=id.cw_20260907";

/** Столько текста не влезает на один слайд ни одним кеглем. */
const HEAVY: ExportPayload = {
  weekMonday: "2026-09-07",
  rows: Array.from(
    { length: 12 },
    (_, i): SlideRow => ({
      focus: `Эпик ${i + 1}`,
      tasks: ["Задача"],
      status: "green",
      thisWeek: "",
      nextWeek: "Длинная формулировка плана на неделю. ".repeat(12),
    })
  ),
};

function presentation(slides: NonNullable<Presentation["slides"]>, unit: "EMU" | "PT" = "EMU"): Presentation {
  const [width, height] = unit === "EMU" ? [9144000, 5143500] : [720, 405];
  return { pageSize: { width: { magnitude: width, unit }, height: { magnitude: height, unit } }, slides };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function sentRequests(): Record<string, any>[] {
  return vi.mocked(batchUpdate).mock.calls[0][1];
}

beforeEach(() => {
  vi.mocked(getPresentation).mockReset();
  vi.mocked(batchUpdate).mockReset().mockResolvedValue(undefined);
  vi.stubEnv("GOOGLE_SLIDES_PRESENTATION_ID", "pres-1");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("exportWeekSlide", () => {
  it("создаёт слайд недели первым, если его нет", async () => {
    vi.mocked(getPresentation).mockResolvedValue(presentation([{ objectId: "p1" }]));
    const result = await exportWeekSlide(PAYLOAD);
    expect(sentRequests()[0]).toEqual({ createSlide: { objectId: "cw_20260907", insertionIndex: 0 } });
    expect(result.url).toBe(SLIDE_URL);
  });

  it("очищает существующий слайд недели, а не создаёт второй", async () => {
    vi.mocked(getPresentation).mockResolvedValue(
      presentation([{ objectId: "cw_20260907", pageElements: [{ objectId: "old1" }, { objectId: "old2" }] }])
    );
    await exportWeekSlide(PAYLOAD);
    const requests = sentRequests();
    expect(requests.slice(0, 2)).toEqual([{ deleteObject: { objectId: "old1" } }, { deleteObject: { objectId: "old2" } }]);
    expect(requests.some((r) => "createSlide" in r)).toBe(false);
  });

  it("все deleteObject идут раньше первого создания элементов", async () => {
    vi.mocked(getPresentation).mockResolvedValue(
      presentation([{ objectId: "cw_20260907", pageElements: [{ objectId: "old1" }, { objectId: "old2" }] }])
    );
    await exportWeekSlide(PAYLOAD);
    const requests = sentRequests();
    const lastDeleteIdx = requests.reduce((max, r, i) => ("deleteObject" in r ? i : max), -1);
    const firstCreateIdx = requests.findIndex((r) => "createShape" in r || "createTable" in r || "createSlide" in r);
    expect(lastDeleteIdx).toBeGreaterThanOrEqual(0);
    expect(firstCreateIdx).toBeGreaterThan(lastDeleteIdx);
  });

  it("отправляет всё одним batchUpdate", async () => {
    vi.mocked(getPresentation).mockResolvedValue(presentation([]));
    await exportWeekSlide(PAYLOAD);
    expect(batchUpdate).toHaveBeenCalledTimes(1);
    expect(vi.mocked(batchUpdate).mock.calls[0][0]).toBe("pres-1");
    expect(sentRequests().some((r) => "createTable" in r)).toBe(true);
  });

  it("переводит размер страницы из PT в EMU", async () => {
    vi.mocked(getPresentation).mockResolvedValue(presentation([], "PT"));
    await exportWeekSlide(PAYLOAD);
    const table = sentRequests().find((r) => "createTable" in r)!.createTable;
    expect(table.elementProperties.transform.translateX).toBe(Math.round(720 * 12700 * 0.04));
  });

  it("не влезает — продолжения сразу за основным слайдом, нумерация сквозная", async () => {
    vi.mocked(getPresentation).mockResolvedValue(presentation([{ objectId: "p1" }]));
    const result = await exportWeekSlide(HEAVY);
    const requests = sentRequests();

    const slides = requests.filter((r) => "createSlide" in r).map((r) => r.createSlide);
    expect(slides[0]).toEqual({ objectId: "cw_20260907", insertionIndex: 0 });
    expect(slides.length).toBeGreaterThan(1);
    slides.slice(1).forEach((slide, i) => {
      expect(slide.objectId).toMatch(new RegExp(`^cw_20260907_p${i + 2}_`));
      expect(slide.insertionIndex).toBe(i + 1);
    });
    expect(result.slideCount).toBe(slides.length);

    const titles = requests
      .filter((r) => "insertText" in r && r.insertText.cellLocation?.rowIndex === 0)
      .map((r) => r.insertText.text);
    expect(titles.slice(1).every((t) => t === CONTINUATION_TITLE)).toBe(true);

    const numbers = requests
      .filter((r) => "insertText" in r && r.insertText.cellLocation?.columnIndex === 0 && r.insertText.cellLocation.rowIndex >= 2)
      .map((r) => r.insertText.text);
    expect(numbers).toEqual(HEAVY.rows.map((_, i) => String(i + 1)));
  });

  it("повторная выгрузка удаляет старые продолжения недели, а не копит их", async () => {
    vi.mocked(getPresentation).mockResolvedValue(
      presentation([
        { objectId: "x" },
        { objectId: "cw_20260907", pageElements: [{ objectId: "e1" }] },
        { objectId: "cw_20260907_p2_old", pageElements: [{ objectId: "e2" }] },
        { objectId: "cw_20260914" },
      ])
    );
    const result = await exportWeekSlide(PAYLOAD);
    const requests = sentRequests();

    expect(requests).toContainEqual({ deleteObject: { objectId: "cw_20260907_p2_old" } });
    expect(requests).toContainEqual({ deleteObject: { objectId: "e1" } });
    expect(requests).not.toContainEqual({ deleteObject: { objectId: "cw_20260914" } });
    expect(requests.some((r) => "createSlide" in r)).toBe(false);
    expect(result.slideCount).toBe(1);
  });

  it("старое продолжение перед основным слайдом не сбивает позицию новых", async () => {
    vi.mocked(getPresentation).mockResolvedValue(
      presentation([
        { objectId: "cw_20260907_p2_old" },
        { objectId: "x" },
        { objectId: "cw_20260907", pageElements: [{ objectId: "e1" }] },
      ])
    );
    await exportWeekSlide(HEAVY);
    const [firstContinuation] = sentRequests().filter((r) => "createSlide" in r).map((r) => r.createSlide);
    // Основной слайд после удаления старого продолжения стоит на позиции 1.
    expect(firstContinuation.insertionIndex).toBe(2);
  });

  it("сообщает об эпике, который не влезает даже один", async () => {
    vi.mocked(getPresentation).mockResolvedValue(presentation([]));
    const giant: SlideRow = { ...PAYLOAD.rows[0], focus: "Огромный", nextWeek: "Очень длинный текст плана. ".repeat(110) };
    const result = await exportWeekSlide({ ...PAYLOAD, rows: [giant] });
    expect(result.oversized).toEqual(["Огромный"]);
  });

  it("без ID презентации — ошибка настройки, в Google не ходит", async () => {
    vi.stubEnv("GOOGLE_SLIDES_PRESENTATION_ID", "");
    await expect(exportWeekSlide(PAYLOAD)).rejects.toThrow(GOOGLE_MESSAGES.config);
    expect(getPresentation).not.toHaveBeenCalled();
  });
});

describe("exportWeekSlideAction", () => {
  it("невалидные данные (неделя не с понедельника) — общий отказ без похода в Google", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await exportWeekSlideAction({ ...PAYLOAD, weekMonday: "2026-09-08" });
    expect(result).toEqual({ ok: false, error: "Данные слайда не прошли проверку" });
    expect(getPresentation).not.toHaveBeenCalled();
  });

  it("больше 50 задач в эпике — конкретная причина отказа", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await exportWeekSlideAction({
      ...PAYLOAD,
      rows: [{ ...PAYLOAD.rows[0], tasks: Array.from({ length: 51 }, (_, i) => `Задача ${i + 1}`) }],
    });
    expect(result).toEqual({ ok: false, error: "Эпик «Эпик»: больше 50 задач — снимите лишние галочки" });
    expect(getPresentation).not.toHaveBeenCalled();
  });

  it("ошибку Google отдаёт текстом, а не исключением", async () => {
    vi.mocked(getPresentation).mockRejectedValue(new GoogleSlidesError(GOOGLE_MESSAGES.notFound));
    expect(await exportWeekSlideAction(PAYLOAD)).toEqual({ ok: false, error: GOOGLE_MESSAGES.notFound });
  });

  it("непредвиденную ошибку прячет за общим текстом", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(getPresentation).mockRejectedValue(new Error("boom"));
    expect(await exportWeekSlideAction(PAYLOAD)).toEqual({ ok: false, error: "Не удалось выгрузить слайд" });
  });

  it("успех — ссылка на слайд", async () => {
    vi.mocked(getPresentation).mockResolvedValue(presentation([]));
    expect(await exportWeekSlideAction(PAYLOAD)).toEqual({ ok: true, url: SLIDE_URL, slideCount: 1, oversized: [] });
  });
});
