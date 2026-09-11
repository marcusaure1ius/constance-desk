import { describe, it, expect } from "vitest";
import { exportDoneMessage, oversizedMessage } from "@/lib/slides-report/messages";

describe("exportDoneMessage", () => {
  it("один слайд — как раньше", () => {
    expect(exportDoneMessage("07.09–11.09", 1)).toBe("Слайд за 07.09–11.09 обновлён");
  });

  it.each([
    [2, "Слайды за 07.09–11.09 обновлены (2 слайда)"],
    [4, "Слайды за 07.09–11.09 обновлены (4 слайда)"],
    [5, "Слайды за 07.09–11.09 обновлены (5 слайдов)"],
  ])("%i слайда — во множественном числе", (count, text) => {
    expect(exportDoneMessage("07.09–11.09", count)).toBe(text);
  });
});

describe("oversizedMessage", () => {
  it("называет эпик, который не влезает даже один", () => {
    expect(oversizedMessage(["ML модели"])).toBe("Эпик «ML модели» не помещается на слайд — сократите текст");
  });

  it("перечисляет несколько", () => {
    expect(oversizedMessage(["А", "Б"])).toBe("Эпики «А», «Б» не помещаются на слайд — сократите текст");
  });
});
