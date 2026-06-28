import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withApiAuth } from "@/lib/api-auth";
import { createTasksBatch } from "@/lib/services/tasks";
import { createTaskSchema } from "@/lib/agent/schemas";

export async function POST(request: NextRequest) {
  return withApiAuth(request, async () => {
    const body = await request.json();
    const { tasks: taskInputs } = body;

    if (!Array.isArray(taskInputs) || taskInputs.length === 0) {
      return NextResponse.json({ error: "Список задач пуст" }, { status: 400 });
    }

    const parsed = z.array(createTaskSchema).safeParse(taskInputs);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Ошибка валидации", issues: parsed.error.issues },
        { status: 400 }
      );
    }

    const created = await createTasksBatch(parsed.data);
    return NextResponse.json({ created }, { status: 201 });
  });
}
