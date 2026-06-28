import { describe, it, expect, beforeEach, vi } from "vitest";
import { withApiAuth, isValidAgentKey } from "@/lib/api-auth";
import { NextRequest, NextResponse } from "next/server";

function makeRequest(headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost:3000/api/test", { headers });
}

describe("withApiAuth", () => {
  beforeEach(() => {
    vi.stubEnv("AGENT_API_KEY", "secret-agent-key");
  });

  it("возвращает 401 без X-API-Key", async () => {
    const handler = vi.fn();
    const res = await withApiAuth(makeRequest(), handler);
    const body = await res.json();
    expect(res.status).toBe(401);
    expect(body.error).toBe("API key required");
    expect(handler).not.toHaveBeenCalled();
  });

  it("возвращает 401 при невалидном ключе", async () => {
    const handler = vi.fn();
    const res = await withApiAuth(makeRequest({ "X-API-Key": "wrong" }), handler);
    const body = await res.json();
    expect(res.status).toBe(401);
    expect(body.error).toBe("Invalid API key");
    expect(handler).not.toHaveBeenCalled();
  });

  it("вызывает handler при валидном AGENT_API_KEY", async () => {
    const handler = vi.fn(() => Promise.resolve(NextResponse.json({ ok: true })));
    const res = await withApiAuth(makeRequest({ "X-API-Key": "secret-agent-key" }), handler);
    const body = await res.json();
    expect(handler).toHaveBeenCalled();
    expect(body.ok).toBe(true);
  });
});

describe("isValidAgentKey", () => {
  beforeEach(() => {
    vi.stubEnv("AGENT_API_KEY", "secret-agent-key");
  });

  it("true для совпадающего ключа", () => {
    expect(isValidAgentKey("secret-agent-key")).toBe(true);
  });
  it("false для неверного ключа", () => {
    expect(isValidAgentKey("nope")).toBe(false);
  });
  it("false для null", () => {
    expect(isValidAgentKey(null)).toBe(false);
  });
  it("false если AGENT_API_KEY не задан", () => {
    vi.stubEnv("AGENT_API_KEY", "");
    expect(isValidAgentKey("anything")).toBe(false);
  });
});
