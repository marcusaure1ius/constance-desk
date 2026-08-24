import { after } from "next/server";
import {
  defaultDeps,
  handleUpdate,
  receiveUpdate,
  type ReceiveUpdateResult,
} from "@/lib/telegram/handle-update";
import type { TelegramUpdate } from "@/lib/telegram/types";
import { isValidWebhookSecret } from "@/lib/telegram/webhook";

/**
 * Вебхук Telegram — шим вокруг after(): вся логика в receiveUpdate и
 * handleUpdate, потому что after() исполняется только в реальном запросе.
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

  // Дедлайн функции отсчитывается от начала запроса, а after() живёт внутри
  // той же функции: клиент Bot API не должен пережидать флуд-лимит дольше,
  // чем нам осталось.
  const deps = defaultDeps({ deadlineAt: Date.now() + maxDuration * 1000 });

  let received: ReceiveUpdateResult;
  try {
    // Запись в журнал — до ответа 200, а не в after(): с момента ответа
    // Telegram считает апдейт доставленным и второй раз его не пришлёт.
    // Убьют функцию сразу после ответа — сообщение уже сохранено.
    received = await receiveUpdate(update, deps);
  } catch (error) {
    // Журнал недоступен. Не-2xx выглядит честнее, но запускает сутки ретраев
    // в ту же мёртвую базу и задерживает всю очередь апдейтов, поэтому
    // отвечаем 200, а апдейт целиком кладём в лог — там его видно.
    console.error("[telegram] апдейт не записан в журнал", update, error);
    return new Response("OK");
  }

  // duplicate и ignored не доходят до after(): повторная доставка и чужой чат
  // отсекаются до любой работы.
  if (received.status === "accepted") {
    const { chatId } = received;
    after(async () => {
      try {
        await handleUpdate(update, chatId, deps);
      } catch (error) {
        // Сюда попадают только сбои самих отметок в журнале: остальное
        // handleUpdate ловит сам и помечает апдейт как failed.
        console.error("[telegram] обработка апдейта упала", error);
      }
    });
  }

  return new Response("OK");
}
