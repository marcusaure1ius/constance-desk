import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { mockGetBoardSnapshot } = vi.hoisted(() => ({
  mockGetBoardSnapshot: vi.fn(),
}));
vi.mock("@/lib/agent/board", () => ({ getBoardSnapshot: mockGetBoardSnapshot }));

import { GET } from "@/app/api/board/route";

function req(url: string) {
  return new NextRequest(url, { headers: { "X-API-Key": "secret-agent-key" } });
}

describe("GET /api/board", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("AGENT_API_KEY", "secret-agent-key");
  });

  it("400 без environmentId", async () => {
    const res = await GET(req("http://localhost:3000/api/board"));
    expect(res.status).toBe(400);
  });

  it("404, если среда не найдена", async () => {
    mockGetBoardSnapshot.mockResolvedValue(null);
    const res = await GET(req("http://localhost:3000/api/board?environmentId=missing"));
    expect(res.status).toBe(404);
  });

  it("200 со снимком доски", async () => {
    const snapshot = { environment: { id: "env-1" }, columns: [], categories: [], tasks: [] };
    mockGetBoardSnapshot.mockResolvedValue(snapshot);
    const res = await GET(req("http://localhost:3000/api/board?environmentId=env-1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(snapshot);
  });

  it("401 без ключа", async () => {
    const res = await GET(new NextRequest("http://localhost:3000/api/board?environmentId=env-1"));
    expect(res.status).toBe(401);
  });
});
