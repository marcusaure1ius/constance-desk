import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { mockCreateEpicTask } = vi.hoisted(() => ({ mockCreateEpicTask: vi.fn() }));
vi.mock("@/lib/agent/epic-task", () => ({ createEpicTask: mockCreateEpicTask }));

import { POST } from "@/app/api/agent/epic-task/route";

function postReq(body: unknown) {
  return new NextRequest("http://localhost:3000/api/agent/epic-task", {
    method: "POST",
    headers: { "X-API-Key": "secret-agent-key", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const validBody = {
  environmentId: "env-1",
  epicName: "Запуск MVP",
  columnName: "Бэклог",
  title: "Подготовить список задач",
};

describe("POST /api/agent/epic-task", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("AGENT_API_KEY", "secret-agent-key");
  });

  it("400 при невалидном входе", async () => {
    const res = await POST(postReq({ ...validBody, title: "" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Ошибка валидации");
  });

  it("404, если сервис вернул ok:false", async () => {
    mockCreateEpicTask.mockResolvedValue({ ok: false, error: "Колонка \"Бэклог\" не найдена" });
    const res = await POST(postReq(validBody));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toContain("Бэклог");
  });

  it("201 при успехе", async () => {
    const payload = {
      ok: true,
      task: { id: "task-1", title: validBody.title, columnId: "col-1", categoryId: "cat-1" },
      category: { id: "cat-1", name: "Запуск MVP" },
      createdCategory: true,
    };
    mockCreateEpicTask.mockResolvedValue(payload);
    const res = await POST(postReq(validBody));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({
      task: payload.task,
      category: payload.category,
      createdCategory: true,
    });
  });
});
