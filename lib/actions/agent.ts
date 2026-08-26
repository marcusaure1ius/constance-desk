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
): Promise<{ ok: boolean; error?: string }> {
  const results = await applyAgentCalls(calls);
  revalidatePath("/");

  const failed = results.find((r) => !r.ok);
  return failed && !failed.ok ? { ok: false, error: failed.error } : { ok: true };
}
