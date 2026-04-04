import { describe, it, expect } from "vitest";
import { buildParseTasksPrompt, parseTasksResponse } from "@/lib/services/groq";

describe("buildParseTasksPrompt", () => {
  it("подставляет текущую дату в system prompt", () => {
    const prompt = buildParseTasksPrompt("тест", "2026-04-04");
    expect(prompt).toContain("Сегодня: 2026-04-04");
  });
});

describe("parseTasksResponse", () => {
  it("парсит валидный JSON с задачами", () => {
    const raw = JSON.stringify({
      tasks: [
        { title: "Починить баг", priority: "urgent" },
        { title: "Обновить доку", priority: "normal", plannedDate: "2026-04-10" },
      ],
    });
    const result = parseTasksResponse(raw);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ title: "Починить баг", priority: "urgent" });
    expect(result[1]).toEqual({ title: "Обновить доку", priority: "normal", plannedDate: "2026-04-10" });
  });

  it("возвращает пустой массив при невалидном JSON", () => {
    expect(parseTasksResponse("not json")).toEqual([]);
  });

  it("возвращает пустой массив если tasks не массив", () => {
    expect(parseTasksResponse(JSON.stringify({ tasks: "string" }))).toEqual([]);
  });

  it("фильтрует задачи без title", () => {
    const raw = JSON.stringify({
      tasks: [
        { title: "Валидная", priority: "normal" },
        { priority: "high" },
        { title: "", priority: "normal" },
      ],
    });
    const result = parseTasksResponse(raw);
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("Валидная");
  });
});
