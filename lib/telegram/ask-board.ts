import type { runAgent } from "@/lib/agent/loop";
import { toolsFor } from "@/lib/agent/tools";
import { buildAgentPrompt } from "@/lib/llm/agent-prompt";
import type { PromptBoard } from "./board-snapshot";
import { conversationHistory, type Turn } from "./conversation";
import { clampMessageText } from "./client";
import { richTextToTelegramHtml } from "./telegram-html";

/**
 * Вопрос к доске из бота: тот же агент, но только с читающими инструментами.
 * Мутаций у него нет вовсе, поэтому доска от такого вопроса не меняется.
 */

/** Ответ ищется во всех средах: list_environments и чтение каждой — это шаги. */
const MAX_STEPS = 10;

const TELEGRAM_RULES =
  "Ты отвечаешь в Телеграме: коротко, без таблиц; смотри задачи во всех средах (list_environments); ничего не меняй.";

/**
 * Со снимком доски в промпте вопрос «что у меня на сегодня» отвечается одним
 * шагом: правило «сначала get_board» из промпта доски снимок и заменяет.
 */
const SNAPSHOT_RULES =
  "Ты отвечаешь в Телеграме: коротко, без таблиц; ничего не меняй. Доска ниже (все среды) прочитана перед этим вопросом — это и есть ответ get_board: отвечай по ней сразу, без инструментов. Инструменты — только за тем, чего там нет (заметки, архив, скрытые задачи, полное описание). Первая строка — сразу ответ: не пиши, что смотришь или ищешь. id владельцу не пиши.";

/**
 * «Смотрю задачи с сегодняшним сроком…» первой строкой — пересказ действий,
 * который промпт запрещает, а модель всё равно пишет. Срезается, если за ним
 * есть сам ответ.
 */
const NARRATION = /^\s*(?:сейчас\s+)?(?:смотрю|посмотрю|ищу|проверяю|изучаю)(?=[\s,.:]|$)[^\n]*\n+/iu;

export function dropNarration(text: string): string {
  const rest = text.replace(NARRATION, "");
  return rest.trim() ? rest : text;
}

export async function answerBoardQuestion(
  text: string,
  input: { environmentId: string; today: string; board?: PromptBoard; conversation?: Turn[] },
  deps: { runAgent: typeof runAgent; deadlineAt?: number },
): Promise<{ ok: true; html: string } | { ok: false; error: string }> {
  let answer: string | null = null;
  let error: string | null = null;

  for await (const event of deps.runAgent({
    message: text,
    // Разговор — историей: «а по второй подробнее» понятно только с ним.
    ...(input.conversation?.length ? { history: conversationHistory(input.conversation) } : {}),
    environmentId: input.environmentId,
    today: input.today,
    tools: toolsFor({ surface: "chat", includeMutations: false }),
    systemPrompt: input.board
      ? `${buildAgentPrompt(input)}\n\n${SNAPSHOT_RULES}\n\n${input.board.text}`
      : `${buildAgentPrompt(input)}\n\n${TELEGRAM_RULES}`,
    ...(input.board ? { knownTasks: input.board.tasks } : {}),
    maxSteps: MAX_STEPS,
    ...(deps.deadlineAt !== undefined ? { deadlineAt: deps.deadlineAt } : {}),
  })) {
    // proposal на этом маршруте игнорируем: применять нечего и некому.
    if (event.type === "text") answer = event.text;
    else if (event.type === "error") error = event.message;
  }

  if (answer && answer.trim()) {
    return { ok: true, html: clampMessageText(richTextToTelegramHtml(dropNarration(answer))) };
  }
  return { ok: false, error: error ?? "Не получилось ответить на вопрос." };
}
