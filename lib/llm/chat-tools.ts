import type { FunctionSpec } from "@/lib/agent/tool-registry";
import { LlmError, resolveProvider, type LlmProvider, type ProviderName } from "./client";

/**
 * Вызов модели с инструментами.
 *
 * Отдельно от `chatJson`, потому что задача другая: там ответ обязан быть
 * JSON-объектом (`response_format`), здесь модель сама решает — ответить
 * текстом или попросить инструмент.
 */

export type RawToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

export type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: RawToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export type ToolCall = { id: string; tool: string; args: unknown };

export type ChatToolsResult = {
  content: string;
  toolCalls: ToolCall[];
  /** Сырой ответ модели — его же нужно вернуть в историю следующим шагом. */
  raw: RawToolCall[];
  provider: ProviderName;
  model: string;
};

export type ChatToolsInput = {
  messages: ChatMessage[];
  model: string;
  tools: FunctionSpec[];
  temperature?: number;
  provider?: LlmProvider;
  env?: Record<string, string | undefined>;
  fetchFn?: typeof fetch;
  /** Сколько ждать ответа модели. По умолчанию — CHAT_TIMEOUT_MS. */
  timeoutMs?: number;
};

/**
 * Без потолка зависший провайдер держит запрос до убийства функции платформой,
 * и пользователь не узнаёт о сбое. Шаг агента обычно отвечает за секунды.
 */
export const CHAT_TIMEOUT_MS = 45_000;

export async function chatTools(input: ChatToolsInput): Promise<ChatToolsResult> {
  const provider = input.provider ?? resolveProvider(input.model, input.env);
  return callProvider(provider, input, input.fetchFn ?? fetch);
}

async function callProvider(
  provider: LlmProvider,
  input: ChatToolsInput,
  fetchFn: typeof fetch
): Promise<ChatToolsResult> {
  const timeoutMs = input.timeoutMs ?? CHAT_TIMEOUT_MS;
  let response: Response;
  try {
    response = await fetchFn(`${provider.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${provider.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: provider.model,
        messages: input.messages,
        tools: input.tools,
        temperature: input.temperature ?? 0.2,
        // Рассуждения DeepSeek — главная задержка агента: на вопрос по доске модель
        // «думала» ~1000 токенов, ответ шёл 6–20 с. Без них — 2–5 с, а выбор
        // инструментов и ответы по снимку доски не хуже.
        reasoning: { enabled: false },
        // Из апстримов OpenRouter — самый быстрый по выдаче токенов, а не дешёвый.
        provider: { sort: "throughput" },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      throw new Error(`Модель не ответила за ${Math.round(timeoutMs / 1000)} с`);
    }
    throw error;
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => response.statusText);
    throw new LlmError(provider.name, response.status, detail.slice(0, 200));
  }

  const data = (await response.json()) as {
    choices?: { message?: { content?: string | null; tool_calls?: RawToolCall[] } }[];
  };
  const message = data.choices?.[0]?.message;
  const raw = message?.tool_calls ?? [];

  return {
    content: message?.content ?? "",
    toolCalls: raw.map((call) => ({
      id: call.id,
      tool: call.function.name,
      args: parseArgs(call.function.arguments),
    })),
    raw,
    provider: provider.name,
    model: provider.model,
  };
}

/** Аргументы приходят строкой. Модель иногда портит JSON — это не повод падать. */
function parseArgs(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}
