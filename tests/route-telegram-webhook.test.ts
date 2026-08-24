import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  handleUpdate: vi.fn(),
  defaultDeps: vi.fn(() => ({ marker: "deps" })),
  after: vi.fn(),
}));

// after() исполняется только в реальном запросе Next: в тесте подменяем его
// немедленным вызовом, иначе роут падает с «outside a request scope».
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: mocks.after,
}));

vi.mock("@/lib/telegram/handle-update", () => ({
  handleUpdate: mocks.handleUpdate,
  defaultDeps: mocks.defaultDeps,
}));

import { POST, maxDuration } from "@/app/api/telegram/webhook/route";

const SECRET = "webhook-secret-value";
const UPDATE = {
  update_id: 100,
  message: { message_id: 1, date: 1, chat: { id: 555, type: "private" }, text: "/start" },
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
    mocks.handleUpdate.mockResolvedValue({ status: "processed", action: "start" });
    // Немедленный вызов: проверяем, что именно уходит в фоновую работу
    mocks.after.mockImplementation((callback: () => unknown) => callback());
  });

  it("401 без заголовка секрета", async () => {
    const res = await POST(request(UPDATE, null));
    expect(res.status).toBe(401);
    expect(mocks.handleUpdate).not.toHaveBeenCalled();
  });

  it("401 с неверным секретом той же длины", async () => {
    const wrong = "wrong-secret-value!!";
    expect(wrong).toHaveLength(SECRET.length);
    const res = await POST(request(UPDATE, wrong));
    expect(res.status).toBe(401);
    expect(mocks.handleUpdate).not.toHaveBeenCalled();
  });

  it("401 с секретом другой длины", async () => {
    const res = await POST(request(UPDATE, SECRET.slice(0, -1)));
    expect(res.status).toBe(401);
  });

  it("401, если секрет не настроен в окружении", async () => {
    vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", "");
    const res = await POST(request(UPDATE, SECRET));
    expect(res.status).toBe(401);
    expect(mocks.handleUpdate).not.toHaveBeenCalled();
  });

  it("200 и передача апдейта в обработчик при верном секрете", async () => {
    const res = await POST(request(UPDATE));

    expect(res.status).toBe(200);
    expect(mocks.after).toHaveBeenCalledTimes(1);
    expect(mocks.handleUpdate).toHaveBeenCalledWith(UPDATE, { marker: "deps" });
  });

  it("чужой чат: обработчик решает молчать, вебхук всё равно отвечает 200", async () => {
    mocks.handleUpdate.mockResolvedValue({ status: "ignored", reason: "foreign_chat" });
    const foreign = { ...UPDATE, message: { ...UPDATE.message, chat: { id: 999, type: "private" } } };

    const res = await POST(request(foreign));

    expect(res.status).toBe(200);
    expect(mocks.handleUpdate).toHaveBeenCalledWith(foreign, { marker: "deps" });
  });

  it("битое тело не уходит в обработку, но получает 200", async () => {
    const res = await POST(request(null, SECRET, "{это не json"));

    expect(res.status).toBe(200);
    expect(mocks.after).not.toHaveBeenCalled();
    expect(mocks.handleUpdate).not.toHaveBeenCalled();
  });

  it("падение обработчика не превращается в не-2xx", async () => {
    mocks.handleUpdate.mockRejectedValue(new Error("база недоступна"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await POST(request(UPDATE));

    expect(res.status).toBe(200);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it("дедлайн фоновой работы задан явно", () => {
    expect(maxDuration).toBe(60);
  });
});
