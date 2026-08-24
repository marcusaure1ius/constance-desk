/**
 * Управление вебхуком бота.
 *
 *   npx tsx scripts/telegram-webhook.ts info
 *   npx tsx scripts/telegram-webhook.ts set https://constance.example.com
 *   npx tsx scripts/telegram-webhook.ts commands
 *   npx tsx scripts/telegram-webhook.ts delete
 *
 * Токен и секрет берутся из .env.local (TELEGRAM_BOT_TOKEN,
 * TELEGRAM_WEBHOOK_SECRET). Секрет обязателен: без него вебхук открыт всем,
 * кто узнал адрес.
 */
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

import { createTelegramClient } from "../lib/telegram/client";
import { BOT_COMMANDS } from "../lib/telegram/commands";

const WEBHOOK_PATH = "/api/telegram/webhook";

type WebhookInfo = {
  url: string;
  has_custom_certificate: boolean;
  pending_update_count: number;
  last_error_date?: number;
  last_error_message?: string;
  max_connections?: number;
  allowed_updates?: string[];
};

async function main() {
  const [command, argument] = process.argv.slice(2);
  const client = createTelegramClient();

  switch (command) {
    case "info": {
      const info = await client.call<WebhookInfo>("getWebhookInfo");
      console.log(JSON.stringify(info, null, 2));
      if (info.last_error_message) {
        console.error(`Последняя ошибка доставки: ${info.last_error_message}`);
      }
      break;
    }

    case "set": {
      const secret = requireSecret();
      const base = argument?.replace(/\/$/, "");
      if (!base) throw new Error("Укажите базовый URL: set https://example.com");

      await client.call("setWebhook", {
        url: `${base}${WEBHOOK_PATH}`,
        secret_token: secret,
        // Читаем только то, что умеем обрабатывать: лишние типы апдейтов
        // впустую жгут дедлайн функции.
        allowed_updates: ["message", "edited_message", "callback_query"],
        drop_pending_updates: false,
      });
      console.log(`Вебхук установлен: ${base}${WEBHOOK_PATH}`);

      await setCommands(client);
      break;
    }

    case "commands": {
      await setCommands(client);
      break;
    }

    case "delete": {
      await client.call("deleteWebhook", { drop_pending_updates: false });
      console.log("Вебхук снят");
      break;
    }

    default:
      console.error(
        "Команды: info | set <базовый URL> | commands | delete\n" +
          "Пример: npx tsx scripts/telegram-webhook.ts set https://constance.example.com"
      );
      process.exitCode = 1;
  }
}

async function setCommands(client: ReturnType<typeof createTelegramClient>) {
  await client.setMyCommands(BOT_COMMANDS);
  const registered = await client.getMyCommands();
  console.log("Команды в меню:");
  for (const command of registered) {
    console.log(`  /${command.command} — ${command.description}`);
  }
}

function requireSecret(): string {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret) {
    throw new Error(
      "TELEGRAM_WEBHOOK_SECRET не задан. Сгенерируйте: openssl rand -hex 32"
    );
  }
  return secret;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
