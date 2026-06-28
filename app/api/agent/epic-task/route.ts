import { NextRequest, NextResponse } from "next/server";
import { withApiAuth } from "@/lib/api-auth";
import { createEpicTask } from "@/lib/agent/epic-task";
import { epicTaskSchema } from "@/lib/agent/schemas";

export async function POST(request: NextRequest) {
  return withApiAuth(request, async () => {
    const body = await request.json();
    const parsed = epicTaskSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Ошибка валидации", issues: parsed.error.issues },
        { status: 400 }
      );
    }
    const result = await createEpicTask(parsed.data);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 404 });
    }
    return NextResponse.json(
      {
        task: result.task,
        category: result.category,
        createdCategory: result.createdCategory,
      },
      { status: 201 }
    );
  });
}
