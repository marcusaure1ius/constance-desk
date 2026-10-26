import type { DeferredCall } from "@/lib/agent/apply";
import type { ToolOutcome } from "@/lib/agent/tool-registry";
import { clampMessageText } from "@/lib/telegram/client";
import { field, formatShortDate, plural } from "@/lib/telegram/format";
import { isHandleId } from "@/lib/telegram/ids";
import { richTextToTelegramHtml } from "@/lib/telegram/telegram-html";
import type { Inbound } from "@/lib/telegram/inbound";
import {
  taskCallback,
  type InlineButton,
  type TaskCard,
} from "@/lib/telegram/task-card";

/**
 * Черновик захвата: агент предлагает список вызовов, бот показывает карточку,
 * и на доску они попадают только по «✅ Отправить». Хранится в `tg_handles`
 * (вид `draft`); здесь — полезная нагрузка, коды кнопок и рендер карточек.
 * Модуль чистый: ни базы, ни Bot API.
 */

export type DraftPayload = {
  /** Исходный вход. */
  source: Inbound;
  /** Тексты поправок по порядку. */
  corrections: string[];
  /** Текущий черновик. */
  calls: DeferredCall[];
  /** Последний текст агента. */
  agentText: string;
  environmentId: string;
  /** ISO. */
  createdAt: string;
  /**
   * Расшифровка последней поправки, если её надиктовали: на карточке видно,
   * что бот услышал. Текстовая поправка поле снимает.
   */
  correctionTranscript?: string;
  /**
   * Прошлое сообщение автора, которое лишь объявило намерение («хочу создать
   * задачу в блоке ML»): бот спросил, что записать, и эта запись — ответ.
   * Агент видит его как контекст и при поправке тоже.
   */
  captureContext?: string;
};

/**
 * Payload из `tg_handles` → черновик. В базе jsonb, то есть данные без
 * гарантий: битая запись должна дать «черновик устарел», а не исключение
 * посреди применения.
 */
export function parseDraftPayload(payload: unknown): DraftPayload | null {
  if (!isRecord(payload)) return null;
  const { source, corrections, calls, agentText, environmentId, createdAt } = payload;

  if (!isRecord(source) || typeof source.text !== "string" || !Array.isArray(source.links)) {
    return null;
  }
  if (!Array.isArray(corrections) || !corrections.every((c) => typeof c === "string")) return null;
  if (!Array.isArray(calls) || !calls.every((c) => isRecord(c) && typeof c.tool === "string")) {
    return null;
  }
  if (typeof agentText !== "string" || typeof environmentId !== "string") return null;
  if (typeof createdAt !== "string") return null;
  if (payload.captureContext !== undefined && typeof payload.captureContext !== "string") return null;

  return payload as DraftPayload;
}

/**
 * Открытый черновик — живой и с пунктами. Пустой (ноль вызовов) открытым не
 * считается: иначе вопрос «что записать?», сохранённый черновиком, ловил бы
 * следующие сообщения как поправки к пустоте.
 */
export function isNonEmptyDraft(payload: unknown): boolean {
  const draft = parseDraftPayload(payload);
  return draft !== null && draft.calls.length > 0;
}

/** Ожидание ввода после «✏️ Исправить»: следующее сообщение — поправка к этому черновику. */
export function parseDraftFix(payload: unknown): { draftHandleId: string } | null {
  if (!isRecord(payload)) return null;
  const id = payload.draftHandleId;
  return typeof id === "string" && isHandleId(id) ? { draftHandleId: id } : null;
}

/** Столько знаков намерения хранится в ожидании и уходит агенту контекстом. */
const CAPTURE_CONTEXT_LIMIT = 1000;

/**
 * Ожидание ввода после «Что именно записать?»: следующее сообщение — сама
 * запись, а это — объявленное до неё намерение.
 */
export function captureContextPayload(text: string): { captureContext: string } {
  return { captureContext: text.trim().slice(0, CAPTURE_CONTEXT_LIMIT) };
}

export function parseCaptureContext(payload: unknown): { captureContext: string } | null {
  if (!isRecord(payload)) return null;
  const context = payload.captureContext;
  return typeof context === "string" && context.trim() ? { captureContext: context } : null;
}

/** Регистр и «ё» не различаем, пробелы схлопываем: «ML  модели» = «ml модели». */
function normalizeName(value: string): string {
  return value.toLocaleLowerCase("ru").replace(/ё/g, "е").replace(/\s+/g, " ").trim();
}

/**
 * Эпик, названный в сообщении целым словом или фразой («в блоке ml модели» →
 * «ML модели»). Несколько совпадений — самое длинное название: «ML модели»
 * точнее, чем «ML». Не нашёлся — null, бот спросит без эпика.
 */
export function findMentionedEpic<T extends { name: string }>(text: string, epics: T[]): T | null {
  const haystack = normalizeName(text);
  let best: T | null = null;
  for (const epic of epics) {
    const name = normalizeName(epic.name);
    if (name.length < 2) continue;
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // \b в JS — только латиница, поэтому границы слова — через \p{L}\p{N}.
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "u");
    if (pattern.test(haystack) && (!best || name.length > normalizeName(best.name).length)) best = epic;
  }
  return best;
}

/** Вопрос вместо черновика, когда сообщение — одно намерение без содержания. HTML. */
export function intentQuestion(epic: { name: string } | null): string {
  return epic
    ? `Какую задачу завести в эпике «${field(epic.name, EPIC_NAME_LIMIT)}»? Напишите или надиктуйте.`
    : "Что именно записать? Напишите или надиктуйте.";
}

const EPIC_NAME_LIMIT = 200;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/* ── коды кнопок ──────────────────────────────────────────────────────────── */

export const draftCallback = {
  send: (h: string) => `d:ok:${h}`,
  fix: (h: string) => `d:fx:${h}`,
  cancel: (h: string) => `d:no:${h}`,
  retry: (updateId: number) => `d:rt:${updateId}`,
};

export type DraftCallback =
  | { action: "send" | "fix" | "cancel"; handleId: string }
  | { action: "retry"; updateId: number };

const ACTION_BY_CODE = { ok: "send", fx: "fix", no: "cancel" } as const;

/** Нажатие → намерение. Чужое и испорченное — null: данные приходят снаружи. */
export function parseDraftCallback(data: string | undefined): DraftCallback | null {
  if (!data) return null;
  const parts = data.split(":");
  if (parts.length !== 3 || parts[0] !== "d") return null;

  const [, code, arg] = parts;

  if (code === "rt") {
    if (!/^\d{1,15}$/.test(arg)) return null;
    return { action: "retry", updateId: Number(arg) };
  }

  const action = ACTION_BY_CODE[code as keyof typeof ACTION_BY_CODE];
  if (!action || !isHandleId(arg)) return null;
  return { action, handleId: arg };
}

/* ── карточки ─────────────────────────────────────────────────────────────── */

const TRANSCRIPT_LIMIT = 300;
const LABEL_LIMIT = 200;
const ATTACHMENT_NAME_LIMIT = 100;
const ERROR_LIMIT = 200;
const BUTTON_TITLE_LIMIT = 40;
const EMPTY_TEXT = "Ничего не нашёл, что записать";

function callLabel(call: DeferredCall): string {
  return call.label?.trim() || call.tool;
}

/** Подписи вызовов через «; » — для передачи Jev. */
export function draftSummary(draft: DraftPayload): string {
  return draft.calls.map(callLabel).join("; ");
}

/**
 * Сколько знаков HTML отдаём под список пунктов. С заголовком, расшифровками,
 * текстом агента и строкой над карточкой (≤ 500) остаётся запас до 4096:
 * обрезка `clampMessageText` до списка не дотягивается.
 */
const ITEMS_BUDGET = 2400;
const TOO_MANY = "Слишком много пунктов — сократите поправкой";

/** Подзадачи новой задачи из аргументов: на карточке видно каждую. */
function subtaskLines(call: DeferredCall): string[] {
  if (call.tool !== "create_task" && call.tool !== "create_epic_task") return [];
  const subtasks = isRecord(call.args) ? call.args.subtasks : undefined;
  if (!Array.isArray(subtasks)) return [];
  return subtasks.flatMap((sub) => {
    if (!isRecord(sub) || typeof sub.title !== "string") return [];
    const due =
      typeof sub.dueDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sub.dueDate)
        ? ` · срок ${formatShortDate(sub.dueDate)}`
        : "";
    return [`   ◦ ${field(sub.title, LABEL_LIMIT)}${due}`];
  });
}

const AGENT_NOTE_LIMIT = 500;
const AGENT_ANSWER_LIMIT = 1000;

/**
 * Текст агента → HTML Телеграма. Модель пишет лёгким Markdown, а сырые `**`
 * на карточке — мусор, поэтому текст идёт через richTextToTelegramHtml.
 * Резать готовый HTML нельзя (разрезанный тег), поэтому укорачиваем исходник,
 * пока HTML не уложится в предел. Пустой текст — пустая строка.
 */
function agentHtml(text: string, limit: number): string {
  let source = Array.from(text.trim());
  if (source.length === 0) return "";
  for (;;) {
    const html = richTextToTelegramHtml(source.join("")).trim();
    if (html.length <= limit) return html;
    const next = Math.floor(source.length * 0.8);
    if (next <= 0) return "";
    source = [...source.slice(0, next - 1), "…"];
  }
}

/**
 * Агент ничего не предложил: черновика нет, только его фраза (чаще вопрос
 * «что записать?») — без кнопок, отправлять нечего.
 */
export function renderEmptyAnswer(agentText: string): TaskCard {
  return { text: clampMessageText(agentHtml(agentText, AGENT_ANSWER_LIMIT) || EMPTY_TEXT) };
}

/** «Ничего не поменял: …» — поправка не дала ни одного пункта, черновик остался прежним. */
export function renderUnchangedAnswer(agentText: string): TaskCard {
  const note = agentHtml(agentText, AGENT_ANSWER_LIMIT);
  return { text: clampMessageText(note ? `Ничего не поменял: ${note}` : "Ничего не поменял — черновик выше прежний.") };
}

/** Пункты черновика списком, как на карточке, — контекстом для агента. Простой текст. */
export function draftItemsText(calls: DeferredCall[]): string {
  return calls
    .map((call, i) => {
      const subs = subtaskTitles(call).map((title) => `\n   ◦ ${title}`).join("");
      return `${i + 1}. ${callLabel(call)}${subs}`;
    })
    .join("\n");
}

const TITLED_ITEM_TOOLS = new Set(["create_task", "create_epic_task", "create_subtask", "create_note"]);

function subtaskTitles(call: DeferredCall): string[] {
  if (call.tool !== "create_task" && call.tool !== "create_epic_task") return [];
  const subtasks = isRecord(call.args) ? call.args.subtasks : undefined;
  if (!Array.isArray(subtasks)) return [];
  return subtasks.flatMap((sub) => (isRecord(sub) && typeof sub.title === "string" ? [sub.title] : []));
}

/** Заголовок для сравнения: регистр, «ё», знаки и номер «3.» в начале не важны. */
function normalizeTitle(value: string): string {
  return normalizeName(value)
    .replace(/^\s*\d+[.)]\s*/u, "")
    .replace(/[^\p{L}\p{N} ]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Заголовки пунктов черновика: задачи, подзадачи (и в subtasks), заметки. */
function itemTitles(calls: DeferredCall[], withSubtasks: boolean): string[] {
  return calls.flatMap((call) => {
    if (!TITLED_ITEM_TOOLS.has(call.tool) || !isRecord(call.args)) return [];
    const own = typeof call.args.title === "string" ? [call.args.title] : [];
    return [...own, ...(withSubtasks ? subtaskTitles(call) : [])];
  });
}

/** Короче этого заголовок совпадает только целиком: «сайт» не должен найтись в «сайт ВЭД». */
const CONTAINS_MIN = 8;

/**
 * Пункты черновика `from` переехали в `into`: не меньше половины заголовков
 * `from` нашлись среди заголовков `into` (целиком или вхождением). По этому
 * признаку бот закрывает более свежий черновик, слитый поправкой в старый.
 */
export function draftMerged(from: DeferredCall[], into: DeferredCall[]): boolean {
  const source = itemTitles(from, false).map(normalizeTitle).filter(Boolean);
  if (source.length === 0) return false;
  const target = itemTitles(into, true).map(normalizeTitle).filter(Boolean);
  const found = source.filter((title) =>
    target.some(
      (other) =>
        other === title ||
        (Math.min(other.length, title.length) >= CONTAINS_MIN && (other.includes(title) || title.includes(other)))
    )
  );
  return found.length * 2 >= source.length;
}

/**
 * Сообщение пересказывает пункты черновика списком (живой случай 714077403:
 * «Давай вот эти подзадачи добавим в …» и шесть пунктов черновика B) — это
 * просьба переделать ТОТ черновик. Нужно ≥ 2 пунктов списка в сообщении и
 * не меньше половины пунктов черновика среди них.
 */
export function restatesDraft(text: string, calls: DeferredCall[]): boolean {
  const lines = text
    .split("\n")
    .filter((line) => /^\s*(?:\d{1,2}[.)]|[-•*–])\s+\S/u.test(line))
    .map((line) => line.replace(/^\s*(?:\d{1,2}[.)]|[-•*–])\s+/u, ""));
  if (lines.length < 2) return false;
  return draftMerged(
    calls,
    lines.map((title) => ({ tool: "create_task", args: { title } }))
  );
}

export function renderDraftCard(draft: DraftPayload, handleId: string): TaskCard {
  const lines: string[] = [];
  const corrections = draft.corrections.length;
  lines.push(
    corrections > 0 ? `📝 Черновик · правка ${corrections}` : "📝 Черновик"
  );

  if (draft.source.transcript) {
    lines.push("", `🎙 «${field(draft.source.transcript, TRANSCRIPT_LIMIT)}»`);
  }
  // Что именно бот прочитал: имя файла и пометка, если дочитал не до конца.
  for (const file of Array.isArray(draft.source.attachments) ? draft.source.attachments : []) {
    if (typeof file?.name !== "string") continue;
    lines.push(`📎 ${field(file.name, ATTACHMENT_NAME_LIMIT)}${file.truncated ? " (прочитал начало)" : ""}`);
  }
  if (typeof draft.correctionTranscript === "string" && draft.correctionTranscript.trim()) {
    lines.push(`🎙 поправка: «${field(draft.correctionTranscript.trim(), TRANSCRIPT_LIMIT)}»`);
  }

  // Пункты показываются целиком или не показываются: «Отправить» применяет
  // весь список, и пункт, срезанный лимитом сообщения, ушёл бы на доску невидимым.
  let hidden = 0;
  if (draft.calls.length > 0) {
    lines.push("");
    let used = 0;
    draft.calls.forEach((call, i) => {
      if (hidden > 0) {
        hidden++;
        return;
      }
      const block = [`${i + 1}. ${field(callLabel(call), LABEL_LIMIT)}`, ...subtaskLines(call)].join("\n");
      if (used + block.length + 1 > ITEMS_BUDGET) {
        hidden = 1;
        return;
      }
      used += block.length + 1;
      lines.push(block);
    });
    if (hidden > 0) {
      lines.push(
        `… и ещё ${hidden} ${plural(hidden, ["пункт", "пункта", "пунктов"])}`,
        "",
        TOO_MANY
      );
    }
    const note = agentHtml(draft.agentText, AGENT_NOTE_LIMIT);
    if (note) lines.push("", `<i>${note}</i>`);
  } else {
    lines.push("", agentHtml(draft.agentText, AGENT_ANSWER_LIMIT) || EMPTY_TEXT);
  }

  // Скрытые пункты «Отправить» применил бы вслепую — кнопки нет, пока
  // поправка не сократит список.
  const row: InlineButton[] = [];
  if (draft.calls.length > 0 && hidden === 0) {
    row.push({ text: "✅ Отправить", callback_data: draftCallback.send(handleId) });
  }
  row.push({ text: "✏️ Исправить", callback_data: draftCallback.fix(handleId) });
  row.push({ text: "✖️ Отмена", callback_data: draftCallback.cancel(handleId) });

  return {
    text: clampMessageText(lines.join("\n")),
    replyMarkup: { inline_keyboard: [row] },
  };
}

/**
 * Задача, на которую ведёт кнопка в отчёте. Решает инструмент, а не форма
 * ответа: `id` есть и у заметки, и у эпика, и у подзадачи, но кнопка задачи
 * по нему откроет «задача не найдена».
 */
function appliedTask(
  call: DeferredCall | undefined,
  outcome: ToolOutcome
): { id: string; title?: string } | null {
  if (!call || !outcome.ok || !isRecord(outcome.data)) return null;
  const data = outcome.data;

  switch (call.tool) {
    case "create_task":
    case "create_epic_task":
    case "update_task": {
      // create_epic_task отдаёт `{ task, category }`, остальные — саму задачу.
      const task = isRecord(data.task) ? data.task : data;
      if (typeof task.id !== "string") return null;
      return { id: task.id, title: typeof task.title === "string" ? task.title : undefined };
    }
    case "create_subtask":
      // Подзадачу открывает карточка её задачи; название у задачи своё — в кнопке подпись вызова.
      return typeof data.taskId === "string" ? { id: data.taskId } : null;
    default:
      return null;
  }
}

export function renderAppliedCard(draft: DraftPayload, results: ToolOutcome[]): TaskCard {
  const total = draft.calls.length;
  const done = results.filter((r) => r.ok).length;

  const lines = [`✅ Готово: ${done} из ${total}`, ""];
  const rows: InlineButton[][] = [];

  // Тот же бюджет, что у черновика: перечень не должен вытолкнуть кнопки за 4096.
  let used = 0;
  let hidden = 0;
  results.forEach((result, i) => {
    const call = draft.calls[i];
    const label = call ? callLabel(call) : "Вызов";
    const line = result.ok
      ? `✅ ${field(label, LABEL_LIMIT)}`
      : `⚠️ ${field(label, LABEL_LIMIT)}: ${field(result.error, ERROR_LIMIT)}`;
    if (hidden > 0 || used + line.length + 1 > ITEMS_BUDGET) {
      hidden++;
    } else {
      used += line.length + 1;
      lines.push(line);
    }

    const task = appliedTask(call, result);
    if (!task) return;
    const title = task.title ?? label;
    try {
      rows.push([
        {
          text: `📋 ${truncateButton(title)}`,
          callback_data: taskCallback.back(task.id),
        },
      ]);
    } catch {
      // id не UUID — кнопку не собрать, отчёт остаётся.
    }
  });
  if (hidden > 0) {
    lines.push(`… и ещё ${hidden} ${plural(hidden, ["пункт", "пункта", "пунктов"])}`);
  }

  return {
    text: clampMessageText(lines.join("\n")),
    replyMarkup: rows.length > 0 ? { inline_keyboard: rows } : undefined,
  };
}

function truncateButton(value: string): string {
  const chars = Array.from(value);
  return chars.length <= BUTTON_TITLE_LIMIT
    ? value
    : chars.slice(0, BUTTON_TITLE_LIMIT - 1).join("") + "…";
}

export function renderClosedCard(kind: "cancelled" | "already_sent" | "expired"): TaskCard {
  const text = {
    cancelled: "✖️ Черновик отменён",
    already_sent: "Этот черновик уже отправлен",
    expired: "Черновик устарел — напишите заново",
  }[kind];
  return { text };
}

