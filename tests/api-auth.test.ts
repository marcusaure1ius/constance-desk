import { describe, it, expect, vi } from "vitest";

const { mockVerifyApiKey } = vi.hoisted(() => ({
  mockVerifyApiKey: vi.fn(),
}));

vi.mock("@/lib/services/auth", () => ({
  verifyApiKey: mockVerifyApiKey,
}));

import { withApiAuth } from "@/lib/api-auth";
import { NextRequest, NextResponse } from "next/server";

function makeRequest(headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost:3000/api/test", { headers });
}

describe("withApiAuth", () => {
  it("возвращает 401 без X-API-Key", async () => {
    const handler = vi.fn();
    const res = await withApiAuth(makeRequest(), handler);
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error).toBe("API key required");
    expect(handler).not.toHaveBeenCalled();
  });

  it("возвращает 401 при невалидном ключе", async () => {
    mockVerifyApiKey.mockResolvedValue(false);
    const handler = vi.fn();
    const res = await withApiAuth(
      makeRequest({ "X-API-Key": "wrong" }),
      handler
    );
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error).toBe("Invalid API key");
  });

  it("вызывает handler при валидном ключе", async () => {
    mockVerifyApiKey.mockResolvedValue(true);
    const handler = vi.fn(() =>
      Promise.resolve(NextResponse.json({ ok: true }))
    );
    const res = await withApiAuth(
      makeRequest({ "X-API-Key": "valid" }),
      handler
    );
    const body = await res.json();

    expect(handler).toHaveBeenCalled();
    expect(body.ok).toBe(true);
  });
});
