import { NextRequest, NextResponse } from "next/server";
import { withApiAuth } from "@/lib/api-auth";
import { getTasks, createTask } from "@/lib/services/tasks";

export async function GET(request: NextRequest) {
  return withApiAuth(request, async () => {
    const tasks = await getTasks();
    return NextResponse.json(tasks);
  });
}

export async function POST(request: NextRequest) {
  return withApiAuth(request, async () => {
    const body = await request.json();
    const task = await createTask(body);
    return NextResponse.json(task, { status: 201 });
  });
}
