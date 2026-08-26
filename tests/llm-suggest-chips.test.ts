import { describe, it, expect, vi } from "vitest";
import {
  buildBoardDigest,
  parseSuggestChipsResponse,
  suggestChips,
  DEFAULT_DIGEST_LIMITS,
  type BoardDigestInput,
  type BoardDigestLimits,
} from "@/lib/llm/suggest-chips";
import type { LlmProvider } from "@/lib/llm/client";

const TODAY = new Date("2026-08-26T09:00:00Z");

const COLUMNS = [
  { id: "col-backlog", title: "Бэклог", position: 0 },
  { id: "col-doing", title: "В работе", position: 1 },
  { id: "col-done", title: "Готово", position: 2 },
];

const CATEGORIES = [
  { id: "cat-a", name: "Маркетинг" },
  { id: "cat-b", name: "Техдолг" },
];

function board(overrides: Partial<BoardDigestInput> = {}): BoardDigestInput {
  return { columns: COLUMNS, categories: CATEGORIES, tasks: [], ...overrides };
}

const GROQ: LlmProvider = {
  name: "groq",
  baseUrl: "https://api.groq.com/openai/v1",
  apiKey: "groq-key",
  model: "openai/gpt-oss-120b",
};

function reply(content: string): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
}

describe("buildBoardDigest", () => {
  it("пустая доска не ломает выжимку", () => {
    const digest = buildBoardDigest({ columns: [], categories: [], tasks: [] }, { today: TODAY });
    expect(digest).toContain("нет колонок");
    expect(digest).toContain("Просрочено (0)");
    expect(digest).toContain("нет");
  });

  it("считает задачи по колонкам", () => {
    const digest = buildBoardDigest(
      board({
        tasks: [
          { title: "A", columnId: "col-backlog" },
          { title: "B", columnId: "col-backlog" },
          { title: "C", columnId: "col-doing" },
        ],
      }),
      { today: TODAY }
    );
    expect(digest).toContain("Бэклог: 2");
    expect(digest).toContain("В работе: 1");
    expect(digest).toContain("Готово: 0");
  });

  it("просроченное — незавершённая задача со сроком в прошлом — попадает в выжимку с названием и датой", () => {
    const digest = buildBoardDigest(
      board({
        tasks: [
          { title: "Обновить ПСН", columnId: "col-backlog", plannedDate: "2026-08-20" },
          { title: "Будущая", columnId: "col-backlog", plannedDate: "2026-09-10" },
          {
            title: "Уже закрыта",
            columnId: "col-done",
            plannedDate: "2026-08-01",
            completedAt: new Date("2026-08-02"),
          },
        ],
      }),
      { today: TODAY }
    );
    expect(digest).toContain("Просрочено (1)");
    expect(digest).toContain("«Обновить ПСН» — срок был 2026-08-20");
    expect(digest).not.toContain("Будущая");
    expect(digest).not.toContain("Уже закрыта");
  });

  it("ближайшие дни — только внутри горизонта, не дальше", () => {
    const limits: BoardDigestLimits = { ...DEFAULT_DIGEST_LIMITS, upcomingWindowDays: 3 };
    const digest = buildBoardDigest(
      board({
        tasks: [
          { title: "Завтра", columnId: "col-backlog", plannedDate: "2026-08-27" },
          { title: "Далеко", columnId: "col-backlog", plannedDate: "2026-09-15" },
        ],
      }),
      { today: TODAY, limits }
    );
    expect(digest).toContain("«Завтра» — срок 2026-08-27");
    expect(digest).not.toContain("Далеко");
  });

  it("лимит просроченных соблюдается: поимённо не больше лимита, остальное — счётчиком", () => {
    const limits: BoardDigestLimits = { ...DEFAULT_DIGEST_LIMITS, overdueTasks: 2 };
    const tasks = Array.from({ length: 5 }, (_, i) => ({
      title: `Задача ${i}`,
      columnId: "col-backlog",
      plannedDate: "2026-08-20",
    }));
    const digest = buildBoardDigest(board({ tasks }), { today: TODAY, limits });
    expect(digest).toContain("Просрочено (5)");
    expect(digest.match(/^- «Задача/gm)).toHaveLength(2);
    expect(digest).toContain("- ещё 3");
  });

  it("эпики без категорий на доске — «нет», а с ними — имена через запятую", () => {
    expect(buildBoardDigest(board({ categories: [] }), { today: TODAY })).toContain("Эпики:\n- нет");
    const digest = buildBoardDigest(board(), { today: TODAY });
    expect(digest).toContain("Маркетинг, Техдолг");
  });

  it("лимит эпиков схлопывает остаток в «+N ещё»", () => {
    const limits: BoardDigestLimits = { ...DEFAULT_DIGEST_LIMITS, epicNames: 1 };
    const digest = buildBoardDigest(board(), { today: TODAY, limits });
    expect(digest).toContain("Маркетинг (+1 ещё)");
    expect(digest).not.toContain("Техдолг");
  });

  it("«в работе» — задачи средних колонок (не первой и не последней)", () => {
    const digest = buildBoardDigest(
      board({
        tasks: [
          { title: "В бэклоге", columnId: "col-backlog" },
          { title: "В работе идёт", columnId: "col-doing" },
          { title: "Сделана", columnId: "col-done" },
        ],
      }),
      { today: TODAY }
    );
    expect(digest).toContain("В работе (1):");
    expect(digest).toContain("«В работе идёт» — В работе");
    expect(digest).not.toContain("«В бэклоге»");
    expect(digest).not.toContain("«Сделана»");
  });
});

describe("parseSuggestChipsResponse", () => {
  it("берёт suggestions из JSON", () => {
    const raw = JSON.stringify({ suggestions: ["Что горит?", "Разбей демку на шаги"] });
    expect(parseSuggestChipsResponse(raw)).toEqual(["Что горит?", "Разбей демку на шаги"]);
  });

  it("обрезает до трёх, даже если модель прислала больше", () => {
    const raw = JSON.stringify({ suggestions: ["A", "B", "C", "D", "E"] });
    expect(parseSuggestChipsResponse(raw)).toEqual(["A", "B", "C"]);
  });

  it("отсеивает пустые строки и слишком длинные", () => {
    const long = "x".repeat(200);
    const raw = JSON.stringify({ suggestions: ["Норм", "   ", "", long] });
    expect(parseSuggestChipsResponse(raw)).toEqual(["Норм"]);
  });

  it("отсеивает дубли без учёта регистра", () => {
    const raw = JSON.stringify({ suggestions: ["Что горит?", "что горит?", "Другое"] });
    expect(parseSuggestChipsResponse(raw)).toEqual(["Что горит?", "Другое"]);
  });

  it("битый JSON — пустой массив", () => {
    expect(parseSuggestChipsResponse("не json")).toEqual([]);
  });

  it("suggestions не массив строк — пустой массив", () => {
    expect(parseSuggestChipsResponse(JSON.stringify({ suggestions: "строка" }))).toEqual([]);
    expect(parseSuggestChipsResponse(JSON.stringify({ suggestions: [1, 2, 3] }))).toEqual([]);
    expect(parseSuggestChipsResponse(JSON.stringify({ other: [] }))).toEqual([]);
  });

  it("голый массив в ответе тоже принимается", () => {
    expect(parseSuggestChipsResponse(JSON.stringify(["Раз", "Два"]))).toEqual(["Раз", "Два"]);
  });
});

describe("suggestChips", () => {
  it("возвращает разобранные подсказки от модели", async () => {
    const fetchFn = vi.fn(async () =>
      reply(JSON.stringify({ suggestions: ["Что у меня горит?", "Перенеси задачу"] }))
    );

    const result = await suggestChips(board(), {
      today: TODAY,
      providers: [GROQ],
      fetchFn: fetchFn as unknown as typeof fetch,
    });

    expect(result).toEqual(["Что у меня горит?", "Перенеси задачу"]);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("выжимка доски уходит в тело запроса как user-сообщение", async () => {
    let sentBody: Record<string, unknown> | undefined;
    const fetchFn = vi.fn(async (_url: unknown, init?: RequestInit) => {
      sentBody = JSON.parse(String(init?.body));
      return reply(JSON.stringify({ suggestions: [] }));
    });

    await suggestChips(
      board({ tasks: [{ title: "Особая задача", columnId: "col-backlog", plannedDate: "2026-08-20" }] }),
      { today: TODAY, providers: [GROQ], fetchFn: fetchFn as unknown as typeof fetch }
    );

    const messages = sentBody?.messages as { role: string; content: string }[];
    const userMessage = messages.find((m) => m.role === "user");
    expect(userMessage?.content).toContain("Особая задача");
  });

  it("мусор от модели — пустой массив, откат на статичные строки решает вызывающий код", async () => {
    const fetchFn = vi.fn(async () => reply("извините, не понял"));

    const result = await suggestChips(board(), {
      today: TODAY,
      providers: [GROQ],
      fetchFn: fetchFn as unknown as typeof fetch,
    });

    expect(result).toEqual([]);
  });

  it("падение провайдера — исключение, а не тихий пустой список", async () => {
    const fetchFn = vi.fn(async () => new Response("error", { status: 500 }));

    await expect(
      suggestChips(board(), { today: TODAY, providers: [GROQ], fetchFn: fetchFn as unknown as typeof fetch })
    ).rejects.toThrow();
  });
});
