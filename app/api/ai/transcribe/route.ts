import { NextRequest, NextResponse } from "next/server";
import { withApiAuth } from "@/lib/api-auth";
import { transcribeAudio } from "@/lib/services/groq";

export async function POST(request: NextRequest) {
  return withApiAuth(request, async () => {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: "Файл не найден" }, { status: 400 });
    }

    const maxSize = 25 * 1024 * 1024; // 25MB — лимит Groq
    if (file.size > maxSize) {
      return NextResponse.json({ error: "Файл слишком большой (макс 25MB)" }, { status: 400 });
    }

    const text = await transcribeAudio(file);
    return NextResponse.json({ text });
  });
}
