import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { inArray } from "drizzle-orm";

/*
 * Дедуп повторной доставки — это ON CONFLICT DO NOTHING RETURNING, то есть
 * поведение PostgreSQL, а не нашего кода. На моках drizzle такой тест ничего
 * не доказывает, поэтому журнал проверяется на настоящей базе.
 *
 * В основной прогон (npm test) не попадают: файлы *.integration.test.ts
 * исключены маской в vitest.config.ts.
 *
 * Запуск: TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:55455/constance_ci \
 *   npm run test:integration:db
 */

// Пропуска (describe.skipIf) здесь намеренно нет: без базы прогон был бы зелёным,
// не проверив ничего. Без TEST_DATABASE_URL createTestDb падает — и файл падает
// вместе с ним, так что «зелёный» значит «проверено».
vi.mock("@/lib/db", async () => {
  const { createTestDb } = await import("./helpers/test-db");
  return { db: createTestDb() };
});

import {
  getUpdate,
  markUpdateFailed,
  markUpdateProcessed,
  recordUpdate,
} from "@/lib/services/tg-updates";
import { tgUpdates } from "@/lib/db/schema";
import { closeTestDb, createTestDb } from "./helpers/test-db";

const IDS = [900001, 900002, 900003, 900004, 900005, 900006];

describe("журнал апдейтов на настоящей базе", () => {
  beforeAll(async () => {
    const db = createTestDb();
    await db.delete(tgUpdates).where(inArray(tgUpdates.updateId, IDS));
  });

  afterAll(async () => {
    const db = createTestDb();
    await db.delete(tgUpdates).where(inArray(tgUpdates.updateId, IDS));
    await closeTestDb();
  });

  it("записывает апдейт целиком и отдаёт true", async () => {
    const payload = { update_id: 900001, message: { text: "купить билеты" } };
    expect(await recordUpdate({ updateId: 900001, chatId: 555, rawText: "купить билеты", payload })).toBe(
      true
    );

    const row = await getUpdate(900001);
    expect(row).toMatchObject({
      updateId: 900001,
      chatId: 555,
      rawText: "купить билеты",
      status: "received",
      error: null,
      processedAt: null,
    });
    expect(row!.payload).toEqual(payload);
    expect(row!.createdAt).toBeInstanceOf(Date);
  });

  it("повторная доставка отдаёт false и не затирает запись", async () => {
    await recordUpdate({ updateId: 900002, chatId: 555, rawText: "первый", payload: { n: 1 } });
    const second = await recordUpdate({
      updateId: 900002,
      chatId: 777,
      rawText: "второй",
      payload: { n: 2 },
    });

    expect(second).toBe(false);
    const row = await getUpdate(900002);
    expect(row).toMatchObject({ chatId: 555, rawText: "первый" });
    expect(row!.payload).toEqual({ n: 1 });
  });

  it("одновременная доставка одного update_id проходит ровно один раз", async () => {
    // Telegram шлёт апдейты параллельно (max_connections 40) и может повторить
    // доставку — гонка здесь настоящая, а не гипотетическая.
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        recordUpdate({ updateId: 900003, chatId: 555, rawText: "гонка", payload: { n: 3 } })
      )
    );

    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("помечает апдейт обработанным", async () => {
    await recordUpdate({ updateId: 900004, chatId: 555, rawText: "/start", payload: {} });
    await markUpdateProcessed(900004);

    const row = await getUpdate(900004);
    expect(row).toMatchObject({ status: "processed", error: null });
    expect(row!.processedAt).toBeInstanceOf(Date);
  });

  it("помечает апдейт упавшим и хранит причину", async () => {
    await recordUpdate({ updateId: 900005, chatId: 555, rawText: "/start", payload: {} });
    await markUpdateFailed(900005, "Telegram недоступен");

    const row = await getUpdate(900005);
    expect(row).toMatchObject({ status: "failed", error: "Telegram недоступен" });
    expect(row!.processedAt).toBeInstanceOf(Date);
  });

  it("хранит длинный chat_id канала без потери точности", async () => {
    const chatId = -1001234567890;
    await recordUpdate({ updateId: 900006, chatId, payload: {} });

    const row = await getUpdate(900006);
    expect(row!.chatId).toBe(chatId);
    expect(row!.rawText).toBeNull();
  });
});
