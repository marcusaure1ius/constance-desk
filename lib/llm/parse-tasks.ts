import { chatJson, MODELS, type LlmProvider } from "@/lib/llm/client";

/**
 * Разбор текста на задачи для веб-формы SmartInput.
 *
 * Это НЕ путь телеграм-бота: там свой промпт (`lib/llm/capture.ts`), который
 * не переписывает формулировки и возвращает элементы разных типов. Здесь
 * пользователь видит результат в форме и правит его до сохранения, поэтому
 * вольности модели ему не опасны — он их просто исправит.
 */

export type ParsedTask = {
  title: string;
  priority?: "urgent" | "high" | "normal";
  plannedDate?: string;
};

const SYSTEM_PROMPT = `Ты — ассистент канбан-доски. Твоя задача — разобрать входящий текст пользователя на отдельные задачи.

Текст может быть:
- Скопирован из мессенджера (Telegram, Slack)
- Надиктован голосом (может содержать слова-паразиты, повторы)
- Написан в свободной форме, несколько задач в одном потоке

Для каждой задачи извлеки:
- title (обязательно) — краткое, чёткое название задачи в повелительном наклонении. Убери мусор, слова-паразиты, вводные слова. Пример: "ну ещё надо бы починить этот баг с логином" → "Починить баг с логином"
- priority — определи по контексту:
  - "urgent" — слова: срочно, ASAP, горит, критично, блокер
  - "high" — слова: важно, приоритетно, нужно побыстрее
  - "normal" — по умолчанию, если нет явных маркеров
- plannedDate — если указан срок, преобразуй в формат "yyyy-MM-dd". Сегодня: {today}. Примеры:
  - "до пятницы" → ближайшая пятница
  - "к 10 апреля" → "2026-04-10"
  - "на следующей неделе" → понедельник следующей недели
  - Если срок не указан — не включай поле

Верни JSON:
{
  "tasks": [
    { "title": "...", "priority": "normal" },
    { "title": "...", "priority": "urgent", "plannedDate": "2026-04-10" }
  ]
}

Правила:
- Если текст содержит одну задачу — верни массив из одного элемента
- Не выдумывай задачи, которых нет в тексте
- Не объединяй разные задачи в одну
- Если текст невозможно разобрать на задачи — верни { "tasks": [] }`;

export function buildParseTasksPrompt(today: string) {
  return SYSTEM_PROMPT.replace("{today}", today);
}

export function parseTasksResponse(raw: string): ParsedTask[] {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.tasks)) return [];
    return parsed.tasks.filter(
      (t: Record<string, unknown>) => typeof t.title === "string" && t.title.trim().length > 0
    );
  } catch {
    return [];
  }
}

export async function parseTasks(
  text: string,
  options: { providers?: LlmProvider[]; fetchFn?: typeof fetch } = {}
): Promise<ParsedTask[]> {
  const today = new Date().toISOString().split("T")[0];

  const { content } = await chatJson({
    system: buildParseTasksPrompt(today),
    user: text,
    models: MODELS.smartInput,
    providers: options.providers,
    fetchFn: options.fetchFn,
  });

  return parseTasksResponse(content);
}
