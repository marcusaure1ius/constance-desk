import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";

if (!process.env.AGENT_API_KEY && process.env.NODE_ENV === "production") {
  throw new Error("AGENT_API_KEY is required in production");
}

export function isValidAgentKey(key: string | null | undefined): boolean {
  const expected = process.env.AGENT_API_KEY;
  if (!expected || !key) return false;
  const a = Buffer.from(key);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function withApiAuth(
  request: NextRequest,
  handler: () => Promise<NextResponse>
): Promise<NextResponse> {
  const apiKey = request.headers.get("X-API-Key");
  if (!apiKey) {
    return NextResponse.json({ error: "API key required" }, { status: 401 });
  }
  if (!isValidAgentKey(apiKey)) {
    return NextResponse.json({ error: "Invalid API key" }, { status: 401 });
  }
  return handler();
}
