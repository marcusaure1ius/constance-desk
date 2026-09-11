import { describe, it, expect } from "vitest";
import { exportPayloadSchema } from "@/lib/slides-report/types";

const row = { focus: "Эпик", tasks: ["Задача"], status: "green", thisWeek: "", nextWeek: "Задача" };
const valid = { weekMonday: "2026-09-07", rows: [row] };

describe("exportPayloadSchema", () => {
  it("принимает корректные данные", () => {
    expect(exportPayloadSchema.safeParse(valid).success).toBe(true);
  });

  it.each([
    ["неделя не с понедельника", { ...valid, weekMonday: "2026-09-08" }],
    ["несуществующая дата", { ...valid, weekMonday: "2026-02-30" }],
    ["дата не в формате", { ...valid, weekMonday: "07.09.2026" }],
    ["ни одной строки", { ...valid, rows: [] }],
    ["больше 40 строк", { ...valid, rows: Array.from({ length: 41 }, () => row) }],
    ["чужой статус", { ...valid, rows: [{ ...row, status: "blue" }] }],
    ["слишком длинный текст недели", { ...valid, rows: [{ ...row, thisWeek: "x".repeat(3001) }] }],
  ])("отклоняет: %s", (_, payload) => {
    expect(exportPayloadSchema.safeParse(payload).success).toBe(false);
  });
});
