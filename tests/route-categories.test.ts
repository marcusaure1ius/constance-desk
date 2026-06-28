import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { mockCreateCategory } = vi.hoisted(() => ({ mockCreateCategory: vi.fn() }));
vi.mock("@/lib/services/categories", () => ({
  getCategories: vi.fn(),
  createCategory: mockCreateCategory,
  updateCategory: vi.fn(),
  deleteCategory: vi.fn(),
}));

import { POST } from "@/app/api/categories/route";

function postReq(body: unknown) {
  return new NextRequest("http://localhost:3000/api/categories", {
    method: "POST",
    headers: { "X-API-Key": "secret-agent-key", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/categories", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("AGENT_API_KEY", "secret-agent-key");
  });

  it("400 при пустом name", async () => {
    const res = await POST(postReq({ name: "", environmentId: "env-1" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Ошибка валидации");
  });

  it("201 при валидном входе", async () => {
    const cat = { id: "cat-1", name: "Запуск MVP", color: null, environmentId: "env-1" };
    mockCreateCategory.mockResolvedValue(cat);
    const res = await POST(postReq({ name: "Запуск MVP", environmentId: "env-1" }));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual(cat);
    expect(mockCreateCategory).toHaveBeenCalledWith("Запуск MVP", undefined, "env-1");
  });
});
