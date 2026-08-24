import { LlmError } from "@/lib/llm/client";

/**
 * Расшифровка голоса.
 *
 * Провайдер здесь один и падать некуда: у OpenRouter нет аудио-эндпоинта, он
 * умеет только чат. Поэтому transcribe живёт отдельно от `chatJson` и берёт
 * ключ Groq напрямую.
 *
 * Формат Whisper определяет по ИМЕНИ файла, а не по mime-типу: безымянный Blob
 * получает 400 «could not process file». Отсюда обёртка `voiceFile` — телеграм
 * отдаёт голосовое сырыми байтами, имя ему приходится придумывать.
 */

const GROQ_TRANSCRIPTIONS_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
const WHISPER_MODEL = "whisper-large-v3";

/** Лимит Groq на бесплатном тарифе. Bot API отдаёт файлы и того меньше — до 20 МБ. */
export const TRANSCRIBE_MAX_BYTES = 25 * 1024 * 1024;

export type TranscribeOptions = {
  /** Язык подсказкой. Русский зашит по умолчанию: доска русская. */
  language?: string;
  apiKey?: string;
  fetchFn?: typeof fetch;
};

/**
 * Голосовое из телеграма как File: Bot API отдаёт ogg/opus, а имя нужно
 * задать самим — по нему Whisper понимает контейнер.
 */
export function voiceFile(bytes: ArrayBuffer | Uint8Array): File {
  return new File([bytes as BlobPart], "voice.ogg", { type: "audio/ogg" });
}

export async function transcribeAudio(
  file: File,
  options: TranscribeOptions = {}
): Promise<string> {
  const apiKey = (options.apiKey ?? process.env.GROQ_API_KEY)?.trim();
  if (!apiKey) throw new Error("GROQ_API_KEY не задан — расшифровывать голос нечем");

  const fetchFn = options.fetchFn ?? fetch;

  const formData = new FormData();
  formData.append("file", file);
  formData.append("model", WHISPER_MODEL);
  formData.append("language", options.language ?? "ru");
  formData.append("response_format", "json");

  const response = await fetchFn(GROQ_TRANSCRIPTIONS_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: formData,
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => response.statusText);
    throw new LlmError("groq", response.status, detail.slice(0, 200) || response.statusText);
  }

  const data = (await response.json()) as { text?: string };
  return data.text ?? "";
}
