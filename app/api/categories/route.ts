import { NextRequest, NextResponse } from "next/server";
import { withApiAuth } from "@/lib/api-auth";
import { getCategories } from "@/lib/services/categories";

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
