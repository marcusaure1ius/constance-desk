import { NextRequest, NextResponse } from "next/server";
import { verifyApiKey } from "@/lib/services/auth";

export async function withApiAuth(
  request: NextRequest,
  handler: () => Promise<NextResponse>
): Promise<NextResponse> {
  const apiKey = request.headers.get("X-API-Key");
  if (!apiKey) {
    return NextResponse.json({ error: "API key required" }, { status: 401 });
  }
  const valid = await verifyApiKey(apiKey);
  if (!valid) {
    return NextResponse.json({ error: "Invalid API key" }, { status: 401 });
  }
  return handler();
}
