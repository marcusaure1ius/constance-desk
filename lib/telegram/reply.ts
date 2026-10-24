import { TelegramApiError, type TelegramClient } from "@/lib/telegram/client";
import type { TaskCard } from "@/lib/telegram/task-card";

/**
 * Показ карточек бота: правкой сообщения или новым. Общий для обработчика
 * апдейтов и потока черновика — терпимость к «message is not modified» должна
 * быть одна на весь бот.
 */

export type ReplyDeps = {
  client: Pick<TelegramClient, "sendMessage" | "editMessageText">;
};

/**
 * Показать карточку: правкой сообщения, если известно какого, иначе новым.
 *
 * Отсутствие `reply_markup` в editMessageText снимает клавиатуру — на этом
 * держится снятие кнопок у удалённой задачи и у протухшего сообщения.
 */
export async function showCard(
  chatId: number,
  messageId: number | undefined,
  card: TaskCard,
  deps: ReplyDeps
): Promise<void> {
  if (messageId === undefined) {
    await deps.client.sendMessage({
      chatId,
      text: card.text,
      replyMarkup: card.replyMarkup,
    });
    return;
  }

  try {
    await deps.client.editMessageText({
      chatId,
      messageId,
      text: card.text,
      replyMarkup: card.replyMarkup,
    });
  } catch (error) {
    // «Message is not modified» — не сбой: пользователь нажал кнопку,
    // которая ничего не изменила. Ронять из-за неё обработку апдейта нельзя.
    if (!isNotModified(error)) throw error;
  }
}

/**
 * Правка сообщения, которое могло исчезнуть: false — Telegram его не нашёл
 * или не даёт править. Прочие сбои пробрасываются — в том числе другие 400
 * (битая разметка, слишком длинный текст): сообщение на месте, и выдавать их
 * за «пропало» значит потерять его кнопки, оставив их рабочими.
 */
export async function tryEdit(
  chatId: number,
  messageId: number,
  card: TaskCard,
  deps: ReplyDeps
): Promise<boolean> {
  try {
    await showCard(chatId, messageId, card, deps);
    return true;
  } catch (error) {
    if (isGone(error)) return false;
    throw error;
  }
}

function isGone(error: unknown): boolean {
  return (
    error instanceof TelegramApiError &&
    error.status === 400 &&
    /message to edit not found|message can't be edited/i.test(error.description)
  );
}

function isNotModified(error: unknown): boolean {
  return (
    error instanceof TelegramApiError &&
    error.status === 400 &&
    /message is not modified/i.test(error.description)
  );
}
