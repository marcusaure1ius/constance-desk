import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildParseTasksPrompt, parseTasksResponse, parseTasks } from "@/lib/llm/parse-tasks";
import { stripWhisperHallucinations, transcribeAudio } from "@/lib/llm/transcribe";

describe("buildParseTasksPrompt", () => {
  it("подставляет текущую дату в system prompt", () => {
    const prompt = buildParseTasksPrompt("2026-04-04");
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

describe("parseTasks", () => {
  beforeEach(() => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("возвращает задачи при успешном ответе API", async () => {
    const mockResponse = {
      choices: [{ message: { content: JSON.stringify({ tasks: [{ title: "Тест", priority: "normal" }] }) } }],
    };
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(mockResponse), { status: 200 }));

    const result = await parseTasks("тестовый текст");
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("Тест");
  });

  it("выбрасывает ошибку при неуспешном ответе API", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response("error", { status: 500 }));
    await expect(parseTasks("тест")).rejects.toThrow("Модель openrouter: 500");
  });

  it("возвращает пустой массив если content пустой", async () => {
    const mockResponse = { choices: [{ message: { content: "" } }] };
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(mockResponse), { status: 200 }));

    const result = await parseTasks("тест");
    expect(result).toEqual([]);
  });
});

describe("transcribeAudio", () => {
  beforeEach(() => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("возвращает транскрипцию при успешном ответе", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ text: "Привет мир" }), { status: 200 }));

    const file = new File(["audio"], "test.webm", { type: "audio/webm" });
    const result = await transcribeAudio(file);
    expect(result).toBe("Привет мир");

    const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://openrouter.ai/api/v1/audio/transcriptions");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer test-key");
    expect((init.body as FormData).get("model")).toBe("openai/whisper-large-v3");
  });

  it("выбрасывает ошибку при неуспешном ответе", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response("error", { status: 400 }));

    const file = new File(["audio"], "test.webm", { type: "audio/webm" });
    await expect(transcribeAudio(file)).rejects.toThrow("Модель openrouter: 400");
  });

  it("возвращает пустую строку если text отсутствует", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));

    const file = new File(["audio"], "test.webm", { type: "audio/webm" });
    const result = await transcribeAudio(file);
    expect(result).toBe("");
  });
});

describe("stripWhisperHallucinations", () => {
  it.each([
    "Субтитры сделал DimaTorzok",
    "Субтитры создавал DimaTorzok",
    "субтитры СОЗДАВАЛ DimaTorzok.",
    "Продолжение следует...",
    "Редактор субтитров А.Синецкая Корректор А.Егорова",
    "Спасибо за просмотр!",
    "  Продолжение следует…  ",
  ])("тишина «%s» — пустая строка", (heard) => {
    expect(stripWhisperHallucinations(heard)).toBe("");
  });

  it("срезает хвост, а речь автора не трогает", () => {
    expect(
      stripWhisperHallucinations("Позвонить Маше насчёт слайдов до пятницы. Субтитры сделал DimaTorzok")
    ).toBe("Позвонить Маше насчёт слайдов до пятницы.");
    expect(
      stripWhisperHallucinations("Составить список по ML. Продолжение следует... Спасибо за просмотр.")
    ).toBe("Составить список по ML.");
  });

  it("обычные слова «субтитры», «продолжение», «спасибо» остаются", () => {
    const text = "Сделать субтитры к ролику, продолжение отчёта в пятницу, спасибо Пете";
    expect(stripWhisperHallucinations(text)).toBe(text);
  });

  it("transcribeAudio отдаёт уже очищенный текст", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ text: "Купить хлеб. Субтитры создавал DimaTorzok" }), { status: 200 })
    );
    const file = new File(["audio"], "voice.ogg", { type: "audio/ogg" });
    expect(await transcribeAudio(file, { fetchFn })).toBe("Купить хлеб.");
    vi.unstubAllEnvs();
  });
});
