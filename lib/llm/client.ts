/**
 * Клиент чат-моделей. Провайдер один — OpenRouter: Groq убран, потому что его
 * бесплатная квота роняла захват из телеграма ровно в момент отправки
 * сообщения, а падение к запасному провайдеру держало две конфигурации на
 * каждую задачу. OpenRouter сам разводит запрос по своим апстримам.
 *
 * `LlmProvider` остаётся типом, а не константой, ради тестов: им подсовывают
 * свой адрес и ключ, не трогая окружение.
 */

export type ProviderName = "openrouter";

export type LlmProvider = {
  name: ProviderName;
  baseUrl: string;
  apiKey: string;
  model: string;
};

/** Провайдер ответил не-2xx. */
export class LlmError extends Error {
  constructor(
    readonly provider: ProviderName,
    readonly status: number,
    readonly detail: string
  ) {
    super(`Модель ${provider}: ${status} ${detail}`);
    this.name = "LlmError";
  }
}

export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

/**
 * Базовая модель всех задач. Берётся стабильный slug без даты и без тильды:
 * `~…-latest` у OpenRouter указывает на плавающий вариант, и прод от него
 * зависеть не должен — смена версии под ногами дороже свежести.
 */
const BASE_MODEL = "deepseek/deepseek-v4-flash";

export const MODELS = {
  /** Захват из телеграма. Агент захвата ходит циклом агента, то есть через `agent`. */
  capture: BASE_MODEL,
  /** Разбор из веб-формы SmartInput: короткий вход, короткий ответ. */
  smartInput: BASE_MODEL,
  /** Цикл агента на доске. */
  agent: BASE_MODEL,
  /** ИИ-разбор недели в PDF-отчёте. */
  report: BASE_MODEL,
} as const satisfies Record<string, string>;

type Env = Record<string, string | undefined>;

/** Ключ OpenRouter из окружения. Пустой — бросаем сразу, а не ловим 401. */
export function openRouterKey(env: Env = process.env): string {
  const apiKey = env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENROUTER_API_KEY не задан — модели недоступны");
  return apiKey;
}

/**
 * Провайдер под модель. Нет ключа — бросает: пустой `Authorization` даёт 401,
 * который выглядит как поломка кода, хотя это просто ненастроенное окружение.
 */
export function resolveProvider(model: string, env: Env = process.env): LlmProvider {
  return { name: "openrouter", baseUrl: OPENROUTER_BASE_URL, apiKey: openRouterKey(env), model };
}

export type ChatJsonInput = {
  system: string;
  user: string;
  /** Какую модель брать. Игнорируется, если задан `provider`. */
  model: string;
  temperature?: number;
  /** Готовый провайдер — для тестов и вызовов с особой конфигурацией. */
  provider?: LlmProvider;
  env?: Env;
  fetchFn?: typeof fetch;
};

export type ChatJsonResult = {
  content: string;
  provider: ProviderName;
  model: string;
};

/** Один запрос к модели с ответом в JSON. */
export async function chatJson(input: ChatJsonInput): Promise<ChatJsonResult> {
  const provider = input.provider ?? resolveProvider(input.model, input.env);
  const content = await callProvider(provider, input, input.fetchFn ?? fetch);
  return { content, provider: provider.name, model: provider.model };
}

async function callProvider(
  provider: LlmProvider,
  input: ChatJsonInput,
  fetchFn: typeof fetch
): Promise<string> {
  const response = await fetchFn(`${provider.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${provider.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: provider.model,
      messages: [
        { role: "system", content: input.system },
        { role: "user", content: input.user },
      ],
      response_format: { type: "json_object" },
      temperature: input.temperature ?? 0.1,
    }),
  });

  if (!response.ok) {
    throw new LlmError(provider.name, response.status, await errorDetail(response));
  }

  const data = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  return data.choices?.[0]?.message?.content ?? "";
}

/** Текст ошибки провайдера, обрезанный: в лог не нужен весь HTML страницы 502. */
async function errorDetail(response: Response): Promise<string> {
  try {
    const text = await response.text();
    return text.slice(0, 200) || response.statusText;
  } catch {
    return response.statusText;
  }
}
