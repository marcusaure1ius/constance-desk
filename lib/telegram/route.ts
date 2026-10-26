/**
 * Маршрутизатор входящих сообщений бота: что это — запись на доску, чужой
 * материал «почитать», вопрос о доске, разговор про одну задачу или болтовня.
 * Решает Jev (`lib/llm/jev.ts`); очевидные случаи — прочитанный текстовый
 * файл и пересылки — разбираются правилами без вызова. Любой сбой Jev не роняет бота, а даёт `capture`: потеря
 * записи хуже лишней записи, которую пользователь сам отменит.
 */

import { LlmError } from "@/lib/llm/client";
import type { askJev } from "@/lib/llm/jev";
import type { Inbound } from "./inbound";

export type Route = "capture" | "forward" | "ask_board" | "find_task" | "smalltalk";

export type RouteDecision = {
  route: Route;
  /** Сообщение правит открытый черновик, а не заводит новую запись. */
  correction: boolean;
  /**
   * «Отправляй», «да, записывай»: просьба отправить открытый черновик как
   * есть. Бот по ней ничего не применяет — только показывает черновик заново
   * внизу чата, с кнопками. Поле есть лишь при `true`.
   */
  confirm?: true;
  /**
   * «Хочу создать задачу в блоке ML» — сообщение лишь объявляет, что автор
   * хочет что-то записать, но не говорит что. Бот агента не зовёт, а
   * спрашивает, что именно записать. Поле есть лишь при `true` и только у
   * маршрута `capture` без поправки и «отправляй».
   */
  intentOnly?: true;
  source: "jev" | "rule" | "fallback";
  confidence?: number;
  /** Почему взят запасной маршрут: timeout | http_<status> | network | bad_response | low_confidence. */
  reason?: string;
  latencyMs?: number;
};

/**
 * Формулировки подобраны живым замером (`tests/fixtures/route-cases.ts`).
 * Менять осторожно — каждая правка требует перепрогона
 * `tests/jev.integration.test.ts`.
 *
 * Добавление к существующей задаче («добавь в задачу про итмо шаг», «ссылка к
 * задаче про слайды») — capture: это новая запись, которую агент захвата
 * кладёт подзадачей или в описание. В find_task нет «поправить»: правку по
 * фразе бот не делает, а слово уводило туда и добавления.
 *
 * Правка открытого черновика («не до пятницы, а до понедельника») тоже
 * capture, а find_task — только задача на доске, не пункт `draft`: без этого
 * Jev уверенно слал поправки в find_task, а поправку decideRoute принимает
 * лишь при маршруте записи. Замер 2026-10-24: 15 из 16 маршрутов, 4 из 4
 * поправок, 0 из 4 ложных поправок.
 *
 * В вопросе о поправке названо удаление «по порядку»: «нет, вторую не надо»
 * без этого колебалось у порога (0.73–0.81) и в живом прогоне падало ниже.
 */
export const ROUTE_CRITERIA: Record<Route, string> = {
  capture:
    "Автор записывает СВОИ дела, задачи, планы, мысли, идеи или темы — их нужно сохранить на доску или в заметки; " +
    "сюда же — добавить шаг, подзадачу, ссылку или заметку к уже существующей задаче, " +
    "а также поправить или уточнить черновик `draft`, если он есть",
  forward: "Чужой материал: пересланный пост, статья, ссылка или видео — сохранить почитать",
  ask_board:
    "Вопрос о его задачах в целом: что на сегодня, что горит, что просрочено, просьба разобрать или спланировать день",
  find_task:
    "Про одну конкретную задачу, уже существующую на доске (не пункт черновика `draft`): " +
    "найти её, закрыть, отметить сделанной, перенести",
  smalltalk: "Приветствие, благодарность, вопрос о том, что умеет бот",
};

/** Ниже этой уверенности выбор Jev не принимаем. */
const MIN_CONFIDENCE = 0.6;
/** С этого значения noul считается «да, это поправка». */
const CORRECTION_THRESHOLD = 0.7;
/** С этого значения noul считается «да, отправь черновик». */
const CONFIRM_THRESHOLD = 0.7;
/**
 * Черновик старше этого поправкой не считаем и Jev о нём не спрашиваем: через
 * час новое сообщение почти всегда новая запись, а кнопки старой карточки
 * работают до срока.
 */
const CORRECTION_MAX_AGE_MIN = 60;
/** Поправкой может быть только запись: вопрос к доске или про задачу — нет. */
const CORRECTABLE: readonly Route[] = ["capture", "forward"];
/** Столько знаков сообщения видит Jev. */
const MAX_MESSAGE_LENGTH = 4000;

/**
 * Вопрос «это просьба отправить черновик?». Живой замер — фразы
 * `CONFIRM_CASES` в `tests/fixtures/route-cases.ts`: «Все, отправляй короче
 * на доску», «да, записывай», но не «отправить Суровцеву отчёт» (это дело) и
 * не «нет, вторую не надо» (поправка). Оговорки устной речи названы прямо:
 * без них «Ну, нет, команда, вот, отправляй…» давало 0.65 — ниже порога.
 * Замер 2026-10-24: «отправляй» 0.89–0.92, остальное ≤ 0.39.
 */
export const CONFIRM_INSTRUCTIONS =
  "Сообщение `message` — команда «отправляй/записывай/на доску» для черновика `draft` как есть " +
  "(в устной речи с повторами и оговорками вроде «нет», «точнее»), а не новое дело и не правка пунктов?";

/** С этого значения noul считается «только намерение, без содержания». */
const INTENT_THRESHOLD = 0.7;

/**
 * Вопрос «это объявление намерения без содержания?». Живой замер — фразы
 * `INTENT_ONLY_CASES` и `NOT_INTENT_ONLY_CASES` в
 * `tests/fixtures/route-cases.ts`: «хочу создать новую задачу в блоке ml
 * модели» — да (эпик назван, а дела нет), «Создай задачу позвонить Маше» и
 * «мысль: в стратегии нет синергии» — нет. Задаётся в том же запросе, что и
 * маршрут: отдельный круг к Jev ради него не нужен. Пример «добавлю шаг к
 * задаче про Y» в критерии поднял «хочу добавить подзадачу к задаче про
 * отчёт» с 0.76 до 0.94. Замер 2026-10-26: намерения 0.94–0.98, записи с
 * содержанием и остальные фразы замера ≤ 0.25.
 */
export const INTENT_INSTRUCTIONS =
  "Сообщение `message` только объявляет, что автор хочет что-то создать или записать " +
  "(задачу, заметку, подзадачу), но не говорит, что именно?";
export const INTENT_CRITERIA = {
  true:
    "Есть лишь намерение и, может быть, место — эпик, блок, задача, к которой добавить: " +
    "«хочу создать задачу в блоке X», «надо завести задачу», «запиши заметку», «добавлю шаг к задаче про Y». " +
    "Самого дела, мысли или шага — что именно сделать или записать — в тексте нет",
  false:
    "В тексте есть содержание записи — само дело, мысль, тема, шаг или ссылка, даже короткие: " +
    "«создай задачу позвонить Маше», «мысль: …», «добавь шаг — согласовать бюджет»; " +
    "или это вообще не запись, а вопрос, просьба найти или приветствие",
};

const ROUTES = Object.keys(ROUTE_CRITERIA) as Route[];

export async function decideRoute(
  inbound: Inbound,
  openDraft: { summary: string; createdAt: Date } | null,
  deps: { askJev: typeof askJev; now?: () => Date }
): Promise<RouteDecision> {
  // Прочитанный файл — всегда запись: подпись к нему («вот посмотри, какие ещё
  // есть задачи») Jev принимал за одно намерение и спрашивал «что записать?»,
  // хотя содержание — в файле. Вопрос к доске или поиск файлом не задают, а
  // поправкой к черновику файл не бывает. Jev здесь не спрашиваем вовсе.
  if (inbound.attachments?.length) {
    return { route: "capture", correction: false, source: "rule" };
  }
  if (inbound.forward?.kind === "channel") {
    return { route: "forward", correction: false, source: "rule" };
  }
  // Пересланное от человека — чьё-то поручение автору, а не материал на потом.
  if (inbound.forward?.kind === "person") {
    return { route: "capture", correction: false, source: "rule" };
  }

  const questions: Parameters<typeof askJev>[0]["questions"] = {
    route: {
      type: "choice",
      instructions: "Что автор хочет от бота своей доски задач сообщением `message`?",
      criteria: ROUTE_CRITERIA,
    },
  };
  // Ссылка — уже содержание записи: спрашивать «что записать?» незачем.
  const askIntent = inbound.links.length === 0;
  if (askIntent) {
    questions.intent = { type: "noul", instructions: INTENT_INSTRUCTIONS, criteria: INTENT_CRITERIA };
  }
  const draftAge = openDraft ? ageMinutes(openDraft.createdAt, deps.now?.() ?? new Date()) : null;
  const askCorrection = draftAge !== null && draftAge < CORRECTION_MAX_AGE_MIN;
  if (askCorrection) {
    questions.correction = {
      type: "noul",
      instructions:
        "Сообщение `message` — ответ на черновик `draft` (создан `draft_age_minutes` минут назад): " +
        "убрать пункт (в том числе по номеру или порядку — «вторую», «последнюю»), " +
        "изменить или дополнить его пункты, а не новая запись?",
    };
    questions.confirm = {
      type: "noul",
      instructions: CONFIRM_INSTRUCTIONS,
    };
  }

  let result: Awaited<ReturnType<typeof askJev>>;
  try {
    result = await deps.askJev({
      questions,
      state: {
        message: inbound.text.slice(0, MAX_MESSAGE_LENGTH),
        links: inbound.links,
        ...(askCorrection && openDraft
          ? { draft: openDraft.summary, draft_age_minutes: draftAge }
          : {}),
      },
    });
  } catch (error) {
    return {
      route: "capture",
      correction: false,
      source: "fallback",
      reason: failureReason(error),
    };
  }

  const answer = result.answers.route;
  const correctionAnswer = result.answers.correction;
  const looksLikeCorrection =
    askCorrection && correctionAnswer?.type === "noul" && correctionAnswer.noul >= CORRECTION_THRESHOLD;
  const confirmAnswer = result.answers.confirm;
  // «Отправляй» важнее поправки и маршрута: по нему бот ничего не пишет и не
  // зовёт агента, а лишь показывает черновик заново с кнопкой.
  if (askCorrection && confirmAnswer?.type === "noul" && confirmAnswer.noul >= CONFIRM_THRESHOLD) {
    return {
      route: "capture",
      correction: false,
      confirm: true,
      source: "jev",
      ...(answer?.type === "choice" ? { confidence: answer.confidence } : {}),
      latencyMs: result.latencyMs,
    };
  }

  // Поправка проверяется раньше маршрута, поэтому верим ей только там, где
  // маршрут и так ведёт в черновик: уверенное «закрой задачу» или «что на
  // сегодня» при открытом черновике не должно уйти агенту поправкой.
  const correction = (route: Route) => looksLikeCorrection && CORRECTABLE.includes(route);
  const intentAnswer = result.answers.intent;
  const looksIntentOnly =
    askIntent && intentAnswer?.type === "noul" && intentAnswer.noul >= INTENT_THRESHOLD;
  // Спрашиваем «что записать?» только вместо черновика: поправка к черновику
  // и любой другой маршрут идут своим путём.
  const intent = (route: Route): { intentOnly?: true } =>
    looksIntentOnly && route === "capture" && !correction(route) ? { intentOnly: true } : {};

  if (
    answer?.type !== "choice" ||
    !ROUTES.includes(answer.choice as Route)
  ) {
    return {
      route: "capture",
      correction: correction("capture"),
      ...intent("capture"),
      source: "fallback",
      reason: "bad_response",
    };
  }
  if (answer.confidence < MIN_CONFIDENCE) {
    return {
      route: "capture",
      correction: correction("capture"),
      ...intent("capture"),
      source: "fallback",
      reason: "low_confidence",
      confidence: answer.confidence,
      latencyMs: result.latencyMs,
    };
  }
  return {
    route: answer.choice as Route,
    correction: correction(answer.choice as Route),
    ...intent(answer.choice as Route),
    source: "jev",
    confidence: answer.confidence,
    latencyMs: result.latencyMs,
  };
}

function ageMinutes(createdAt: Date, now: Date): number {
  const minutes = Math.floor((now.getTime() - createdAt.getTime()) / 60_000);
  // Битая дата — как очень старый черновик: поправкой не считаем.
  return Number.isFinite(minutes) ? Math.max(0, minutes) : Number.POSITIVE_INFINITY;
}

/** Причина сбоя Jev для лога: короткий код, а не текст исключения. */
function failureReason(error: unknown): string {
  if (error instanceof LlmError) return `http_${error.status}`;
  const message = error instanceof Error ? error.message : "";
  if (/timeout/i.test(message)) return "timeout";
  if (/answers/.test(message)) return "bad_response";
  return "network";
}
