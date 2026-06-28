import { NextRequest, NextResponse } from "next/server";
import { withApiAuth } from "@/lib/api-auth";
import { getTasks, createTask } from "@/lib/services/tasks";
import { createTaskSchema } from "@/lib/agent/schemas";

export async function GET(request: NextRequest) {
  return withApiAuth(request, async () => {
    const environmentId = request.nextUrl.searchParams.get("environmentId");
    if (!environmentId) {
      return NextResponse.json(
        { error: "environmentId обязателен" },
        { status: 400 }
      );
    }
    const tasks = await getTasks(environmentId);
    return NextResponse.json(tasks);
  });
}

export async function POST(request: NextRequest) {
  return withApiAuth(request, async () => {
    const body = await request.json();
    const parsed = createTaskSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Ошибка валидации", issues: parsed.error.issues },
        { status: 400 }
      );
    }
    const task = await createTask(parsed.data);
    return NextResponse.json(task, { status: 201 });
  });
}
