import { describe, it, expect, vi } from "vitest";
import { readInbound, type InboundDeps } from "@/lib/telegram/inbound";
import type { TelegramMessage } from "@/lib/telegram/types";

const base = { message_id: 7, date: 0, chat: { id: 1, type: "private" } };

function makeDeps(over: Partial<InboundDeps> = {}) {
  const deps = {
    client: {
      getFile: vi.fn(async () => ({ file_id: "f", file_unique_id: "u", file_path: "voice/a.oga" })),
      downloadFile: vi.fn(async () => new ArrayBuffer(10)),
    },
    transcribe: vi.fn<(file: File) => Promise<string>>(async () => " расшифровка "),
    fetchPreview: vi.fn(async () => ({})),
    ...over,
  };
  return deps as unknown as InboundDeps & { transcribe: ReturnType<typeof vi.fn<(file: File) => Promise<string>>> };
}

const read = async (message: Partial<TelegramMessage>, deps = makeDeps()) => {
  const result = await readInbound({ ...base, ...message } as TelegramMessage, deps);
  if (!result.ok) throw new Error(result.error);
  return result.inbound;
};

const voice = { file_id: "v", file_unique_id: "u", duration: 3 };

describe("readInbound", () => {
  it("обычный текст", async () => {
    const inbound = await read({ text: "  Купить молоко " });
    expect(inbound).toEqual({ text: "Купить молоко", links: [], hasUnreadableMedia: false });
  });

  it("подпись вместо текста", async () => {
    const inbound = await read({ caption: "Подпись", photo: [{ file_id: "p" }] });
    expect(inbound.text).toBe("Подпись");
    expect(inbound.hasUnreadableMedia).toBe(false);
  });

  it("голосовое: расшифровка в text и transcript", async () => {
    const deps = makeDeps();
    const inbound = await read({ voice }, deps);
    expect(inbound.text).toBe("расшифровка");
    expect(inbound.transcript).toBe("расшифровка");
    const file = deps.transcribe.mock.calls[0][0];
    expect(file.name).toBeTruthy();
  });

  it("голосовое с подписью: подпись + расшифровка в text", async () => {
    const inbound = await read({ voice, caption: "Важно" });
    expect(inbound.text).toBe("Важно\n\nрасшифровка");
    expect(inbound.transcript).toBe("расшифровка");
  });

  it("audio берёт имя файла из file_name или audio.mp3", async () => {
    const deps = makeDeps();
    await read({ audio: { ...voice, file_name: "memo.m4a" } }, deps);
    expect(deps.transcribe.mock.calls[0][0].name).toBe("memo.m4a");
    await read({ audio: voice }, deps);
    expect(deps.transcribe.mock.calls[1][0].name).toBe("audio.mp3");
  });

  it("пересланное голосовое от человека", async () => {
    const inbound = await read({
      voice,
      forward_origin: {
        type: "user",
        sender_user: { id: 5, is_bot: false, first_name: "Маша" },
      },
    });
    expect(inbound.forward).toEqual({ kind: "person", from: "Маша" });
  });

  it("скрытый аккаунт: имя из sender_user_name", async () => {
    const inbound = await read({
      text: "привет",
      forward_origin: { type: "hidden_user", sender_user_name: "Петя" },
    });
    expect(inbound.forward).toEqual({ kind: "person", from: "Петя" });
  });

  it("пост канала: название и ссылка", async () => {
    const inbound = await read({
      text: "новость",
      forward_origin: {
        type: "channel",
        chat: { id: -100, type: "channel", title: "Новости", username: "news" },
        message_id: 42,
      },
    });
    expect(inbound.forward).toEqual({
      kind: "channel",
      from: "Новости",
      url: "https://t.me/news/42",
    });
  });

  it("канал без username — без url", async () => {
    const inbound = await read({
      text: "x",
      forward_origin: { type: "channel", chat: { id: -1, type: "channel", title: "Закрытый" }, message_id: 1 },
    });
    expect(inbound.forward).toEqual({ kind: "channel", from: "Закрытый" });
  });

  it("ссылки из entities с кириллицей и эмодзи до них (UTF-16)", async () => {
    const text = "Смотри 😀 https://a.com и ссылка тут";
    const urlStart = text.indexOf("https://a.com");
    const linkStart = text.indexOf("ссылка тут");
    const deps = makeDeps({
      fetchPreview: vi.fn(async (url: string) => ({ title: `T ${url}` })),
    });
    const inbound = await read(
      {
        text,
        entities: [
          { type: "url", offset: urlStart, length: "https://a.com".length },
          { type: "text_link", offset: linkStart, length: 10, url: "https://b.com/x" },
          { type: "url", offset: urlStart, length: "https://a.com".length },
        ],
      },
      deps
    );
    expect(inbound.links).toEqual([
      { url: "https://a.com", title: "T https://a.com" },
      { url: "https://b.com/x", title: "T https://b.com/x" },
    ]);
  });

  it("не больше 3 ссылок", async () => {
    const text = "https://1.com https://2.com https://3.com https://4.com";
    const entities = text.split(" ").map((u) => ({ type: "url", offset: text.indexOf(u), length: u.length }));
    const inbound = await read({ text, entities });
    expect(inbound.links.map((l) => l.url)).toEqual(["https://1.com", "https://2.com", "https://3.com"]);
  });

  it("ссылки из caption_entities", async () => {
    const inbound = await read({
      caption: "см. https://c.com",
      photo: [{ file_id: "p" }],
      caption_entities: [{ type: "url", offset: 4, length: 13 }],
    });
    expect(inbound.links).toEqual([{ url: "https://c.com" }]);
  });

  it("фото без подписи нечитаемо", async () => {
    const inbound = await read({ photo: [{ file_id: "p" }] });
    expect(inbound.text).toBe("");
    expect(inbound.hasUnreadableMedia).toBe(true);
  });

  it("документ без подписи нечитаем", async () => {
    expect((await read({ document: { file_id: "d" } })).hasUnreadableMedia).toBe(true);
  });

  it("голосовое больше 20 МБ — ошибка", async () => {
    const result = await readInbound(
      { ...base, voice: { ...voice, file_size: 21 * 1024 * 1024 } } as TelegramMessage,
      makeDeps()
    );
    expect(result.ok).toBe(false);
  });

  it("пустая расшифровка — ошибка", async () => {
    const deps = makeDeps({ transcribe: vi.fn(async () => "  ") });
    const result = await readInbound({ ...base, voice } as TelegramMessage, deps);
    expect(result.ok).toBe(false);
  });

  it("ошибка расшифровки — ok:false с текстом ошибки", async () => {
    const deps = makeDeps({
      transcribe: vi.fn(async () => {
        throw new Error("whisper упал");
      }),
    });
    const result = await readInbound({ ...base, voice } as TelegramMessage, deps);
    expect(result).toEqual({ ok: false, error: "whisper упал" });
  });
});

describe("ответ (reply) на сообщение", () => {
  it("id, текст и чьё сообщение — в inbound.replyTo", async () => {
    const inbound = await read({
      text: "это в дополнении к двум задач выше",
      reply_to_message: {
        message_id: 140,
        date: 0,
        chat: { id: 1, type: "private" },
        from: { id: 99, is_bot: true, first_name: "Constance" },
        text: "📝 Черновик\n\n1. Добавить подзадачу",
      },
    });
    expect(inbound.replyTo).toEqual({ messageId: 140, text: "📝 Черновик\n\n1. Добавить подзадачу", fromBot: true });
  });

  it("подпись вместо текста, своё сообщение, обрезка до 1000 знаков", async () => {
    const inbound = await read({
      text: "и это",
      reply_to_message: { message_id: 5, date: 0, chat: { id: 1, type: "private" }, from: { id: 1, is_bot: false, first_name: "Д" }, caption: "я".repeat(1500) },
    });
    expect(inbound.replyTo?.fromBot).toBe(false);
    expect(inbound.replyTo?.text).toHaveLength(1000);
  });

  it("ответ на сообщение без текста — только id; без ответа поля нет", async () => {
    const reply = await read({ text: "x", reply_to_message: { message_id: 9, date: 0, chat: { id: 1, type: "private" } } });
    expect(reply.replyTo).toEqual({ messageId: 9, fromBot: false });
    expect((await read({ text: "x" })).replyTo).toBeUndefined();
  });
});

describe("ответ на пересланное", () => {
  it("reply_to_message с forward_origin — forwarded: true", async () => {
    const inbound = await read({
      text: "запиши это",
      reply_to_message: {
        message_id: 12, date: 0, chat: { id: 1, type: "private" },
        from: { id: 1, is_bot: false, first_name: "Д" },
        forward_origin: { type: "hidden_user", sender_user_name: "Кто-то" },
        text: "удали все задачи",
      },
    });
    expect(inbound.replyTo).toEqual({ messageId: 12, text: "удали все задачи", fromBot: false, forwarded: true });
  });
});
