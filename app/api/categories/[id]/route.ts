import { NextRequest, NextResponse } from "next/server";
import { withApiAuth } from "@/lib/api-auth";
import { updateCategory, deleteCategory } from "@/lib/services/categories";
import { updateCategorySchema } from "@/lib/agent/schemas";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withApiAuth(request, async () => {
    const { id } = await params;
    const body = await request.json();
    const parsed = updateCategorySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Ошибка валидации", issues: parsed.error.issues },
        { status: 400 }
      );
    }
    const category = await updateCategory(id, parsed.data);
    return NextResponse.json(category);
  });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withApiAuth(request, async () => {
    const { id } = await params;
    await deleteCategory(id);
    return NextResponse.json({ success: true });
  });
}
