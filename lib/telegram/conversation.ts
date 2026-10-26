import type { ChatMessage } from "@/lib/llm/chat-tools";
import { parseDraftCallback } from "@/lib/telegram/draft";
import type { TelegramUpdate } from "@/lib/telegram/types";

/**
 * Память разговора: последние реплики чата из журнала апдейтов (`tg_updates`).
 *
 * Без неё каждое сообщение разбиралось с нуля: «это в дополнении к двум
 * задачам выше» или список, продолжающий нумерацию «3., 4. …», бот не мог
 * связать с тем, что было минуту назад. Реплика владельца — его текст,
 * подпись, расшифровка голоса или имя файла; реплика бота — сжатый пересказ
 * ответа из `parsed` (пункты черновика, «отправил N из M», ответ по доске).
 *
 * Модуль чистый: строки журнала приходят снаружи.
 */

export type Turn = { role: "owner" | "bot"; text: string };

/** Строка журнала — ровно те поля, что нужны разговору. */
export type JournalRow = {
  updateId: number;
  createdAt: Date;
  status: string;
  payload: unknown;
  parsed: unknown;
};

/**
 * Окно разговора. Три часа, а не час: в живом случае список «3. … 8.» пришёл
 * через 70 минут после черновика с пунктами 1–2 — и был его продолжением.
 */
export const CONVERSATION_MAX_AGE_MIN = 180;
/** Столько последних апдейтов берётся в разговор (до двух реплик на апдейт). */
export const CONVERSATION_MAX_UPDATES = 10;
const TURN_LIMIT = 500;
/** Реплика бота со списком пунктов длиннее: шесть подписей задач в 500 знаков не влезают. */
const ITEMS_TURN_LIMIT = 1000;
const TOTAL_LIMIT = 4000;
/** Столько последних реплик видит Jev (`state.previous`). */
const JEV_TURNS = 4;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cut(text: string, limit = TURN_LIMIT): string {
  const chars = Array.from(text.replace(/\s+\n/g, "\n").trim());
  return chars.length <= limit ? chars.join("") : `${chars.slice(0, limit - 1).join("")}…`;
}

const BUTTONS: Record<string, string> = {
  send: "нажал «✅ Отправить»",
  fix: "нажал «✏️ Исправить»",
  cancel: "нажал «✖️ Отмена»",
};

/** Реплика владельца из апдейта. Команды, повтор и кнопки карточек задач — не реплики. */
export function ownerText(payload: unknown, parsed: unknown): string | null {
  if (!isRecord(payload)) return null;
  const update = payload as TelegramUpdate;

  if (update.callback_query) {
    const pressed = parseDraftCallback(update.callback_query.data);
    return pressed && pressed.action !== "retry" ? `[${BUTTONS[pressed.action]} под черновиком]` : null;
  }

  const message = update.message ?? update.edited_message ?? update.channel_post;
  if (!message) return null;
  const typed = (message.text ?? message.caption)?.trim() ?? "";
  if (/^\/[a-z_]+/i.test(typed)) return null;

  const parts: string[] = [];
  if (message.forward_origin) parts.push("[переслано]");
  if (message.document) parts.push(`[файл «${message.document.file_name ?? "без имени"}»]`);
  const transcript = isRecord(parsed) && typeof parsed.transcript === "string" ? parsed.transcript : "";
  if (typed) parts.push(typed);
  if (transcript && transcript !== typed) parts.push(`🎙 ${transcript}`);
  else if (!typed && (message.voice || message.audio)) parts.push("[голосовое]");
  if (message.reply_to_message) {
    const replied = (message.reply_to_message.text ?? message.reply_to_message.caption)?.trim();
    if (replied) parts.push(`(ответ на: «${cut(replied, 150)}»)`);
  }
  const text = parts.join(" ").trim();
  return text ? cut(text) : null;
}

/** Пересказ ответа бота по разбору из журнала. Разбора нет — реплики нет. */
export function botText(status: string, parsed: unknown): string | null {
  if (!isRecord(parsed)) return status === "failed" ? "Не разобрал сообщение." : null;

  const labels = Array.isArray(parsed.calls) ? parsed.calls.filter((c): c is string => typeof c === "string") : [];
  const items = labels.map((label, i) => `${i + 1}. ${label}`).join("; ");

  if (parsed.button === "send") {
    const done = typeof parsed.done === "number" ? parsed.done : "?";
    const total = typeof parsed.total === "number" ? parsed.total : "?";
    return cut(`Отправил черновик на доску: ${done} из ${total}.${items ? ` Создано: ${items}.` : ""}`, ITEMS_TURN_LIMIT);
  }
  if (parsed.button === "cancel") return "Черновик отменён.";
  if (parsed.button === "fix") return "Спросил, что поправить.";

  const route = isRecord(parsed.route) ? parsed.route : {};
  const agentText = typeof parsed.agentText === "string" ? parsed.agentText.trim() : "";
  const calls = Array.isArray(parsed.calls) ? labels : null;

  if (route.confirm === true) {
    return cut(`Показал черновик заново, с кнопками${items ? `: ${items}` : ""}.`, ITEMS_TURN_LIMIT);
  }
  if (route.intentOnly === true) return "Спросил: что именно записать?";
  if (calls && calls.length > 0) {
    const head = route.correction === true ? "Поправил черновик" : "Черновик (не отправлен)";
    const merged = typeof parsed.mergedDraft === "string" ? " Второй черновик объединил с этим." : "";
    return cut(`${head}: ${items}.${agentText ? ` ${agentText}` : ""}${merged}`, ITEMS_TURN_LIMIT);
  }
  if (calls) return cut(agentText || "Ничего не нашёл, что записать.");
  if (route.route === "ask_board") {
    return typeof parsed.reply === "string" ? cut(`Ответ по доске: ${parsed.reply}`) : "Ответил по доске.";
  }
  if (route.route === "find_task") {
    return typeof parsed.query === "string" ? `Показал задачи по запросу «${cut(parsed.query, 100)}».` : "Показал задачи.";
  }
  if (route.route === "smalltalk") return "Показал справку.";
  return status === "failed" ? "Не разобрал сообщение." : null;
}

/**
 * Разговор по журналу: строки — новые первыми (так их отдаёт запрос),
 * реплики — старые первыми. Текущий апдейт и всё старше окна отсекаются;
 * общий объём — не больше TOTAL_LIMIT, лишнее срезается с начала.
 */
export function buildConversation(
  rows: JournalRow[],
  options: { currentUpdateId: number; now: Date }
): Turn[] {
  const since = options.now.getTime() - CONVERSATION_MAX_AGE_MIN * 60_000;
  const recent = rows
    .filter((row) => row.updateId !== options.currentUpdateId && row.createdAt.getTime() >= since)
    .slice(0, CONVERSATION_MAX_UPDATES)
    .reverse();

  const turns: Turn[] = [];
  for (const row of recent) {
    const owner = ownerText(row.payload, row.parsed);
    if (!owner) continue;
    turns.push({ role: "owner", text: owner });
    const bot = botText(row.status, row.parsed);
    if (bot) turns.push({ role: "bot", text: bot });
  }

  let total = turns.reduce((sum, turn) => sum + turn.text.length, 0);
  while (turns.length > 0 && total > TOTAL_LIMIT) total -= turns.shift()!.text.length;
  return turns;
}

/** Последние реплики для Jev: `state.previous`. */
export function jevPrevious(turns: Turn[]): { role: "owner" | "bot"; text: string }[] {
  return turns.slice(-JEV_TURNS).map((turn) => ({ role: turn.role, text: cut(turn.text) }));
}

const CONVERSATION_INTRO =
  "Недавний разговор с ботом в этом чате (до новой записи). Это контекст: по нему понятно, к чему относятся " +
  "«это», «выше», «туда же» и продолжение нумерации. Черновики в нём не отправлены, пока не сказано «Отправил».";

/**
 * Разговор → история чата для агента: владелец — user, бот — assistant.
 * Подряд идущие реплики одной стороны склеиваются (так их принимают модели),
 * первой всегда идёт user — с пояснением, что это контекст.
 */
export function conversationHistory(turns: Turn[]): ChatMessage[] {
  if (turns.length === 0) return [];
  const history: ChatMessage[] = [{ role: "user", content: CONVERSATION_INTRO }];
  for (const turn of turns) {
    const role = turn.role === "owner" ? "user" : "assistant";
    const content = turn.role === "owner" ? `Владелец: ${turn.text}` : `Бот: ${turn.text}`;
    const last = history[history.length - 1];
    if (last.role === role && typeof last.content === "string") {
      last.content = `${last.content}\n\n${content}`;
    } else {
      history.push({ role, content } as ChatMessage);
    }
  }
  // Новое сообщение агенту — от user: последняя реплика истории должна быть ботом.
  if (history[history.length - 1].role === "user") {
    history.push({ role: "assistant", content: "Понял контекст." });
  }
  return history;
}

/** Номер первого пункта нумерованного списка в начале текста: «3. …» → 3. */
export function listStart(text: string): number | null {
  const first = text.split("\n").find((line) => line.trim());
  const match = first?.match(/^\s*(\d{1,2})[.)]\s+\S/);
  return match ? Number(match[1]) : null;
}

/** Наибольший номер пункта «N.» в начале строк текстов. */
export function lastListNumber(texts: string[]): number | null {
  let max: number | null = null;
  for (const text of texts) {
    for (const line of text.split("\n")) {
      const match = line.match(/^\s*(\d{1,2})[.)]\s+\S/);
      if (match) max = Math.max(max ?? 0, Number(match[1]));
    }
  }
  return max;
}

/**
 * Запись продолжает нумерацию черновика: начинается с «N.», где N ≥ 2, а
 * последний пункт в тексте черновика (исходник и поправки) — N−1. Такой
 * список бот считает поправкой этого черновика без вопроса к Jev.
 */
export function continuesNumbering(text: string, draftTexts: string[]): boolean {
  const start = listStart(text);
  if (start === null || start < 2) return false;
  return lastListNumber(draftTexts) === start - 1;
}
