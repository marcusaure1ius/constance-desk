import { runTool, type Tool, type ToolOutcome } from "./tool-registry";
import { toolsFor } from "./tools";

/**
 * Исполнение отложенных вызовов — после того, как пользователь нажал кнопку.
 *
 * Модель здесь не участвует: аргументы уже согласованы, остаётся прогнать их
 * через тот же реестр. Провал вызова — значение, а не исключение: половина
 * предложения могла примениться, и об этом надо сказать честно.
 */

export type DeferredCall = {
  tool: string;
  args: unknown;
  /**
   * Человеческое описание вызова: «Удалить «Демка»», «Изменить «Демка»: срок».
   * Заполняется в цикле (`lib/agent/loop.ts`) из уже прочитанных задач —
   * подтверждение бесполезно, если не видно, что именно меняют или удаляют.
   */
  label?: string;
};

export async function applyAgentCalls(
  calls: DeferredCall[],
  tools: Tool[] = toolsFor({ surface: "chat" })
): Promise<ToolOutcome[]> {
  const results: ToolOutcome[] = [];

  for (const call of calls) {
    const tool = tools.find((t) => t.name === call.tool);
    if (!tool) {
      results.push({ ok: false, error: `Неизвестный инструмент: ${call.tool}` });
      continue;
    }
    results.push(await runTool(tool, call.args));
  }

  return results;
}
