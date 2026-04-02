import { NextRequest, NextResponse } from "next/server";
import { withApiAuth } from "@/lib/api-auth";
import { updateTask, deleteTask } from "@/lib/services/tasks";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withApiAuth(request, async () => {
    const { id } = await params;
    const body = await request.json();
    const task = await updateTask(id, body);
    return NextResponse.json(task);
  });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withApiAuth(request, async () => {
    const { id } = await params;
    await deleteTask(id);
    return NextResponse.json({ success: true });
  });
}
