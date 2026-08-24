import { randomBytes } from "node:crypto";

/**
 * Идентификаторы внутри `callback_data`.
 *
 * Telegram даёт на кнопку 1–64 байта. UUID в текстовом виде — 36 символов,
 * поэтому пара «задача + колонка» в кнопку не влезает: 36 + 36 + разделители
 * это 75 байт. Те же 16 байт в base64url занимают 22 символа, и пара
 * помещается с запасом (`t:cl:<22>:<22>` — 51 байт).
 *
 * За состоянием, которое не сжать в принципе (поисковый запрос, ожидание
 * ввода), стоит короткий хендл: 10 символов в кнопке, всё остальное — строкой
 * в `tg_handles`.
 */

const UUID_HEX = /^[0-9a-f]{32}$/i;
/** Ровно 22 символа base64url — столько занимают 16 байт без выравнивания. */
const PACKED = /^[A-Za-z0-9_-]{22}$/;

export const PACKED_UUID_LENGTH = 22;
export const HANDLE_ID_LENGTH = 10;

/** UUID → 22 символа base64url. Бросает: чужой формат сюда попасть не должен. */
export function packUuid(uuid: string): string {
  const hex = uuid.replace(/-/g, "");
  if (!UUID_HEX.test(hex)) throw new Error(`Не UUID: ${uuid}`);
  return Buffer.from(hex, "hex").toString("base64url");
}

/**
 * Обратно в UUID. Мусор — null, а не исключение: сюда приходит содержимое
 * кнопки, то есть данные снаружи.
 *
 * Проверка обратной упаковкой обязательна. В 22 символах base64url 132 бита, а
 * значащих — 128: последний символ несёт два «лишних» бита, и `Buffer`
 * молча их отбрасывает. Без сверки 22 разных строки декодировались бы в один
 * и тот же UUID, то есть кнопка с испорченным хвостом продолжала бы работать.
 */
export function unpackUuid(packed: string): string | null {
  if (!PACKED.test(packed)) return null;

  const buffer = Buffer.from(packed, "base64url");
  if (buffer.length !== 16) return null;
  if (buffer.toString("base64url") !== packed) return null;

  const hex = buffer.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

/**
 * Идентификатор хендла: 10 символов base64url (7 байт случайных данных).
 * Не UUID: коллизия здесь стоит одной протухшей кнопки, а 56 бит на
 * недельном TTL — это заведомо больше, чем нужно.
 */
export function newHandleId(): string {
  return randomBytes(7).toString("base64url").slice(0, HANDLE_ID_LENGTH);
}

/** Валиден ли хендл по форме. Длина фиксирована — иначе кнопка не наша. */
export function isHandleId(value: string): boolean {
  return new RegExp(`^[A-Za-z0-9_-]{${HANDLE_ID_LENGTH}}$`).test(value);
}
