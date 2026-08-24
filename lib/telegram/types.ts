/**
 * Минимальные типы Bot API — только те поля, которые бот действительно читает.
 * Полную схему тянуть незачем: Telegram присылает объекты с десятками полей,
 * а лишние типы устаревают быстрее, чем их успевают прочитать.
 */

export type TelegramChat = {
  id: number;
  type: string;
  title?: string;
  username?: string;
  first_name?: string;
};

export type TelegramUser = {
  id: number;
  is_bot: boolean;
  first_name: string;
  username?: string;
};

export type TelegramMessage = {
  message_id: number;
  date: number;
  chat: TelegramChat;
  from?: TelegramUser;
  text?: string;
  caption?: string;
};

export type TelegramCallbackQuery = {
  id: string;
  from: TelegramUser;
  data?: string;
  message?: TelegramMessage;
};

export type TelegramUpdate = {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
  channel_post?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
};

export type TelegramFile = {
  file_id: string;
  file_unique_id: string;
  file_size?: number;
  file_path?: string;
};

export type TelegramBotCommand = {
  command: string;
  description: string;
};

/** Сообщение апдейта, каким бы полем оно ни пришло. */
export function updateMessage(update: TelegramUpdate): TelegramMessage | undefined {
  return (
    update.message ??
    update.edited_message ??
    update.channel_post ??
    update.callback_query?.message
  );
}

/** Чат, из которого пришёл апдейт. */
export function updateChatId(update: TelegramUpdate): number | undefined {
  return updateMessage(update)?.chat.id ?? update.callback_query?.from.id;
}

/** Текст апдейта: подпись к вложению — тоже текст. */
export function updateText(update: TelegramUpdate): string | undefined {
  const message = updateMessage(update);
  return update.callback_query?.data ?? message?.text ?? message?.caption;
}
