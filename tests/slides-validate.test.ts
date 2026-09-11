import { describe, it, expect } from "vitest";
import { explainPayloadError, validateExportPayload } from "@/lib/slides-report/validate";
import { exportPayloadSchema, type ExportPayload, type SlideRow } from "@/lib/slides-report/types";

function row(overrides: Partial<SlideRow> = {}): SlideRow {
  return {
    focus: "Эпик",
    tasks: ["Задача"],
    status: "green",
    thisWeek: "",
    nextWeek: "Задача",
    ...overrides,
  };
}

function payload(overrides: Partial<ExportPayload> = {}): ExportPayload {
  return { weekMonday: "2026-09-07", rows: [row()], ...overrides };
}

/** Прогоняет payload через схему и явно проверяет, что она его отвергла. */
function issuesFor(p: ExportPayload) {
  const parsed = exportPayloadSchema.safeParse(p);
  expect(parsed.success).toBe(false);
  return parsed.success ? [] : parsed.error.issues;
}

describe("explainPayloadError", () => {
  it("пустой список эпиков — «Отметьте хотя бы один эпик»", () => {
    const p = payload({ rows: [] });
    expect(explainPayloadError(p, issuesFor(p))).toBe("Отметьте хотя бы один эпик");
  });

  it("больше 40 эпиков — «Больше 40 эпиков — снимите лишние»", () => {
    const p = payload({ rows: Array.from({ length: 41 }, () => row()) });
    expect(explainPayloadError(p, issuesFor(p))).toBe("Больше 40 эпиков — снимите лишние");
  });

  it("больше 50 задач в эпике — называет эпик по имени", () => {
    const p = payload({
      rows: [row({ focus: "Индикаторы риска", tasks: Array.from({ length: 51 }, (_, i) => `Задача ${i + 1}`) })],
    });
    expect(explainPayloadError(p, issuesFor(p))).toBe(
      "Эпик «Индикаторы риска»: больше 50 задач — снимите лишние галочки"
    );
  });

  it("название задачи длиннее 500 символов", () => {
    const p = payload({ rows: [row({ focus: "Индикаторы риска", tasks: ["a".repeat(501)] })] });
    expect(explainPayloadError(p, issuesFor(p))).toBe(
      "Эпик «Индикаторы риска»: название задачи длиннее 500 символов"
    );
  });

  it("текст «Текущая неделя» длиннее 3000 символов", () => {
    const p = payload({ rows: [row({ focus: "Индикаторы риска", thisWeek: "a".repeat(3001) })] });
    expect(explainPayloadError(p, issuesFor(p))).toBe(
      "Эпик «Индикаторы риска»: текст «Текущая неделя» длиннее 3000 символов"
    );
  });

  it("текст «Следующая неделя» длиннее 3000 символов", () => {
    const p = payload({ rows: [row({ focus: "Индикаторы риска", nextWeek: "a".repeat(3001) })] });
    expect(explainPayloadError(p, issuesFor(p))).toBe(
      "Эпик «Индикаторы риска»: текст «Следующая неделя» длиннее 3000 символов"
    );
  });

  it("название эпика длиннее 300 символов", () => {
    const p = payload({ rows: [row({ focus: "a".repeat(301) })] });
    expect(explainPayloadError(p, issuesFor(p))).toBe("Название эпика длиннее 300 символов");
  });

  it("эпик без имени в сообщении — «№i»", () => {
    const p = payload({
      rows: [row(), row({ focus: "", tasks: Array.from({ length: 51 }, (_, i) => `Задача ${i + 1}`) })],
    });
    expect(explainPayloadError(p, issuesFor(p))).toBe("Эпик «№2»: больше 50 задач — снимите лишние галочки");
  });

  it("неделя не с понедельника — общий отказ", () => {
    const p = payload({ weekMonday: "2026-09-08" });
    expect(explainPayloadError(p, issuesFor(p))).toBe("Данные слайда не прошли проверку");
  });

  it("нет проблем — общий отказ по умолчанию", () => {
    expect(explainPayloadError(payload(), [])).toBe("Данные слайда не прошли проверку");
  });
});

describe("validateExportPayload", () => {
  it("валидные данные — ok с разобранным payload", () => {
    const p = payload();
    const result = validateExportPayload(p);
    expect(result).toEqual({ ok: true, data: p });
  });

  it("невалидные данные — ok:false с объяснённым текстом", () => {
    const p = payload({ rows: [] });
    expect(validateExportPayload(p)).toEqual({ ok: false, error: "Отметьте хотя бы один эпик" });
  });
});
