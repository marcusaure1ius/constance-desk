import { NextRequest, NextResponse } from "next/server";
import { withApiAuth } from "@/lib/api-auth";
import { getBoardSnapshot } from "@/lib/agent/board";

export async function GET(request: NextRequest) {
  return withApiAuth(request, async () => {
    const environmentId = request.nextUrl.searchParams.get("environmentId");
    if (!environmentId) {
      return NextResponse.json({ error: "environmentId обязателен" }, { status: 400 });
    }
    const snapshot = await getBoardSnapshot(environmentId);
    if (!snapshot) {
      return NextResponse.json({ error: "Среда не найдена" }, { status: 404 });
    }
    return NextResponse.json(snapshot);
  });
}
