import { chatJson, MODELS, type LlmProvider } from "./client";

/**
 * Из фразы «закрой задачу про слайды» достаёт ключевые слова для поиска.
 * Один дешёвый вызов, без инструментов. При любом сбое возвращает исходный
 * текст: поиск по целой фразе хуже, но лучше, чем ответ «не понял».
 */

type Options = { provider?: LlmProvider; fetchFn?: typeof fetch };

const SYSTEM = `Ты помогаешь найти задачу на канбан-доске по фразе пользователя.

Выдели ключевые слова названия задачи: существительные и имена, без глаголов-команд («закрой», «найди», «перенеси»), без слов «задача», «про», «по». Слова оставляй в той форме, как в тексте.

Поле done: true, если пользователь сообщает, что задача уже сделана («я сделал отчёт по вэду»), и false, если просит что-то сделать или просто найти.

Верни JSON: { "query": "ключевые слова", "done": false }`;

export async function extractSearchQuery(
  text: string,
  options: Options = {},
): Promise<{ query: string; done: boolean }> {
  try {
    const { content } = await chatJson({
      system: SYSTEM,
      user: text,
      model: MODELS.agent,
      provider: options.provider,
      fetchFn: options.fetchFn,
    });
    const parsed = JSON.parse(content) as { query?: unknown; done?: unknown };
    const query = typeof parsed.query === "string" ? parsed.query.trim() : "";
    if (!query) return { query: text, done: false };
    return { query, done: parsed.done === true };
  } catch {
    return { query: text, done: false };
  }
}
