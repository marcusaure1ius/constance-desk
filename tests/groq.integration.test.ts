import { describe, it, expect } from "vitest";
import { parseTasks } from "@/lib/llm/parse-tasks";
import { captureItems, type CaptureBoard } from "@/lib/llm/capture";

/*
 * Интеграционные тесты — реальные запросы к Groq API.
 * В основной прогон (npm test) не попадают: файлы *.integration.test.ts
 * исключены маской в vitest.config.ts.
 *
 * Запуск: npm run test:integration:groq (нужен GROQ_API_KEY в .env.local)
 */

// Раньше здесь стоял describe.skipIf: без ключа прогон был зелёным, не проверив
// ничего. Теперь явная команда без ключа падает — «зелёный» значит «проверено».
if (!process.env.GROQ_API_KEY) {
  throw new Error(
    "GROQ_API_KEY не задан — интеграционным тестам Groq нужен настоящий ключ. " +
      "Запуск: npm run test:integration:groq"
  );
}

describe("parseTasks — реальные запросы к Groq", () => {
  it("разбирает несколько задач из потока текста", async () => {
    const result = await parseTasks(
      "Починить баг с авторизацией, это срочно. Ещё нужно обновить документацию по API и добавить валидацию на форму регистрации"
    );

    expect(result.length).toBeGreaterThanOrEqual(2);
    expect(result.every((t) => t.title.length > 0)).toBe(true);

    // Хотя бы одна задача должна быть urgent (слово "срочно")
    const hasUrgent = result.some((t) => t.priority === "urgent");
    expect(hasUrgent).toBe(true);
  }, 15000);

  it("извлекает дедлайн из текста", async () => {
    const result = await parseTasks(
      "Подготовить презентацию к 15 апреля"
    );

    expect(result).toHaveLength(1);
    expect(result[0].title.length).toBeGreaterThan(0);
    expect(result[0].plannedDate).toMatch(/^\d{4}-04-15$/);
  }, 15000);

  it("обрабатывает одну простую задачу", async () => {
    const result = await parseTasks("Написать юнит-тесты");

    expect(result).toHaveLength(1);
    expect(result[0].title.length).toBeGreaterThan(0);
    expect(result[0].priority).toBe("normal");
  }, 15000);

  it("чистит слова-паразиты из голосового ввода", async () => {
    const result = await parseTasks(
      "Ну вот значит, нужно это, как его, ну короче сделать рефакторинг модуля оплаты, ну и ещё там типа поправить стили на главной"
    );

    expect(result.length).toBeGreaterThanOrEqual(2);
    // Названия должны быть чистыми, без "ну", "короче", "типа"
    for (const task of result) {
      expect(task.title).not.toMatch(/^(ну|короче|типа|значит)/i);
    }
  }, 15000);

  it("определяет высокий приоритет", async () => {
    const result = await parseTasks(
      "Важно: обновить зависимости до конца недели"
    );

    expect(result).toHaveLength(1);
    expect(["urgent", "high"]).toContain(result[0].priority);
  }, 15000);

  it("возвращает пустой массив для бессмысленного текста", async () => {
    const result = await parseTasks("апвыапвыа фывфыв");

    expect(result).toHaveLength(0);
  }, 15000);

  it("разбирает скопированное сообщение из чата", async () => {
    const result = await parseTasks(
      `Привет! По итогам созвона:
      1) нужно пофиксить 500 ошибку на продакшене — это блокер
      2) добавить логирование в платёжный модуль
      3) написать миграцию для новой таблицы юзеров`
    );

    expect(result.length).toBeGreaterThanOrEqual(3);
    // Первая задача должна быть urgent (слово "блокер")
    const blocker = result.find((t) => t.priority === "urgent");
    expect(blocker).toBeDefined();
  }, 15000);
});

/*
 * Захват (T-0005) на живой модели. Эти пять проверок — критерии приёмки,
 * которые в принципе нельзя закрыть моками: качество разбора есть свойство
 * модели и промпта, а не кода. Всё, что от кода зависит (защита формулировки,
 * контекст доски, падение на OpenRouter), проверяется офлайн в
 * tests/llm-capture.test.ts и tests/llm-client.test.ts.
 *
 * Квота Groq ограничена — гонять этот блок стоит осознанно:
 *   npm run test:integration:groq -- -t "захват"
 */
describe("захват — реальные запросы к Groq", () => {
  const BOARD: CaptureBoard = {
    environmentName: "Работа",
    environmentNames: ["Работа", "Личное"],
    columnTitles: ["Бэклог", "В работе", "Готово"],
    epicNames: ["Техдолг", "ВЭД"],
  };

  // Дата зафиксирована: иначе «до 25.08» разрешалось бы в разные годы
  // в зависимости от дня прогона.
  const TODAY = new Date("2026-08-24T09:00:00Z");

  const capture = (text: string) => captureItems({ text, board: BOARD, today: TODAY });

  it("жаргон «mcp» остаётся в заголовке посимвольно", async () => {
    const items = await capture("Заполнить пилот по mcp");
    const tasks = items.filter((i) => i.kind === "task");

    expect(tasks).toHaveLength(1);
    expect(tasks[0].text).toBe("Заполнить пилот по mcp");
  }, 30000);

  it("три действия через запятую — три задачи", async () => {
    const items = await capture("Сходить к суровцеву, заполнить итмо, ответить по вэду");
    const tasks = items.filter((i) => i.kind === "task");

    expect(tasks).toHaveLength(3);
    expect(tasks.map((t) => t.text.toLowerCase()).join(" ")).toContain("итмо");
  }, 30000);

  it("перечисление дополнений при одном действии — одна задача", async () => {
    const items = await capture(
      "Показать какие есть данные в датасете, в голограмме, во внешних данных"
    );
    const tasks = items.filter((i) => i.kind === "task");

    expect(tasks).toHaveLength(1);
  }, 30000);

  it("«до 25.08» превращается в plannedDate 2026-08-25", async () => {
    const items = await capture("Контроль за ВШЭ кейсы до 25.08");
    const tasks = items.filter((i) => i.kind === "task");

    expect(tasks).toHaveLength(1);
    expect(tasks[0].plannedDate).toBe("2026-08-25");
  }, 30000);

  it("«физюрики» не превращаются в «физлиц» и не переводятся", async () => {
    const items = await capture("Дать физюрикам продукты");
    const tasks = items.filter((i) => i.kind === "task");

    expect(tasks).toHaveLength(1);
    expect(tasks[0].text.toLowerCase()).toContain("физюрик");
    expect(tasks[0].text).not.toMatch(/[A-Za-z]/);
  }, 30000);
});
