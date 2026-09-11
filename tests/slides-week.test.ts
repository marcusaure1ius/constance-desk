import { describe, it, expect } from "vitest";
import { addBusinessDaysIso, isIsoDate } from "@/lib/slides-report/dates";
import { getReportWeek, slideIdForWeek } from "@/lib/slides-report/week";

describe("getReportWeek", () => {
  it.each([
    ["2026-09-07", "2026-08-31"], // пн → прошлая неделя
    ["2026-09-08", "2026-08-31"], // вт
    ["2026-09-09", "2026-08-31"], // ср
    ["2026-09-10", "2026-08-31"], // чт
    ["2026-09-11", "2026-09-07"], // пт → текущая
    ["2026-09-12", "2026-09-07"], // сб
    ["2026-09-13", "2026-09-07"], // вс
    ["2026-09-14", "2026-09-07"], // пн → прошлая
    ["2026-09-17", "2026-09-07"], // чт
    ["2026-09-18", "2026-09-14"], // пт
  ])("%s → неделя с понедельника %s", (today, monday) => {
    expect(getReportWeek(today).monday).toBe(monday);
  });

  it("пятница 11.09.2026 → 07.09.2026 - 11.09.2026", () => {
    expect(getReportWeek("2026-09-11")).toEqual({
      monday: "2026-09-07",
      friday: "2026-09-11",
      label: "07.09.2026 - 11.09.2026",
      shortLabel: "07.09–11.09",
    });
  });

  it("переходит через Новый год", () => {
    expect(getReportWeek("2027-01-01").label).toBe("28.12.2026 - 01.01.2027");
    expect(getReportWeek("2027-01-04").label).toBe("28.12.2026 - 01.01.2027");
  });
});

describe("slideIdForWeek", () => {
  it("склеивает cw_ и понедельник без дефисов", () => {
    expect(slideIdForWeek("2026-09-07")).toBe("cw_20260907");
  });
});

describe("даты", () => {
  it.each([
    ["2026-09-11", true],
    ["2026-02-30", false],
    ["2026-9-1", false],
    ["11.09.2026", false],
  ])("isIsoDate(%s) = %s", (value, expected) => {
    expect(isIsoDate(value)).toBe(expected);
  });

  it("рабочие дни пропускают выходные", () => {
    expect(addBusinessDaysIso("2026-09-11", 2)).toBe("2026-09-15"); // пт → вт
    expect(addBusinessDaysIso("2026-09-12", 1)).toBe("2026-09-14"); // сб → пн
    expect(addBusinessDaysIso("2026-09-10", 2)).toBe("2026-09-14"); // чт → пн
  });
});
