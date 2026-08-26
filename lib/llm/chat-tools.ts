import type { FunctionSpec } from "@/lib/agent/tool-registry";
import {
  LlmError,
  resolveProviders,
  withFailover,
  type LlmProvider,
  type ModelPair,
  type ProviderName,
} from "./client";

/**
 * Вызов модели с инструментами.
 *
 * Отдельно от `chatJson`, потому что задача другая: там ответ обязан быть
 * JSON-объектом (`response_format`), здесь модель сама решает — ответить
 * текстом или попросить инструмент. Общее у них только падение к следующему
 * провайдеру, и оно вынесено в `withFailover`.
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
  models: ModelPair;
  tools: FunctionSpec[];
  temperature?: number;
  providers?: LlmProvider[];
  env?: Record<string, string | undefined>;
  fetchFn?: typeof fetch;
};

export async function chatTools(input: ChatToolsInput): Promise<ChatToolsResult> {
  const providers = input.providers ?? resolveProviders(input.models, input.env);
  const fetchFn = input.fetchFn ?? fetch;

  return withFailover(providers, (provider) => callProvider(provider, input, fetchFn));
}

async function callProvider(
  provider: LlmProvider,
  input: ChatToolsInput,
  fetchFn: typeof fetch
): Promise<ChatToolsResult> {
  const response = await fetchFn(`${provider.baseUrl}/chat/completions`, {
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
    }),
  });

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
