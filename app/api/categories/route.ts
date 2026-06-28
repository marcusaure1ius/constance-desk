import { NextRequest, NextResponse } from "next/server";
import { withApiAuth } from "@/lib/api-auth";
import { getCategories, createCategory } from "@/lib/services/categories";
import { createCategorySchema } from "@/lib/agent/schemas";

export async function GET(request: NextRequest) {
  return withApiAuth(request, async () => {
    const environmentId = request.nextUrl.searchParams.get("environmentId");
    if (!environmentId) {
      return NextResponse.json({ error: "environmentId обязателен" }, { status: 400 });
    }
    const categories = await getCategories(environmentId);
    return NextResponse.json(categories);
  });
}

export async function POST(request: NextRequest) {
  return withApiAuth(request, async () => {
    const body = await request.json();
    const parsed = createCategorySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Ошибка валидации", issues: parsed.error.issues },
        { status: 400 }
      );
    }
    const { name, color, environmentId } = parsed.data;
    const category = await createCategory(name, color, environmentId);
    return NextResponse.json(category, { status: 201 });
  });
}
