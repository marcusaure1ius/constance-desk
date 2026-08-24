import { timingSafeEqual } from "node:crypto";

/**
 * Проверка заголовка X-Telegram-Bot-Api-Secret-Token.
 *
 * Секрет задаётся при setWebhook и приходит с каждым апдейтом — это
 * единственное, что отличает Telegram от любого, кто узнал адрес вебхука.
 * Не задан в окружении — не пускаем никого: открытый вебхук хуже молчащего.
 */
export function isValidWebhookSecret(header: string | null | undefined): boolean {
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!expected || !header) return false;

  const received = Buffer.from(header);
  const known = Buffer.from(expected);
  if (received.length !== known.length) return false;

  return timingSafeEqual(received, known);
}
