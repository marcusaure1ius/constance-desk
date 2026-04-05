import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildAiPrompt, parseAiResponse, getAiAnalysis } from "@/lib/services/report-pdf";
import type { ExtendedWeeklyReport, WeekTrendItem } from "@/lib/services/reports";

const baseReport: ExtendedWeeklyReport = {
  weekStart: new Date(2026, 2, 30), // 30 марта 2026
  weekEnd: new Date(2026, 3, 5), // 5 апреля 2026
  completedTasks: [
    {
      id: "1",
      title: "Настроить CI/CD",
      description: "Описание",
      categoryName: "DevOps",
      startDate: "2026-03-25",
      completedAt: new Date(2026, 3, 1),
    },
  ],
  carryoverTasks: [
    {
      id: "2",
      title: "Рефакторинг API",
      description: null,
      categoryName: "Разработка",
      startDate: "2026-03-20",
      completedAt: null,
    },
  ],
  newTasks: [
    {
      id: "3",
      title: "Добавить тесты",
      description: null,
      categoryName: null,
      startDate: "2026-03-30",
      completedAt: null,
    },
  ],
};

const baseTrend: WeekTrendItem[] = [
  { weekStart: new Date(2026, 2, 9), completed: 3, inProgress: 2, new: 4 },
  { weekStart: new Date(2026, 2, 16), completed: 5, inProgress: 1, new: 3 },
  { weekStart: new Date(2026, 2, 23), completed: 4, inProgress: 3, new: 2 },
  { weekStart: new Date(2026, 2, 30), completed: 1, inProgress: 1, new: 1 },
];

describe("buildAiPrompt", () => {
  it("содержит названия задач", () => {
    const prompt = buildAiPrompt(baseReport, baseTrend);
    expect(prompt).toContain("Настроить CI/CD");
    expect(prompt).toContain("Рефакторинг API");
    expect(prompt).toContain("Добавить тесты");
  });

  it("содержит категории задач", () => {
    const prompt = buildAiPrompt(baseReport, baseTrend);
    expect(prompt).toContain("DevOps");
    expect(prompt).toContain("Разработка");
  });

  it("содержит статусы задач", () => {
    const prompt = buildAiPrompt(baseReport, baseTrend);
    expect(prompt).toContain("Готово");
    expect(prompt).toContain("В работе");
  });

  it("содержит данные тренда", () => {
    const prompt = buildAiPrompt(baseReport, baseTrend);
    expect(prompt).toContain("завершено 3");
    expect(prompt).toContain("завершено 5");
    expect(prompt).toContain("в работе 2");
    expect(prompt).toContain("новых 4");
  });

  it("содержит секции отчёта", () => {
    const prompt = buildAiPrompt(baseReport, baseTrend);
    expect(prompt).toContain("ЗАВЕРШЁННЫЕ ЗАДАЧИ");
    expect(prompt).toContain("ПЕРЕХОДЯЩИЕ ЗАДАЧИ");
    expect(prompt).toContain("НОВЫЕ ЗАДАЧИ");
    expect(prompt).toContain("ТРЕНД ЗА 4 НЕДЕЛИ");
  });

  it("содержит период отчёта", () => {
    const prompt = buildAiPrompt(baseReport, baseTrend);
    expect(prompt).toContain("30 марта 2026");
    expect(prompt).toContain("5 апреля 2026");
  });

  it("запрашивает JSON формат", () => {
    const prompt = buildAiPrompt(baseReport, baseTrend);
    expect(prompt).toContain("JSON");
    expect(prompt).toContain("summary");
    expect(prompt).toContain("completionRate");
    expect(prompt).toContain("risks");
    expect(prompt).toContain("nextWeekFocus");
  });

  it("обрабатывает пустые списки задач", () => {
    const emptyReport: ExtendedWeeklyReport = {
      weekStart: new Date(2026, 2, 30),
      weekEnd: new Date(2026, 3, 5),
      completedTasks: [],
      carryoverTasks: [],
      newTasks: [],
    };
    const prompt = buildAiPrompt(emptyReport, baseTrend);
    expect(prompt).toContain("Нет завершённых задач");
    expect(prompt).toContain("Нет переходящих задач");
    expect(prompt).toContain("Нет новых задач");
  });
});

describe("parseAiResponse", () => {
  it("парсит валидный JSON ответ", () => {
    const raw = JSON.stringify({
      summary: "Хорошая неделя",
      completionRate: "75% (3 из 4)",
      weekComparison: "Лучше на 2 задачи",
      trends: "Стабильный рост",
      risks: ["Задача застряла"],
      nextWeekFocus: ["Завершить рефакторинг"],
    });
    const result = parseAiResponse(raw);
    expect(result.summary).toBe("Хорошая неделя");
    expect(result.completionRate).toBe("75% (3 из 4)");
    expect(result.risks).toEqual(["Задача застряла"]);
    expect(result.nextWeekFocus).toEqual(["Завершить рефакторинг"]);
  });

  it("выбрасывает ошибку при невалидном JSON", () => {
    expect(() => parseAiResponse("not json")).toThrow();
  });

  it("обрабатывает отсутствующие поля", () => {
    const raw = JSON.stringify({});
    const result = parseAiResponse(raw);
    expect(result.summary).toBe("");
    expect(result.risks).toEqual([]);
    expect(result.nextWeekFocus).toEqual([]);
  });
});

describe("getAiAnalysis", () => {
  beforeEach(() => {
    vi.stubEnv("GROQ_API_KEY", "test-key");
    vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("возвращает анализ при успешном ответе API", async () => {
    const mockAnalysis = {
      summary: "Продуктивная неделя",
      completionRate: "100%",
      weekComparison: "Лучше",
      trends: "Рост",
      risks: ["Нет рисков"],
      nextWeekFocus: ["Продолжать"],
    };
    const mockResponse = {
      choices: [{ message: { content: JSON.stringify(mockAnalysis) } }],
    };
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(mockResponse), { status: 200 }),
    );

    const result = await getAiAnalysis(baseReport, baseTrend);
    expect(result.summary).toBe("Продуктивная неделя");
    expect(result.risks).toEqual(["Нет рисков"]);
  });

  it("выбрасывает ошибку при неуспешном ответе API", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response("error", { status: 500 }),
    );
    await expect(getAiAnalysis(baseReport, baseTrend)).rejects.toThrow(
      "Groq API error: 500",
    );
  });

  it("передаёт правильные параметры в Groq API", async () => {
    const mockResponse = {
      choices: [{ message: { content: JSON.stringify({
        summary: "", completionRate: "", weekComparison: "",
        trends: "", risks: [], nextWeekFocus: [],
      }) } }],
    };
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(mockResponse), { status: 200 }),
    );

    await getAiAnalysis(baseReport, baseTrend);

    expect(fetch).toHaveBeenCalledOnce();
    const call = vi.mocked(fetch).mock.calls[0];
    expect(call[0]).toBe("https://api.groq.com/openai/v1/chat/completions");

    const body = JSON.parse((call[1] as RequestInit).body as string);
    expect(body.model).toBe("openai/gpt-oss-20b");
    expect(body.temperature).toBe(0.3);
    expect(body.response_format).toEqual({ type: "json_object" });

    const headers = (call[1] as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer test-key");
  });
});
