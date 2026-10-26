import { describe, it, expect } from "vitest";
import {
  botText,
  buildConversation,
  continuesNumbering,
  conversationHistory,
  jevPrevious,
  ownerText,
  type JournalRow,
} from "@/lib/telegram/conversation";

const NOW = new Date("2026-10-26T07:12:00Z");

function message(text: string, extra: Record<string, unknown> = {}) {
  return { update_id: 1, message: { message_id: 1, date: 0, chat: { id: 1, type: "private" }, text, ...extra } };
}

function row(updateId: number, minutesAgo: number, payload: unknown, parsed: unknown, status = "processed"): JournalRow {
  return { updateId, createdAt: new Date(NOW.getTime() - minutesAgo * 60_000), status, payload, parsed };
}

describe("память разговора", () => {
  it("реплики владельца и бота, старые первыми; текущий апдейт и старше окна — нет", () => {
    const rows = [
      row(5, 0, message("это в дополнении к двум задач выше"), null), // текущий
      row(4, 2, message("3. разобраться"), { route: { route: "capture" }, calls: ["Задача «Разобраться»"], agentText: "" }),
      row(3, 70, message("1. Составить план"), { route: { route: "capture" }, calls: ["Добавить подзадачу «Составить план»"] }),
      row(2, 400, message("очень давно"), { route: { route: "capture" }, calls: ["Задача «X»"] }),
    ];
    const turns = buildConversation(rows, { currentUpdateId: 5, now: NOW });
    expect(turns).toEqual([
      { role: "owner", text: "1. Составить план" },
      { role: "bot", text: "Черновик (не отправлен): 1. Добавить подзадачу «Составить план»." },
      { role: "owner", text: "3. разобраться" },
      { role: "bot", text: "Черновик (не отправлен): 1. Задача «Разобраться»." },
    ]);
  });

  it("кнопки, отчёт об отправке, вопрос «что записать?», ответ по доске", () => {
    expect(ownerText({ update_id: 1, callback_query: { id: "1", from: { id: 1, is_bot: false, first_name: "Д" }, data: "d:ok:DRAFT12345" } }, null))
      .toBe("[нажал «✅ Отправить» под черновиком]");
    expect(ownerText({ update_id: 1, callback_query: { id: "1", from: { id: 1, is_bot: false, first_name: "Д" }, data: "t:cl:abc" } }, null)).toBeNull();
    expect(botText("processed", { button: "send", done: 6, total: 6 })).toBe("Отправил черновик на доску: 6 из 6.");
    expect(botText("processed", { route: { route: "capture", intentOnly: true } })).toBe("Спросил: что именно записать?");
    expect(botText("processed", { route: { route: "ask_board" }, reply: "На сегодня: отчёт" })).toBe("Ответ по доске: На сегодня: отчёт");
    expect(botText("processed", { route: { route: "capture" }, calls: [], agentText: "Что именно записать?" })).toBe("Что именно записать?");
    expect(botText("failed", null)).toBe("Не разобрал сообщение.");
  });

  it("голос — из расшифровки, файл — по имени, команды пропускаются", () => {
    const voice = { update_id: 1, message: { message_id: 1, date: 0, chat: { id: 1, type: "private" }, voice: { file_id: "f", file_unique_id: "u", duration: 3 } } };
    expect(ownerText(voice, { transcript: "позвонить Маше" })).toBe("🎙 позвонить Маше");
    expect(ownerText(message("", { document: { file_id: "f", file_name: "встреча.md" } }), null)).toBe("[файл «встреча.md»]");
    expect(ownerText(message("/start"), null)).toBeNull();
  });

  it("объём ограничен: длинные реплики режутся, лишнее срезается с начала", () => {
    const long = "а".repeat(2000);
    const rows = Array.from({ length: 10 }, (_, i) =>
      row(100 - i, i, message(long), { route: { route: "capture" }, calls: [`Задача «${long}»`] })
    );
    const turns = buildConversation(rows, { currentUpdateId: 0, now: NOW });
    const total = turns.reduce((sum, t) => sum + t.text.length, 0);
    expect(total).toBeLessThanOrEqual(4000);
    expect(turns.every((t) => t.text.length <= (t.role === "bot" ? 1000 : 500))).toBe(true);
  });

  it("история агента: user/assistant чередуются, первой — пояснение, последней — бот", () => {
    const history = conversationHistory([
      { role: "owner", text: "1. a" },
      { role: "owner", text: "2. b" },
      { role: "bot", text: "Черновик: …" },
      { role: "owner", text: "3. c" },
    ]);
    expect(history.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant"]);
    expect(history[0].content).toContain("Владелец: 1. a");
    expect(history[0].content).toContain("Владелец: 2. b");
    expect(conversationHistory([])).toEqual([]);
  });

  it("Jev видит последние 4 реплики", () => {
    const turns = Array.from({ length: 6 }, (_, i) => ({ role: "owner" as const, text: String(i) }));
    expect(jevPrevious(turns).map((t) => t.text)).toEqual(["2", "3", "4", "5"]);
  });

  it("продолжение нумерации: «3.» после черновика с пунктами 1–2", () => {
    const a = ["1. Составить план работ со сроками\n2. Написать какая информация нужна от бухгалтеров"];
    expect(continuesNumbering("3. разобраться…\n4. собрать прототип…", a)).toBe(true);
    expect(continuesNumbering("1. разобраться", a)).toBe(false);
    expect(continuesNumbering("5. разобраться", a)).toBe(false);
    expect(continuesNumbering("купить хлеб", a)).toBe(false);
  });
});

describe("реплики бота с пунктами", () => {
  it("«Отправить» и «отправляй» называют пункты", () => {
    expect(botText("processed", { button: "send", done: 1, total: 1, calls: ["Задача «X»"] }))
      .toBe("Отправил черновик на доску: 1 из 1. Создано: 1. Задача «X».");
    expect(botText("processed", { route: { route: "capture", confirm: true }, calls: ["Задача «X»"] }))
      .toBe("Показал черновик заново, с кнопками: 1. Задача «X».");
  });
});
