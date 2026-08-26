import type { ChatMessage } from "@/lib/llm/chat-tools";

/**
 * История переписки: пары «вопрос пользователя → текстовый ответ агента».
 *
 * Не всё, что есть в ленте, годится в историю: служебные события (шаги
 * инструментов, ошибки) и предложения (create/update/delete) — не реплики
 * разговора, а UI-состояние. Модели нужен только текст.
 */

/** Ограничивает историю разумным числом последних сообщений — не весь разговор целиком. */
const MAX_HISTORY_MESSAGES = 20;

/** Запись ленты в объёме, нужном для построения истории — без привязки к типу хука. */
export type HistoryEntry =
  | { role: "user"; text: string }
  | { role: "agent"; text?: string };

/** Строит историю для отправки на сервер из записей ленты клиента. */
export function toHistoryMessages(entries: readonly HistoryEntry[]): ChatMessage[] {
  const messages: ChatMessage[] = [];

  for (const entry of entries) {
    if (entry.role === "user") {
      messages.push({ role: "user", content: entry.text });
    } else if (entry.text) {
      messages.push({ role: "assistant", content: entry.text });
    }
  }

  return messages.slice(-MAX_HISTORY_MESSAGES);
}

/**
 * Валидирует историю из тела запроса. `body.history` приходит от клиента
 * голым JSON — без проверки клиент мог бы подсунуть поддельные `tool`-ответы
 * модели или чужой `system`-промпт. Пропускаются только `user` и `assistant`
 * с текстовым содержимым.
 */
export function parseHistory(raw: unknown): ChatMessage[] {
  if (!Array.isArray(raw)) return [];

  const messages: ChatMessage[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const { role, content } = item as Record<string, unknown>;
    if ((role !== "user" && role !== "assistant") || typeof content !== "string") continue;
    messages.push({ role, content });
  }

  return messages.slice(-MAX_HISTORY_MESSAGES);
}
