"use server";

import { revalidatePath } from "next/cache";
import { applyAgentCalls, type DeferredCall } from "@/lib/agent/apply";
import { getBoardSnapshot } from "@/lib/agent/board";
import { draftDescription, improveTitle } from "@/lib/llm/task-help";
import { suggestChips } from "@/lib/llm/suggest-chips";

/**
 * `revalidatePath` здесь обязателен: инструменты реестра зовут сервисы напрямую
 * и про Next.js ничего не знают. Без него доска не перерисуется, и пользователю
 * покажется, что подтверждение ничего не сделало. "/today" — по той же причине,
 * что и в `lib/actions/tasks.ts`: `update_task` и `move_task` меняют плановую
 * дату и позицию, которые видны на странице «План на день».
 */
export async function applyAgentCallsAction(
  calls: DeferredCall[]
): Promise<{ applied: number; failed: { tool: string; error: string }[] }> {
  const results = await applyAgentCalls(calls);
  revalidatePath("/");
  revalidatePath("/today");

  const applied = results.filter((r) => r.ok).length;
  const failed: { tool: string; error: string }[] = [];

  results.forEach((result, i) => {
    if (!result.ok) {
      const tool = calls[i]?.tool || "unknown";
      failed.push({ tool, error: result.error });
    }
  });

  return { applied, failed };
}

export async function improveTaskTitleAction(title: string): Promise<string> {
  if (!title.trim()) return title;
  return improveTitle(title.trim());
}

export async function draftTaskDescriptionAction(input: {
  title: string;
  description: string;
}): Promise<string> {
  if (!input.title.trim()) return input.description;
  return draftDescription({ title: input.title.trim(), description: input.description });
}

/**
 * Подсказки-чипсы для пустой ленты агента, собранные моделью по содержимому
 * доски (`lib/llm/suggest-chips.ts`).
 *
 * Любая ошибка — среда не найдена, модель недоступна — тихо становится
 * пустым списком, а не исключением: подсказки не та вещь, ради которой стоит
 * показывать пользователю ошибку. Пустой список на клиенте — сигнал показать
 * статичный откат (`components/agent/agent-chat.tsx`).
 */
export async function suggestChipsAction(environmentId: string): Promise<string[]> {
  try {
    const snapshot = await getBoardSnapshot(environmentId);
    if (!snapshot) return [];
    return await suggestChips(snapshot);
  } catch (error) {
    console.error("[agent] suggestChipsAction", error);
    return [];
  }
}
