import { TRANSCRIBE_MAX_BYTES, voiceFile } from "@/lib/llm/transcribe";
import type { TelegramClient } from "@/lib/telegram/client";
import type { fetchLinkPreview } from "@/lib/telegram/link-preview";
import type { TelegramDocument, TelegramEntity, TelegramMessage } from "@/lib/telegram/types";

/**
 * Разобранное входящее сообщение бота: текст, расшифровка голоса, признаки
 * пересылки и ссылки. Любое сообщение — текст, подпись, своё или пересланное
 * голосовое, аудиофайл, пост — приводится к одному виду, на который опираются
 * маршрутизатор и агент.
 */
export type Inbound = {
  /** Текст | подпись | расшифровка; у голоса с подписью — подпись + "\n\n" + расшифровка. */
  text: string;
  transcript?: string;
  forward?: { kind: "channel" | "person"; from?: string; url?: string };
  links: { url: string; title?: string; description?: string }[];
  /** Фото или документ без подписи и без текста. */
  hasUnreadableMedia: boolean;
  /**
   * Прочитанные текстовые файлы (.md, .txt, .csv, …). Поле есть, только если
   * файл был: старые черновики в `tg_handles` его не знают. Текст файла в
   * `text` не попадает — маршрут решается по словам владельца, а не по файлу.
   */
  attachments?: Attachment[];
  /** Имя присланного файла, который бот прочитать не может (pdf, docx, архив). */
  unsupportedAttachment?: string;
};

export type Attachment = { name: string; text: string; truncated: boolean };

export type InboundDeps = {
  client: Pick<TelegramClient, "getFile" | "downloadFile">;
  transcribe: (file: File) => Promise<string>;
  fetchPreview: typeof fetchLinkPreview;
};

/** Столько Telegram отдаёт ботам через getFile. */
const TELEGRAM_FILE_LIMIT = 20 * 1024 * 1024;
const MAX_LINKS = 3;
/**
 * Столько знаков файла уходит агенту. Расшифровка часовой встречи — около
 * 40 тысяч; вместе со снимком доски это всё ещё укладывается в контекст
 * модели с запасом на десять шагов цикла.
 */
export const ATTACHMENT_MAX_CHARS = 60_000;

/** Типы, которые читаются как текст. `text/*` — целиком. */
const TEXT_MIME = new Set([
  "application/json",
  "application/x-ndjson",
  "application/x-yaml",
  "application/yaml",
]);
/**
 * Расширения текстовых файлов. Telegram часто шлёт .md как
 * application/octet-stream, поэтому одного типа мало.
 */
const TEXT_EXTENSIONS = new Set(["md", "markdown", "txt", "csv", "tsv", "json", "log", "yaml", "yml"]);

export async function readInbound(
  message: TelegramMessage,
  deps: InboundDeps
): Promise<{ ok: true; inbound: Inbound } | { ok: false; error: string }> {
  const caption = (message.text ?? message.caption)?.trim() ?? "";
  let text = caption;
  let transcript: string | undefined;

  const audio = message.voice ?? message.audio;
  if (audio) {
    const heard = await transcribeAudio(message, deps);
    if ("error" in heard) return { ok: false, error: heard.error };
    transcript = heard.transcript;
    // Подпись остаётся в тексте: маршрутизатор читает только text.
    text = caption ? `${caption}\n\n${transcript}` : transcript;
  }

  const entities = message.text !== undefined ? message.entities : message.caption_entities;
  const urls = extractUrls(message.text ?? message.caption ?? "", entities);
  const links = await Promise.all(
    urls.map(async (url) => ({ url, ...(await deps.fetchPreview(url)) }))
  );

  let attachments: Attachment[] | undefined;
  let unsupportedAttachment: string | undefined;
  if (message.document) {
    if (isTextDocument(message.document)) {
      const read = await readTextDocument(message.document, deps);
      if ("error" in read) return { ok: false, error: read.error };
      attachments = [read.attachment];
    } else {
      unsupportedAttachment = documentName(message.document);
    }
  }

  const inbound: Inbound = {
    text,
    links,
    hasUnreadableMedia: !text && !attachments && Boolean(message.photo?.length || message.document),
  };
  if (transcript) inbound.transcript = transcript;
  if (attachments) inbound.attachments = attachments;
  if (unsupportedAttachment) inbound.unsupportedAttachment = unsupportedAttachment;
  const forward = readForward(message);
  if (forward) inbound.forward = forward;

  return { ok: true, inbound };
}

/** Голосовое или аудиофайл → расшифровка. */
async function transcribeAudio(
  message: TelegramMessage,
  deps: InboundDeps
): Promise<{ transcript: string } | { error: string }> {
  const audio = (message.voice ?? message.audio)!;
  const label = message.voice ? "голосовое" : "аудио";

  if (audio.file_size !== undefined && audio.file_size > TELEGRAM_FILE_LIMIT) {
    return { error: `${label} длиннее 20 МБ — столько Telegram скачать не даёт` };
  }

  try {
    const file = await deps.client.getFile(audio.file_id);
    if (!file.file_path) return { error: "Telegram не отдал путь к файлу" };

    const bytes = await deps.client.downloadFile(file.file_path);
    if (bytes.byteLength > TRANSCRIBE_MAX_BYTES) {
      return { error: `${label} слишком большое для расшифровки` };
    }

    // Имя файла обязательно: Whisper определяет контейнер по расширению,
    // безымянный Blob получает 400 «could not process file».
    const named = message.voice
      ? voiceFile(bytes)
      : new File([bytes], message.audio?.file_name || "audio.mp3", {
          type: message.audio?.mime_type ?? "audio/mpeg",
        });
    const transcript = (await deps.transcribe(named)).trim();
    if (!transcript) return { error: `в сообщении (${label}) не разобрал ни слова` };

    return { transcript };
  } catch (error) {
    return { error: error instanceof Error ? error.message : `не смог расшифровать ${label}` };
  }
}

/** Текстовый ли файл: по типу или по расширению имени. */
export function isTextDocument(document: TelegramDocument): boolean {
  const mime = document.mime_type?.toLowerCase().split(";")[0].trim();
  if (mime && (mime.startsWith("text/") || TEXT_MIME.has(mime))) return true;
  const extension = document.file_name?.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  return extension !== undefined && TEXT_EXTENSIONS.has(extension);
}

function documentName(document: TelegramDocument): string {
  return document.file_name?.trim() || "без имени";
}

/** Текстовый файл → вложение. Не скачался или пустой — ошибка с кнопкой повтора. */
async function readTextDocument(
  document: TelegramDocument,
  deps: InboundDeps
): Promise<{ attachment: Attachment } | { error: string }> {
  const name = documentName(document);
  if (document.file_size !== undefined && document.file_size > TELEGRAM_FILE_LIMIT) {
    return { error: `файл «${name}» больше 20 МБ — столько Telegram скачать не даёт` };
  }

  let bytes: ArrayBuffer;
  try {
    const file = await deps.client.getFile(document.file_id);
    if (!file.file_path) return { error: "Telegram не отдал путь к файлу" };
    bytes = await deps.client.downloadFile(file.file_path);
  } catch (error) {
    return { error: error instanceof Error ? error.message : `не смог скачать файл «${name}»` };
  }

  const decoded = decodeText(bytes);
  // NUL в тексте не бывает: это бинарник с текстовым расширением.
  if (decoded.includes("\u0000")) return { error: `файл «${name}» не похож на текстовый` };
  const text = decoded.trim();
  if (!text) return { error: `файл «${name}» пустой` };

  if (text.length <= ATTACHMENT_MAX_CHARS) return { attachment: { name, text, truncated: false } };
  // Не разрезаем суррогатную пару: половина эмодзи — битый символ в промпте.
  let cut = ATTACHMENT_MAX_CHARS;
  const code = text.charCodeAt(cut - 1);
  if (code >= 0xd800 && code <= 0xdbff) cut--;
  return { attachment: { name, text: text.slice(0, cut), truncated: true } };
}

/**
 * UTF-8, а если байты им не являются — windows-1251: старые выгрузки и
 * файлы из Windows-программ приходят в ней. BOM TextDecoder снимает сам.
 */
export function decodeText(bytes: ArrayBuffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1251").decode(bytes);
  }
}

/** Ссылки из entities `url` и `text_link`: без дублей, не больше MAX_LINKS. */
function extractUrls(text: string, entities: TelegramEntity[] | undefined): string[] {
  const found: string[] = [];
  for (const entity of entities ?? []) {
    // offset и length Telegram считает в UTF-16 — как и slice в JS.
    const url =
      entity.type === "url"
        ? text.slice(entity.offset, entity.offset + entity.length)
        : entity.type === "text_link"
          ? entity.url
          : undefined;
    if (url && !found.includes(url)) found.push(url);
    if (found.length === MAX_LINKS) break;
  }
  return found;
}

function readForward(message: TelegramMessage): Inbound["forward"] {
  const origin = message.forward_origin;
  if (!origin) return undefined;

  if (origin.type === "user") {
    return { kind: "person", from: origin.sender_user?.first_name };
  }
  if (origin.type === "hidden_user") {
    return { kind: "person", from: origin.sender_user_name };
  }

  const chat = origin.type === "channel" ? origin.chat : (origin.sender_chat ?? origin.chat);
  const forward: NonNullable<Inbound["forward"]> = { kind: "channel" };
  if (chat?.title) forward.from = chat.title;
  if (chat?.username && origin.message_id !== undefined) {
    forward.url = `https://t.me/${chat.username}/${origin.message_id}`;
  }
  return forward;
}

/* ── «проанализируй файл» следом за файлом ────────────────────────────────── */

/**
 * Что хранится в хендле `attachment`. Владелец присылает файл и следом пишет,
 * что с ним сделать («проанализируй файлы, выцепи оттуда задачи»): во втором
 * сообщении файла уже нет. Помним 15 минут (`ttlMinutesFor`) file_id, а не
 * текст: файл перечитывается из Telegram.
 */
export function attachmentMemory(document: TelegramDocument): { document: TelegramDocument } {
  const stored: TelegramDocument = { file_id: document.file_id };
  if (document.file_name) stored.file_name = document.file_name;
  if (document.mime_type) stored.mime_type = document.mime_type;
  if (document.file_size !== undefined) stored.file_size = document.file_size;
  return { document: stored };
}

export function parseAttachmentMemory(payload: unknown): TelegramDocument | null {
  if (typeof payload !== "object" || payload === null) return null;
  const document = (payload as { document?: unknown }).document;
  if (typeof document !== "object" || document === null) return null;
  const doc = document as Record<string, unknown>;
  if (typeof doc.file_id !== "string" || !doc.file_id) return null;
  return document as TelegramDocument;
}

/** Глагол «разобрать» и указание на файл — оба нужны, см. asksAboutAttachment. */
const ANALYZE_VERB =
  /(?<![\p{L}])(?:проанализ|анализ|разбер|разбор|посмотр|глян|выцеп|вытащ|вытян|извлек|достан|прочитай|прочти|изучи)/iu;
const FILE_WORD = /(?<![\p{L}])(?:файл|вложени|документ|транскрипт|расшифровк|оттуда|из\s+него)/iu;

/**
 * «Проанализируй файлы», «разбери вложение» — просьба разобрать только что
 * присланный файл. Нужны и глагол, и указание на файл: «убери вторую задачу
 * из файла» — поправка к черновику, а не новый разбор.
 */
export function asksAboutAttachment(text: string): boolean {
  return ANALYZE_VERB.test(text) && FILE_WORD.test(text);
}
