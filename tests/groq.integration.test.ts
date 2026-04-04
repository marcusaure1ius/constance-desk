import { describe, it, expect } from "vitest";
import { parseTasks } from "@/lib/services/groq";

/*
 * Интеграционные тесты — реальные запросы к Groq API.
 * Требуют GROQ_API_KEY в .env.local
 * Запуск: npm test -- tests/groq.integration.test.ts
 */

describe.skipIf(!process.env.GROQ_API_KEY)("parseTasks — реальные запросы к Groq", () => {
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
