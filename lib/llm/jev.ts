/**
 * Клиент Jev — решающей модели TypeSafe через OpenRouter. В отличие от чата
 * Jev не пишет текст: на вопрос с вариантами отдаёт выбор и вероятности, на
 * вопрос «да/нет» — число от 0 до 1. Отвечает за ~400 мс и стоит доли цента,
 * поэтому годится для развилки «что это за сообщение» перед настоящим вызовом
 * модели.
 *
 * Один запрос, без повторов: бот отвечает на сообщение пользователя, и ждать
 * решающую модель дольше полутора секунд дороже, чем взять запасной маршрут.
 */

import { LlmError, openRouterKey } from "./client";

export const JEV_MODEL = "typesafe/jev-1.14";

/** Адрес decisions у OpenRouter — пока alpha, поэтому не из `OPENROUTER_BASE_URL`. */
const JEV_URL = "https://openrouter.ai/api/alpha/decisions";

const DEFAULT_TIMEOUT_MS = 1500;

export type JevQuestion =
  | { type: "choice"; instructions: string; criteria: Record<string, string> }
  | { type: "noul"; instructions: string; criteria?: { true: string; false: string } };

export type JevAnswer =
  | { type: "choice"; choice: string; confidence: number; probabilities: Record<string, number> }
  | { type: "noul"; noul: number };

export type AskJevInput = {
  questions: Record<string, JevQuestion>;
  /** Всё, что Jev видит о ситуации; вопросы ссылаются на поля по имени. */
  state: unknown;
  timeoutMs?: number;
  apiKey?: string;
  fetchFn?: typeof fetch;
};

export type AskJevResult = {
  answers: Record<string, JevAnswer>;
  latencyMs: number;
  /** Стоимость запроса в долларах, если OpenRouter её вернул. */
  cost?: number;
};

type RawAnswer = {
  choice?: unknown;
  confidence?: unknown;
  probabilities?: unknown;
  noul?: unknown;
};

export async function askJev(input: AskJevInput): Promise<AskJevResult> {
  const apiKey = input.apiKey ?? openRouterKey();
  const fetchFn = input.fetchFn ?? fetch;
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const startedAt = Date.now();

  let response: Response;
  try {
    response = await fetchFn(JEV_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: JEV_MODEL,
        questions: input.questions,
        state: input.state,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    // Таймаут отличаем от обрыва сети: вызывающему они дают разную причину.
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      throw new Error(`Jev: timeout ${timeoutMs} мс`);
    }
    throw error;
  }

  if (!response.ok) {
    throw new LlmError("openrouter", response.status, await errorDetail(response));
  }

  const data = (await response.json().catch(() => null)) as {
    answers?: Record<string, RawAnswer>;
    usage?: { cost?: number };
  } | null;

  const answers: Record<string, JevAnswer> = {};
  for (const [name, question] of Object.entries(input.questions)) {
    answers[name] = parseAnswer(name, question, data?.answers?.[name]);
  }

  const cost = data?.usage?.cost;
  return {
    answers,
    latencyMs: Date.now() - startedAt,
    ...(typeof cost === "number" ? { cost } : {}),
  };
}

/** Ответ на один вопрос в той форме, которую обещает его тип; иначе — ошибка. */
function parseAnswer(name: string, question: JevQuestion, raw: RawAnswer | undefined): JevAnswer {
  if (question.type === "choice") {
    if (
      typeof raw?.choice === "string" &&
      typeof raw.confidence === "number" &&
      raw.probabilities !== null &&
      typeof raw.probabilities === "object"
    ) {
      return {
        type: "choice",
        choice: raw.choice,
        confidence: raw.confidence,
        probabilities: raw.probabilities as Record<string, number>,
      };
    }
  } else if (typeof raw?.noul === "number") {
    return { type: "noul", noul: raw.noul };
  }
  throw new Error(`Jev: в ответе нет answers.${name} нужной формы`);
}

/** Текст ошибки, обрезанный: в лог не нужна целая страница 502. */
async function errorDetail(response: Response): Promise<string> {
  try {
    const text = await response.text();
    return text.slice(0, 200) || response.statusText;
  } catch {
    return response.statusText;
  }
}
