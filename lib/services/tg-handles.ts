import { and, desc, eq, gt } from "drizzle-orm";
import { db } from "@/lib/db";
import { tgHandles } from "@/lib/db/schema";
import { newHandleId } from "@/lib/telegram/ids";

/**
 * Состояния за короткими кнопками.
 *
 * Две роли, обе вынужденные. Первая: в `callback_data` 64 байта, а поисковый
 * запрос произвольной длины — в кнопке «Ещё 4» лежит хендл, запрос здесь.
 * Вторая: «Название» и «Описание» меняют задачу не сразу, бот ждёт следующего
 * сообщения — и это ожидание надо где-то держать между двумя апдейтами.
 *
 * Сроки у этих двух ролей разные, и это главное здесь решение.
 */

/**
 * Хендл за кнопкой живёт неделю. Инлайн-клавиатура не исчезает сама: без срока
 * годности нажатие на карточке месячной давности выполняло бы действие, о
 * котором никто уже не помнит. Неделя — столько же, сколько живут сами кнопки
 * (`BUTTON_TTL_DAYS`): за ними стоят как раз эти записи.
 */
export const HANDLE_TTL_MINUTES = 7 * 24 * 60;

/**
 * Ожидание ввода живёт минуты, а не дни.
 *
 * Между нажатием «Название» и следующим сообщением проходят секунды: человек
 * читает вопрос и сразу отвечает. Недельный срок здесь оборачивался ловушкой —
 * нажал кнопку, отвлёкся, назавтра написал боту обычную задачу, и она молча
 * ушла в переименование старой. Пятнадцати минут хватает на «отвлекли на
 * звонок», а через сутки текст уже уходит на доску новой задачей.
 */
export const AWAIT_INPUT_TTL_MINUTES = 15;

/** Вид хендла. Строкой, а не enum: следующие задачи добавят свои. */
export type HandleKind = "search" | "await_input";

/** Срок годности по виду: ожидание ввода короткое, всё остальное — недельное. */
export function ttlMinutesFor(kind: HandleKind): number {
  return kind === "await_input" ? AWAIT_INPUT_TTL_MINUTES : HANDLE_TTL_MINUTES;
}

export type CreateHandleInput = {
  kind: HandleKind;
  payload: unknown;
  chatId?: number;
  messageId?: number;
  /** Явный срок в минутах. Не задан — берётся по виду хендла. */
  ttlMinutes?: number;
};

export type StoredHandle = {
  id: string;
  kind: string;
  payload: unknown;
  chatId: number | null;
  messageId: number | null;
};

function expiryFrom(ttlMinutes: number): Date {
  return new Date(Date.now() + ttlMinutes * 60_000);
}

export async function createHandle(input: CreateHandleInput): Promise<string> {
  const id = newHandleId();
  await db.insert(tgHandles).values({
    id,
    kind: input.kind,
    payload: input.payload,
    chatId: input.chatId ?? null,
    messageId: input.messageId ?? null,
    expiresAt: expiryFrom(input.ttlMinutes ?? ttlMinutesFor(input.kind)),
  });
  return id;
}

/**
 * Живой хендл по идентификатору. Протухший и отработанный — это null: срок
 * проверяется запросом, а не в коде, иначе «просроченность» зависела бы от
 * часов приложения, а не от базы.
 *
 * Читает, но не тратит: по кнопке «Ещё N» листают несколько раз подряд.
 */
export async function getHandle(id: string): Promise<StoredHandle | null> {
  const [row] = await db
    .select()
    .from(tgHandles)
    .where(
      and(
        eq(tgHandles.id, id),
        eq(tgHandles.status, "active"),
        gt(tgHandles.expiresAt, new Date())
      )
    );

  return row ?? null;
}

/** Помечает хендл отработанным. Повторное нажатие уже ничего не найдёт. */
export async function useHandle(id: string): Promise<void> {
  await db
    .update(tgHandles)
    .set({ status: "used" })
    .where(and(eq(tgHandles.id, id), eq(tgHandles.status, "active")));
}

/**
 * Забирает ожидание ввода для чата: следующее сообщение пользователя про
 * хендл ничего не знает, поэтому ищем по чату.
 *
 * Протухшее ожидание сюда не попадает — срок отсекает сам запрос. Для
 * вызывающего это неотличимо от «вопроса не задавали»: текст уходит обычным
 * путём в захват, то есть становится новой задачей, а не заголовком старой.
 *
 * Помечаем отработанным сразу и условно (`status = 'active'` в WHERE):
 * транзакций в neon-http нет, а два сообщения подряд обязаны разобрать
 * ожидание ровно один раз — иначе второе применит правку повторно.
 */
export async function takeAwaitInput(chatId: number): Promise<StoredHandle | null> {
  const [row] = await db
    .select()
    .from(tgHandles)
    .where(
      and(
        eq(tgHandles.chatId, chatId),
        eq(tgHandles.kind, "await_input"),
        eq(tgHandles.status, "active"),
        gt(tgHandles.expiresAt, new Date())
      )
    )
    .orderBy(desc(tgHandles.createdAt))
    .limit(1);

  if (!row) return null;

  const claimed = await db
    .update(tgHandles)
    .set({ status: "used" })
    .where(and(eq(tgHandles.id, row.id), eq(tgHandles.status, "active")))
    .returning({ id: tgHandles.id });

  return claimed.length > 0 ? row : null;
}

/**
 * Снимает ожидание ввода в чате: «← Назад» и любое другое нажатие отменяют
 * заданный вопрос. Иначе следующее сообщение молча ушло бы в название задачи
 * вместо новой записи на доску.
 */
export async function cancelAwaitInput(chatId: number): Promise<void> {
  await db
    .update(tgHandles)
    .set({ status: "cancelled" })
    .where(
      and(
        eq(tgHandles.chatId, chatId),
        eq(tgHandles.kind, "await_input"),
        eq(tgHandles.status, "active")
      )
    );
}
