import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  receiveUpdate: vi.fn(),
  handleUpdate: vi.fn(),
  defaultDeps: vi.fn<(options?: { deadlineAt?: number }) => { marker: string }>(() => ({
    marker: "deps",
  })),
  after: vi.fn(),
}));

// after() исполняется только в реальном запросе Next: в тесте подменяем его
// немедленным вызовом, иначе роут падает с «outside a request scope».
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: mocks.after,
}));

vi.mock("@/lib/telegram/handle-update", () => ({
  receiveUpdate: mocks.receiveUpdate,
  handleUpdate: mocks.handleUpdate,
  defaultDeps: mocks.defaultDeps,
}));

import { POST, maxDuration } from "@/app/api/telegram/webhook/route";

const SECRET = "webhook-secret-value";
const CHAT = 555;
const UPDATE = {
  update_id: 100,
  message: { message_id: 1, date: 1, chat: { id: CHAT, type: "private" }, text: "/start" },
};

function request(body: unknown, secret: string | null = SECRET, raw?: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (secret !== null) headers["X-Telegram-Bot-Api-Secret-Token"] = secret;
  return new Request("http://localhost:3000/api/telegram/webhook", {
    method: "POST",
    headers,
    body: raw ?? JSON.stringify(body),
  });
}

describe("вебхук Telegram", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", SECRET);
    mocks.receiveUpdate.mockResolvedValue({ status: "accepted", chatId: CHAT });
    mocks.handleUpdate.mockResolvedValue({ status: "processed", action: "start" });
    // Немедленный вызов: проверяем, что именно уходит в фоновую работу
    mocks.after.mockImplementation((callback: () => unknown) => callback());
  });

  it("401 без заголовка секрета", async () => {
    const res = await POST(request(UPDATE, null));
    expect(res.status).toBe(401);
    expect(mocks.receiveUpdate).not.toHaveBeenCalled();
    expect(mocks.handleUpdate).not.toHaveBeenCalled();
  });

  it("401 с неверным секретом той же длины", async () => {
    const wrong = "wrong-secret-value!!";
    expect(wrong).toHaveLength(SECRET.length);
    const res = await POST(request(UPDATE, wrong));
    expect(res.status).toBe(401);
    expect(mocks.receiveUpdate).not.toHaveBeenCalled();
  });

  it("401 с секретом другой длины", async () => {
    const res = await POST(request(UPDATE, SECRET.slice(0, -1)));
    expect(res.status).toBe(401);
  });

  it("401, если секрет не настроен в окружении", async () => {
    vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", "");
    const res = await POST(request(UPDATE, SECRET));
    expect(res.status).toBe(401);
    expect(mocks.receiveUpdate).not.toHaveBeenCalled();
  });

  it("200, запись в журнал и передача апдейта в обработчик при верном секрете", async () => {
    const res = await POST(request(UPDATE));

    expect(res.status).toBe(200);
    expect(mocks.receiveUpdate).toHaveBeenCalledWith(UPDATE, { marker: "deps" });
    expect(mocks.after).toHaveBeenCalledTimes(1);
    expect(mocks.handleUpdate).toHaveBeenCalledWith(UPDATE, CHAT, { marker: "deps" });
  });

  it("ответ 200 не уходит, пока апдейт не записан в журнал", async () => {
    // Порядок здесь и есть предмет проверки: Telegram считает апдейт
    // доставленным с момента ответа, поэтому запись обязана его опередить.
    let record: (result: unknown) => void = () => {};
    mocks.receiveUpdate.mockImplementation(
      () =>
        new Promise((resolve) => {
          record = resolve;
        })
    );

    let answered = false;
    const pending = POST(request(UPDATE)).then((res) => {
      answered = true;
      return res;
    });

    await vi.waitFor(() => expect(mocks.receiveUpdate).toHaveBeenCalled());
    // Макрозадача: все микрозадачи роута успели бы отработать, если бы он
    // отвечал не дожидаясь журнала.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(answered).toBe(false);
    expect(mocks.handleUpdate).not.toHaveBeenCalled();

    record({ status: "accepted", chatId: CHAT });
    expect((await pending).status).toBe(200);
  });

  it("обработка уходит в after, а не в тело роута", async () => {
    // Обратная сторона того же порядка: работа не должна задерживать ответ.
    mocks.after.mockImplementation(() => {});

    const res = await POST(request(UPDATE));

    expect(res.status).toBe(200);
    expect(mocks.receiveUpdate).toHaveBeenCalledTimes(1);
    expect(mocks.handleUpdate).not.toHaveBeenCalled();
  });

  it("повторная доставка отсекается до всякой работы", async () => {
    mocks.receiveUpdate.mockResolvedValue({ status: "duplicate", chatId: CHAT });

    const res = await POST(request(UPDATE));

    expect(res.status).toBe(200);
    expect(mocks.after).not.toHaveBeenCalled();
    expect(mocks.handleUpdate).not.toHaveBeenCalled();
  });

  it("чужой чат: обработчик решает молчать, вебхук всё равно отвечает 200", async () => {
    mocks.receiveUpdate.mockResolvedValue({ status: "ignored", reason: "foreign_chat" });
    const foreign = { ...UPDATE, message: { ...UPDATE.message, chat: { id: 999, type: "private" } } };

    const res = await POST(request(foreign));

    expect(res.status).toBe(200);
    expect(mocks.receiveUpdate).toHaveBeenCalledWith(foreign, { marker: "deps" });
    expect(mocks.after).not.toHaveBeenCalled();
  });

  it("битое тело не уходит в обработку, но получает 200", async () => {
    const res = await POST(request(null, SECRET, "{это не json"));

    expect(res.status).toBe(200);
    expect(mocks.receiveUpdate).not.toHaveBeenCalled();
    expect(mocks.after).not.toHaveBeenCalled();
    expect(mocks.handleUpdate).not.toHaveBeenCalled();
  });

  it("сбой журнала не превращается в не-2xx, но апдейт попадает в лог целиком", async () => {
    // Не-2xx запустил бы сутки ретраев в ту же мёртвую базу, поэтому 200.
    mocks.receiveUpdate.mockRejectedValue(new Error("база недоступна"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await POST(request(UPDATE));

    expect(res.status).toBe(200);
    expect(mocks.handleUpdate).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(expect.any(String), UPDATE, expect.any(Error));
    error.mockRestore();
  });

  it("падение обработчика не превращается в не-2xx", async () => {
    mocks.handleUpdate.mockRejectedValue(new Error("журнал недоступен"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await POST(request(UPDATE));

    expect(res.status).toBe(200);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it("дедлайн фоновой работы задан явно и передан в зависимости", () => {
    expect(maxDuration).toBe(60);
  });

  it("клиент получает момент, когда функцию убьют", async () => {
    const before = Date.now();
    await POST(request(UPDATE));

    expect(mocks.defaultDeps).toHaveBeenCalledWith({ deadlineAt: expect.any(Number) });
    const { deadlineAt } = mocks.defaultDeps.mock.calls[0][0] as { deadlineAt: number };
    // Дедлайн — конец жизни функции, то есть примерно maxDuration от сейчас.
    expect(deadlineAt).toBeGreaterThanOrEqual(before + maxDuration * 1000);
    expect(deadlineAt).toBeLessThanOrEqual(Date.now() + maxDuration * 1000);
  });
});
