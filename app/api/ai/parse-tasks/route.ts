import { NextRequest, NextResponse } from "next/server";
import { withApiAuth } from "@/lib/api-auth";
import { parseTasks } from "@/lib/services/groq";

export async function POST(request: NextRequest) {
  return withApiAuth(request, async () => {
    const body = await request.json();
    const { text } = body;

    if (!text || typeof text !== "string" || text.trim().length === 0) {
      return NextResponse.json({ error: "Текст не указан" }, { status: 400 });
    }

    const tasks = await parseTasks(text.trim());
    return NextResponse.json({ tasks });
  });
}
