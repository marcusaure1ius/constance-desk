import { after } from "next/server";
import { defaultDeps, handleUpdate } from "@/lib/telegram/handle-update";
import type { TelegramUpdate } from "@/lib/telegram/types";
import { isValidWebhookSecret } from "@/lib/telegram/webhook";

/**
 * Вебхук Telegram — шим вокруг after(): вся логика в handleUpdate, потому что
 * after() исполняется только в реальном запросе.
 *
 * Отвечаем 200 всегда, кроме неверного секрета: на любой не-2xx Telegram
 * ретраит с экспонентой до суток.
 */

// after() делит дедлайн с запросом; без явного лимита промис отменится молча.
export const maxDuration = 60;

export async function POST(request: Request) {
  if (!isValidWebhookSecret(request.headers.get("x-telegram-bot-api-secret-token"))) {
    return new Response("Unauthorized", { status: 401 });
  }

  let update: TelegramUpdate;
  try {
    update = (await request.json()) as TelegramUpdate;
  } catch {
    // Битое тело повторной доставкой не починится — забираем и молчим.
    return new Response("OK");
  }

  after(async () => {
    try {
      await handleUpdate(update, defaultDeps());
    } catch (error) {
      // Сюда попадают только сбои самой записи в журнал: остальное handleUpdate
      // ловит сам и помечает апдейт как failed.
      console.error("[telegram] обработка апдейта упала", error);
    }
  });

  return new Response("OK");
}
