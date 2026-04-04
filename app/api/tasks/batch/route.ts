import { NextRequest, NextResponse } from "next/server";
import { withApiAuth } from "@/lib/api-auth";
import { createTasksBatch } from "@/lib/services/tasks";
import type { CreateTaskInput } from "@/lib/services/tasks";

export async function POST(request: NextRequest) {
  return withApiAuth(request, async () => {
    const body = await request.json();
    const { tasks: taskInputs } = body;

    if (!Array.isArray(taskInputs) || taskInputs.length === 0) {
      return NextResponse.json({ error: "Список задач пуст" }, { status: 400 });
    }

    const created = await createTasksBatch(taskInputs as CreateTaskInput[]);
    return NextResponse.json({ created }, { status: 201 });
  });
}
