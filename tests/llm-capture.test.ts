import { describe, it, expect, vi } from "vitest";
import {
  buildCapturePrompt,
  captureItems,
  parseCaptureResponse,
  sanitizeTitle,
  type CaptureBoard,
} from "@/lib/llm/capture";

/**
 * Разбор ответа модели. Живая модель проверяется отдельно
 * (`tests/groq.integration.test.ts`), здесь — то, что от неё не зависит:
 * контекст доски в промпте и защита формулировки автора.
 */

const BOARD: CaptureBoard = {
  environmentName: "Работа",
  environmentNames: ["Работа", "Личное"],
  columnTitles: ["Бэклог", "В работе", "Готово"],
  epicNames: ["Техдолг", "ВЭД"],
};

const TODAY = new Date("2026-08-24T09:00:00Z");

function response(items: unknown[]): string {
  return JSON.stringify({ items });
}

describe("buildCapturePrompt", () => {
  const prompt = buildCapturePrompt(BOARD, TODAY);

  it("подставляет доску целиком: проекты, колонки, эпики", () => {
    expect(prompt).toContain("Работа");
    expect(prompt).toContain("Личное");
    expect(prompt).toContain("Бэклог, В работе, Готово");
    expect(prompt).toContain("Техдолг, ВЭД");
  });

  it("даёт сегодняшнюю дату и день недели — без них срок не посчитать", () => {
    expect(prompt).toContain("2026-08-24");
    expect(prompt).toContain("понедельник");

    // Вторая дата: с зашитой в промпт константой проверка была бы пустой.
    const newYearEve = buildCapturePrompt(BOARD, new Date("2026-12-31T09:00:00Z"));
    expect(newYearEve).toContain("2026-12-31");
    expect(newYearEve).toContain("четверг");
    expect(newYearEve).not.toContain("2026-08-24");
  });

  it("подставляется именно переданная доска, а не пример из промпта", () => {
    // Тест с одной доской прошёл бы и на промпте с зашитыми именами: проверка
    // имеет смысл, только если второй вызов приносит другие имена.
    const other = buildCapturePrompt(
      {
        environmentName: "Ромашка",
        environmentNames: ["Ромашка"],
        columnTitles: ["Инбокс", "Сделано"],
        epicNames: ["Голограмма"],
      },
      TODAY
    );

    expect(other).toContain("Ромашка");
    expect(other).toContain("Инбокс, Сделано");
    expect(other).toContain("Голограмма");
    expect(other).not.toContain("Бэклог");
    expect(other).not.toContain("Техдолг");
  });

  it("пустой список эпиков не превращается в undefined", () => {
    const empty = buildCapturePrompt({ ...BOARD, epicNames: [] }, TODAY);
    expect(empty).not.toContain("undefined");
    expect(empty).toContain("Эпики активного проекта: —");
  });

  it("запрещает перевод и правку жаргона", () => {
    expect(prompt).toContain("НЕ переводи");
    expect(prompt).toMatch(/НЕ исправляй жаргон/);
  });

  it("показывает оба случая деления: три задачи и одна", () => {
    expect(prompt).toContain("ТРИ задачи");
    expect(prompt).toContain("ОДНА задача");
  });
});

describe("parseCaptureResponse — формулировка автора", () => {
  it("несколько задач сохраняются посимвольно, включая жаргон", () => {
    const items = parseCaptureResponse(
      response([
        { kind: "task", text: "Сходить к суровцеву", source: "Сходить к суровцеву" },
        { kind: "task", text: "заполнить итмо", source: "заполнить итмо" },
        { kind: "task", text: "ответить по вэду", source: "ответить по вэду" },
      ]),
      { board: BOARD, sourceText: "Сходить к суровцеву, заполнить итмо, ответить по вэду" }
    );

    expect(items.map((i) => i.text)).toEqual([
      "Сходить к суровцеву",
      "заполнить итмо",
      "ответить по вэду",
    ]);
    expect(items.every((i) => i.kind === "task")).toBe(true);
  });

  it("перевод русской задачи откатывается к словам автора", () => {
    const items = parseCaptureResponse(
      response([
        {
          kind: "task",
          text: "Give products to individuals",
          source: "Дать физюрикам продукты",
        },
      ]),
      { board: BOARD, sourceText: "Дать физюрикам продукты" }
    );

    expect(items[0].text).toBe("Дать физюрикам продукты");
  });

  it("единственный элемент без source сверяется со всем сообщением", () => {
    const items = parseCaptureResponse(response([{ kind: "task", text: "Fix login bug" }]), {
      board: BOARD,
      sourceText: "Починить баг с логином",
    });

    expect(items[0].text).toBe("Починить баг с логином");
  });

  it("латиница в исходной фразе не считается переводом", () => {
    // «Заполнить пилот по mcp» — латиница есть с обеих сторон, откатывать нечего.
    const items = parseCaptureResponse(
      response([
        { kind: "task", text: "Заполнить пилот по mcp", source: "Заполнить пилот по mcp" },
      ]),
      { board: BOARD, sourceText: "Заполнить пилот по mcp" }
    );

    expect(items[0].text).toBe("Заполнить пилот по mcp");
  });

  it("английское сообщение остаётся английским", () => {
    const items = parseCaptureResponse(
      response([{ kind: "task", text: "Ship the release", source: "ship the release" }]),
      { board: BOARD, sourceText: "ship the release" }
    );

    expect(items[0].text).toBe("Ship the release");
  });

  it("при нескольких элементах перевод откатывается по своему source", () => {
    const items = parseCaptureResponse(
      response([
        { kind: "task", text: "Call Surovtsev", source: "Сходить к суровцеву" },
        { kind: "task", text: "заполнить итмо", source: "заполнить итмо" },
      ]),
      { board: BOARD, sourceText: "Сходить к суровцеву, заполнить итмо" }
    );

    expect(items.map((i) => i.text)).toEqual(["Сходить к суровцеву", "заполнить итмо"]);
  });
});

describe("sanitizeTitle", () => {
  it("снимает «надо» и «нужно бы» в начале", () => {
    expect(sanitizeTitle("Надо написать комментарии по стратегии")).toBe(
      "написать комментарии по стратегии"
    );
    expect(sanitizeTitle("нужно бы позвонить в банк")).toBe("позвонить в банк");
  });

  it("не трогает «надо» в середине", () => {
    expect(sanitizeTitle("Понять, что надо физюрикам")).toBe("Понять, что надо физюрикам");
  });

  it("вырезает @упоминания", () => {
    expect(sanitizeTitle("Спросить @ivan_petrov про сроки")).toBe("Спросить про сроки");
  });

  it("жаргон и регистр остаются как есть", () => {
    expect(sanitizeTitle("заполнить итмо, вэду и mcp")).toBe("заполнить итмо, вэду и mcp");
  });

  it("сообщение из одного «Надо» не превращается в пустой заголовок", () => {
    expect(sanitizeTitle("Надо")).toBe("Надо");
  });
});

describe("parseCaptureResponse — поля задачи", () => {
  it("берёт срок и приоритет", () => {
    const items = parseCaptureResponse(
      response([
        {
          kind: "task",
          text: "Контроль за ВШЭ кейсы",
          source: "Контроль за ВШЭ кейсы до 25.08",
          plannedDate: "2026-08-25",
          priority: "urgent",
        },
      ]),
      { board: BOARD, sourceText: "Контроль за ВШЭ кейсы до 25.08" }
    );

    expect(items[0]).toMatchObject({
      text: "Контроль за ВШЭ кейсы",
      plannedDate: "2026-08-25",
      priority: "urgent",
    });
  });

  it("отбрасывает срок не в формате даты и несуществующие даты", () => {
    const items = parseCaptureResponse(
      response([
        { kind: "task", text: "а", plannedDate: "25.08.2026" },
        { kind: "task", text: "б", plannedDate: "2026-02-31" },
        { kind: "task", text: "в", plannedDate: "завтра" },
      ]),
      { board: BOARD, sourceText: "а б в" }
    );

    expect(items.every((i) => i.plannedDate === undefined)).toBe(true);
  });

  it("отбрасывает выдуманный приоритет", () => {
    const items = parseCaptureResponse(
      response([{ kind: "task", text: "а", priority: "critical" }]),
      { board: BOARD, sourceText: "а" }
    );

    expect(items[0].priority).toBeUndefined();
  });

  it("эпик принимается только из доски и в её написании", () => {
    const items = parseCaptureResponse(
      response([
        { kind: "task", text: "а", epic: "техдолг" },
        { kind: "task", text: "б", epic: "Login issues" },
      ]),
      { board: BOARD, sourceText: "а б" }
    );

    expect(items[0].epic).toBe("Техдолг");
    expect(items[1].epic).toBeUndefined();
  });

  it("не-задачам поля задачи не достаются", () => {
    const items = parseCaptureResponse(
      response([
        { kind: "note", text: "нет синергии в продуктах", priority: "urgent", plannedDate: "2026-08-25" },
      ]),
      { board: BOARD, sourceText: "нет синергии в продуктах" }
    );

    expect(items[0]).toEqual({ kind: "note", text: "нет синергии в продуктах" });
  });

  it("смешанное сообщение отдаёт задачу и мысль", () => {
    const items = parseCaptureResponse(
      response([
        { kind: "task", text: "написать комментарии по стратегии" },
        { kind: "note", text: "не идём в другие продукты, нет синергии" },
      ]),
      { board: BOARD, sourceText: "Надо написать комментарии по стратегии. Не идём в другие продукты" }
    );

    expect(items.map((i) => i.kind)).toEqual(["task", "note"]);
  });
});

describe("parseCaptureResponse — устойчивость", () => {
  it("незнакомый тип не теряет текст, а становится raw", () => {
    const items = parseCaptureResponse(response([{ kind: "reminder", text: "что-то" }]), {
      board: BOARD,
      sourceText: "что-то",
    });

    expect(items).toEqual([{ kind: "raw", text: "что-то" }]);
  });

  it("понимает title вместо text — модели путают ключи", () => {
    const items = parseCaptureResponse(response([{ kind: "task", title: "Купить билеты" }]), {
      board: BOARD,
      sourceText: "Купить билеты",
    });

    expect(items[0].text).toBe("Купить билеты");
  });

  it("принимает голый массив вместо объекта", () => {
    const items = parseCaptureResponse(JSON.stringify([{ kind: "task", text: "Купить билеты" }]), {
      board: BOARD,
      sourceText: "Купить билеты",
    });

    expect(items).toHaveLength(1);
  });

  it("битый JSON и пустые элементы дают пустой список", () => {
    expect(parseCaptureResponse("не json", { sourceText: "х" })).toEqual([]);
    expect(parseCaptureResponse(response([]), { sourceText: "х" })).toEqual([]);
    expect(parseCaptureResponse(response([{ kind: "task", text: "  " }]), { sourceText: "х" })).toEqual([]);
    expect(parseCaptureResponse(JSON.stringify({ tasks: [] }), { sourceText: "х" })).toEqual([]);
  });
});

describe("captureItems", () => {
  it("шлёт модели контекст доски и текст пользователя", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: response([{ kind: "task", text: "заполнить итмо" }]) } }],
        }),
        { status: 200 }
      )
    );

    const items = await captureItems({
      text: "заполнить итмо",
      board: BOARD,
      today: TODAY,
      providers: [
        {
          name: "groq",
          baseUrl: "https://api.groq.com/openai/v1",
          apiKey: "k",
          model: "openai/gpt-oss-120b",
        },
      ],
      fetchFn: fetchFn as unknown as typeof fetch,
    });

    const body = JSON.parse((fetchFn.mock.calls[0][1] as RequestInit).body as string) as {
      messages: { role: string; content: string }[];
    };
    expect(body.messages[0].content).toContain("Бэклог");
    expect(body.messages[1]).toEqual({ role: "user", content: "заполнить итмо" });
    expect(items).toEqual([{ kind: "task", text: "заполнить итмо" }]);
  });
});
