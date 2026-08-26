"use server";

import { revalidatePath } from "next/cache";
import { applyAgentCalls, type DeferredCall } from "@/lib/agent/apply";

/**
 * `revalidatePath` здесь обязателен: инструменты реестра зовут сервисы напрямую
 * и про Next.js ничего не знают. Без него доска не перерисуется, и пользователю
 * покажется, что подтверждение ничего не сделало.
 */
export async function applyAgentCallsAction(
  calls: DeferredCall[]
): Promise<{ applied: number; failed: { tool: string; error: string }[] }> {
  const results = await applyAgentCalls(calls);
  revalidatePath("/");

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
