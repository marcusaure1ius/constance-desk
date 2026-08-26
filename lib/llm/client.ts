/**
 * Клиент чат-моделей, не привязанный к одному провайдеру.
 *
 * Groq и OpenRouter говорят на одном диалекте (OpenAI-совместимый
 * `/chat/completions`), поэтому разница между ними — три поля конфигурации, а
 * не два клиента. Общий клиент нужен не ради красоты, а ради падения: у Groq
 * бесплатная квота, и 429 прилетает ровно тогда, когда пользователь уже
 * отправил сообщение в бота. Тот же запрос уходит в OpenRouter, а не теряется.
 *
 * Порядок провайдеров — не настройка, а следствие цен: Groq первым, потому что
 * он бесплатный и быстрый, OpenRouter вторым, потому что платный и без лимитов.
 */

export type ProviderName = "groq" | "openrouter";

export type LlmProvider = {
  name: ProviderName;
  baseUrl: string;
  apiKey: string;
  model: string;
};

/** Провайдер ответил не-2xx. status нужен, чтобы решить, падать ли к следующему. */
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

const BASE_URLS: Record<ProviderName, string> = {
  groq: "https://api.groq.com/openai/v1",
  openrouter: "https://openrouter.ai/api/v1",
};

/** Пара моделей под одну задачу: чем считаем у Groq и чем у OpenRouter. */
export type ModelPair = {
  groq: string;
  openrouter: string;
  /**
   * Порядок обращения. Умолчание — Groq первым, он бесплатный. У агента
   * порядок обратный: цикл с инструментами упирается в качество, а не в цену.
   */
  order?: readonly ProviderName[];
};

/**
 * Модель OpenRouter для обеих задач. Берётся стабильный slug без даты и без
 * тильды: `~…-latest` у OpenRouter указывает на плавающий вариант, и прод от
 * него зависеть не должен — смена версии под ногами дороже свежести.
 */
const OPENROUTER_MODEL = "deepseek/deepseek-v4-flash";

export const MODELS = {
  /**
   * Захват сообщения из телеграма. 120b, а не 20b: на 20b замерена порча
   * пользовательских формулировок (русская задача превращалась в английскую),
   * а с контекстом доски 120b отвечает за 0,85–2,3 с — этого хватает.
   */
  capture: {
    groq: "openai/gpt-oss-120b",
    openrouter: OPENROUTER_MODEL,
  },
  /** Разбор из веб-формы SmartInput: короткий вход, короткий ответ. */
  smartInput: {
    groq: "openai/gpt-oss-20b",
    openrouter: OPENROUTER_MODEL,
  },
  /**
   * Цикл агента на доске. OpenRouter первым: здесь важнее не цена вызова, а
   * то, что модель не путается в многошаговой цепочке инструментов.
   */
  agent: {
    groq: "openai/gpt-oss-120b",
    openrouter: OPENROUTER_MODEL,
    order: ["openrouter", "groq"],
  },
} as const satisfies Record<string, ModelPair>;

type Env = Record<string, string | undefined>;

const DEFAULT_ORDER: readonly ProviderName[] = ["groq", "openrouter"];

/**
 * Провайдеры, к которым есть ключи, в порядке обращения. Нет ключа — нет
 * провайдера: пустой `Authorization` даёт 401, который выглядит как поломка
 * кода, хотя это просто ненастроенное окружение.
 */
export function resolveProviders(models: ModelPair, env: Env = process.env): LlmProvider[] {
  const keys: Record<ProviderName, string | undefined> = {
    groq: env.GROQ_API_KEY?.trim(),
    openrouter: env.OPENROUTER_API_KEY?.trim(),
  };
  const modelOf: Record<ProviderName, string> = {
    groq: models.groq,
    openrouter: models.openrouter,
  };

  return (models.order ?? DEFAULT_ORDER).flatMap((name) => {
    const apiKey = keys[name];
    if (!apiKey) return [];
    return [{ name, baseUrl: BASE_URLS[name], apiKey, model: modelOf[name] }];
  });
}

/**
 * Перебор провайдеров с падением на следующий при ошибках, виноватых в провайдере.
 *
 * Общий для всех клиентов, потому что логика переноса одна и та же: ошибки 429, 5xx
 * и обрывы связи — повод попробовать другого. Но сам вызов у каждого клиента свой:
 * `chatJson` просит JSON, `chatTools` просит function calling, `capture` контекст
 * отправляет. Поэтому `attempt` — это колбэк, который каждый клиент определяет сам.
 */
export async function withFailover<T>(
  providers: LlmProvider[],
  attempt: (provider: LlmProvider) => Promise<T>
): Promise<T> {
  if (providers.length === 0) {
    throw new Error(
      "Не настроен ни один провайдер модели: задайте GROQ_API_KEY или OPENROUTER_API_KEY"
    );
  }

  for (let index = 0; index < providers.length; index++) {
    const provider = providers[index];
    const isLast = index === providers.length - 1;

    try {
      return await attempt(provider);
    } catch (error) {
      if (isLast || !shouldFailover(error)) throw error;
    }
  }

  // Недостижимо: последний провайдер либо возвращает ответ, либо бросает.
  throw new Error("Провайдеры модели закончились");
}

export type ChatJsonInput = {
  system: string;
  user: string;
  /** Какие модели брать у провайдеров. Игнорируется, если задан `providers`. */
  models: ModelPair;
  temperature?: number;
  /** Готовый список провайдеров — для тестов и вызовов с особой конфигурацией. */
  providers?: LlmProvider[];
  env?: Env;
  fetchFn?: typeof fetch;
};

export type ChatJsonResult = {
  content: string;
  provider: ProviderName;
  model: string;
};

/**
 * Один запрос к модели с ответом в JSON и падением к следующему провайдеру.
 *
 * Перепробовать другого провайдера имеет смысл только там, где виноват сам
 * провайдер: 429 (квота), 5xx (его авария) и обрыв связи. На 4xx запрос уйдёт
 * в отказ и у второго — там ошибка в наших параметрах, и второй вызов только
 * потратит платную квоту.
 */
export async function chatJson(input: ChatJsonInput): Promise<ChatJsonResult> {
  const providers = input.providers ?? resolveProviders(input.models, input.env);
  const fetchFn = input.fetchFn ?? fetch;

  return withFailover(providers, async (provider) => {
    const content = await callProvider(provider, input, fetchFn);
    return { content, provider: provider.name, model: provider.model };
  });
}

/** Стоит ли пробовать следующего провайдера. */
function shouldFailover(error: unknown): boolean {
  // Не LlmError — значит fetch не дошёл (обрыв, таймаут, DNS). Это про
  // конкретного провайдера, а не про запрос: у следующего может получиться.
  if (!(error instanceof LlmError)) return true;
  return error.status === 429 || error.status >= 500;
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
