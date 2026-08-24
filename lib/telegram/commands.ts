import type { TelegramBotCommand } from "@/lib/telegram/types";

/**
 * Команды меню бота.
 *
 * Отдельным модулем без зависимостей: этот список нужен и обработчику апдейтов,
 * и скрипту установки вебхука. Скрипт запускается вне приложения, и тянуть
 * через него слой базы незачем — `lib/db` требует DATABASE_URL уже на импорте.
 */
export const BOT_COMMANDS: TelegramBotCommand[] = [
  { command: "start", description: "Что умеет бот и какой проект активен" },
  { command: "help", description: "Список команд" },
];
