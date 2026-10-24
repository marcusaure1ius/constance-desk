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

/** Голосовое сообщение. Bot API отдаёт ogg/opus, длительность — в секундах. */
export type TelegramVoice = {
  file_id: string;
  file_unique_id: string;
  duration: number;
  mime_type?: string;
  file_size?: number;
};

/** Сущность разметки текста: ссылка в тексте (`url`) или со скрытым адресом (`text_link`). */
export type TelegramEntity = {
  type: string;
  offset: number;
  length: number;
  url?: string;
};

/** Откуда переслано сообщение. Для скрытых аккаунтов имя приходит строкой. */
export type TelegramForwardOrigin = {
  type: "user" | "hidden_user" | "chat" | "channel";
  sender_user?: TelegramUser;
  sender_user_name?: string;
  sender_chat?: TelegramChat;
  chat?: TelegramChat;
  message_id?: number;
};

export type TelegramMessage = {
  message_id: number;
  date: number;
  /**
   * Момент последней правки. Карточка задачи живёт правками, поэтому срок
   * годности кнопок считается по нему, а не только по дате отправки.
   */
  edit_date?: number;
  chat: TelegramChat;
  from?: TelegramUser;
  text?: string;
  caption?: string;
  voice?: TelegramVoice;
  /** Аудиофайл (не голосовое): имя нужно Whisper, он определяет контейнер по расширению. */
  audio?: TelegramVoice & { file_name?: string };
  photo?: { file_id: string }[];
  document?: { file_id: string; file_name?: string };
  entities?: TelegramEntity[];
  caption_entities?: TelegramEntity[];
  forward_origin?: TelegramForwardOrigin;
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
