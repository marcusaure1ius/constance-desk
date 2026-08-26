import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { tgUpdates } from "@/lib/db/schema";

/**
 * Журнал входящих апдейтов Telegram.
 *
 * Апдейт пишется до любой обработки: Telegram считает сообщение доставленным,
 * как только вебхук ответил 200, и второй раз его не пришлёт. Первичный ключ
 * update_id одновременно служит дедупом повторной доставки.
 */

export type RecordUpdateInput = {
  updateId: number;
  chatId?: number;
  rawText?: string;
  payload: unknown;
};

/** true — апдейт записан впервые; false — такой update_id уже приходил. */
export async function recordUpdate(input: RecordUpdateInput): Promise<boolean> {
  const rows = await db
    .insert(tgUpdates)
    .values({
      updateId: input.updateId,
      chatId: input.chatId ?? null,
      rawText: input.rawText ?? null,
      payload: input.payload,
    })
    .onConflictDoNothing({ target: tgUpdates.updateId })
    .returning({ updateId: tgUpdates.updateId });

  return rows.length > 0;
}

/**
 * Разбор сообщения — то, что бот из него понял. Пишется рядом со статусом,
 * чтобы качество разбора можно было смотреть пачкой, а не по одной карточке
 * в телефоне.
 */
export type ParsedSummary = unknown;

export async function markUpdateProcessed(
  updateId: number,
  parsed?: ParsedSummary
): Promise<void> {
  await db
    .update(tgUpdates)
    .set({
      status: "processed",
      processedAt: new Date(),
      error: null,
      // undefined не затирает: у команд и нажатий кнопок разбора нет, и
      // прошлый разбор при повторной обработке терять незачем.
      ...(parsed === undefined ? {} : { parsed }),
    })
    .where(eq(tgUpdates.updateId, updateId));
}

export async function markUpdateFailed(updateId: number, error: string): Promise<void> {
  await db
    .update(tgUpdates)
    .set({ status: "failed", processedAt: new Date(), error })
    .where(eq(tgUpdates.updateId, updateId));
}

export async function getUpdate(updateId: number) {
  const [row] = await db.select().from(tgUpdates).where(eq(tgUpdates.updateId, updateId));
  return row ?? null;
}
