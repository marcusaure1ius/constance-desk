import { LlmError, openRouterKey, OPENROUTER_BASE_URL } from "@/lib/llm/client";

/**
 * Расшифровка голоса через `/audio/transcriptions` OpenRouter.
 *
 * Отдельно от `chatJson`: эндпоинт не чатовый, тело — multipart с файлом.
 *
 * Формат Whisper определяет по ИМЕНИ файла, а не по mime-типу: безымянный Blob
 * получает 400 «could not process file». Отсюда обёртка `voiceFile` — телеграм
 * отдаёт голосовое сырыми байтами, имя ему приходится придумывать.
 */

const TRANSCRIPTIONS_URL = `${OPENROUTER_BASE_URL}/audio/transcriptions`;
/** ogg/opus из телеграма принимает как есть; ~$0,0005 за минуту речи. */
const WHISPER_MODEL = "openai/whisper-large-v3";

/** Потолок на размер записи. Bot API отдаёт файлы и того меньше — до 20 МБ. */
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
  const apiKey = options.apiKey?.trim() || openRouterKey();
  const fetchFn = options.fetchFn ?? fetch;

  const formData = new FormData();
  formData.append("file", file);
  formData.append("model", WHISPER_MODEL);
  formData.append("language", options.language ?? "ru");
  formData.append("response_format", "json");

  const response = await fetchFn(TRANSCRIPTIONS_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: formData,
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => response.statusText);
    throw new LlmError("openrouter", response.status, detail.slice(0, 200) || response.statusText);
  }

  const data = (await response.json()) as { text?: string };
  return stripWhisperHallucinations(data.text ?? "");
}

/** Инициалы с фамилией: «А.Синецкая», «А. Егорова». */
const PERSON = String.raw`[\p{L}]\.\s?[\p{L}-]+`;

/**
 * Фразы, которые Whisper «слышит» в тишине и шуме: он учился на роликах с
 * титрами, и концовка ролика всплывает в конце голосового. Живые примеры —
 * «Субтитры сделал DimaTorzok», «Продолжение следует...», «Редактор
 * субтитров А.Синецкая Корректор А.Егорова», «Спасибо за просмотр».
 * Срезаются только эти обороты целиком, остальной текст не трогается.
 */
const WHISPER_HALLUCINATIONS: RegExp[] = [
  /субтитры\s+(?:сделал|делал|создал|создавал|подготовил[аи]?|подогнал)\s+[\p{L}\p{N}_.-]+[.!…]*/giu,
  new RegExp(String.raw`редактор\s+субтитров(?:\s+${PERSON})*[.!…]*`, "giu"),
  new RegExp(String.raw`корректор(?:\s+${PERSON})+[.!…]*`, "giu"),
  /продолжение\s+следует[.!…]*/giu,
  /спасибо\s+за\s+просмотр[.!…]*/giu,
];

export function stripWhisperHallucinations(text: string): string {
  let result = text;
  for (const pattern of WHISPER_HALLUCINATIONS) result = result.replace(pattern, " ");
  return result
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ +([,.!?…])/g, "$1")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .trim();
}
