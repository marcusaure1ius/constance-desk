import { buildAgentPrompt } from "@/lib/llm/agent-prompt";
import { chatTools, type ChatMessage } from "@/lib/llm/chat-tools";
import { MODELS } from "@/lib/llm/client";
import type { AgentEvent } from "./events";
import {
  isDeferred,
  runTool,
  toFunctionSpec,
  type Tool,
} from "./tool-registry";
import { toolsFor } from "./tools";

/**
 * Цикл «модель ↔ инструменты».
 *
 * Генератор, а не функция с колбэком: события нужны браузеру по мере
 * появления, а `for await` в роуте читается лучше, чем подписка.
 *
 * Главное свойство — перехват. Инструменты с `impact: "irreversible"` модель
 * видит и вызывает как обычно, но цикл их не исполняет: аргументы уходят
 * пользователю предложением. Запрет живёт здесь, а не в промпте, потому что
 * промпт — это текст, а текст модель вправе проигнорировать.
 */

export type RunAgentOptions = {
  message: string;
  history?: ChatMessage[];
  environmentId: string;
  today?: string;
  tools?: Tool[];
  chat?: typeof chatTools;
  maxSteps?: number;
};

export async function* runAgent(options: RunAgentOptions): AsyncGenerator<AgentEvent> {
  const tools = options.tools ?? toolsFor({ surface: "chat" });
  const chat = options.chat ?? chatTools;
  const maxSteps = options.maxSteps ?? 6;
  const today = options.today ?? new Date().toISOString().slice(0, 10);
  const specs = tools.map(toFunctionSpec);

  const messages: ChatMessage[] = [
    {
      role: "system",
      content: buildAgentPrompt({ today, environmentId: options.environmentId }),
    },
    ...(options.history ?? []),
    { role: "user", content: options.message },
  ];

  const deferred: { tool: string; args: unknown }[] = [];

  try {
    yield { type: "thinking" };

    for (let step = 0; step < maxSteps; step++) {
      const reply = await chat({ messages, models: MODELS.agent, tools: specs });

      if (reply.toolCalls.length === 0) {
        if (reply.content.trim()) yield { type: "text", text: reply.content.trim() };
        if (deferred.length > 0) {
          yield { type: "proposal", id: `p${step}`, calls: deferred };
        }
        return;
      }

      messages.push({ role: "assistant", content: reply.content, tool_calls: reply.raw });

      for (const call of reply.toolCalls) {
        const tool = tools.find((t) => t.name === call.tool);

        if (!tool) {
          yield { type: "tool_end", id: call.id, tool: call.tool, error: "Неизвестный инструмент" };
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: JSON.stringify({ ok: false, error: "Неизвестный инструмент" }),
          });
          continue;
        }

        if (isDeferred(tool)) {
          deferred.push({ tool: call.tool, args: call.args });
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: JSON.stringify({
              ok: true,
              deferred: true,
              note: "Отложено: пользователь подтвердит вручную. Повторять вызов не нужно.",
            }),
          });
          continue;
        }

        yield { type: "tool_start", id: call.id, tool: call.tool, args: call.args };

        const outcome = await runTool(tool, call.args);

        yield outcome.ok
          ? { type: "tool_end", id: call.id, tool: call.tool, result: summarizeResult(outcome.data) }
          : { type: "tool_end", id: call.id, tool: call.tool, error: outcome.error };

        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify(
            outcome.ok ? { ok: true, data: outcome.data } : { ok: false, error: outcome.error }
          ),
        });
      }
    }

    yield { type: "error", message: "Агент не уложился в отведённые шаги" };
  } catch (error) {
    yield {
      type: "error",
      message: error instanceof Error ? error.message : "Модель недоступна",
    };
  }
}

/** Короткая сводка ответа инструмента — она идёт в строку следа, а не в модель. */
export function summarizeResult(data: unknown): string {
  if (Array.isArray(data)) return `${data.length} ${plural(data.length, "элемент", "элемента", "элементов")}`;

  if (data && typeof data === "object") {
    const tasks = (data as { tasks?: unknown }).tasks;
    if (Array.isArray(tasks)) {
      return `${tasks.length} ${plural(tasks.length, "задача", "задачи", "задач")}`;
    }
  }

  return JSON.stringify(data ?? null).slice(0, 80);
}

function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}
