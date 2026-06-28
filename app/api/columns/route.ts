import { NextRequest, NextResponse } from "next/server";
import { withApiAuth } from "@/lib/api-auth";
import { getColumns } from "@/lib/services/columns";

export async function GET(request: NextRequest) {
  return withApiAuth(request, async () => {
    const environmentId = request.nextUrl.searchParams.get("environmentId");
    if (!environmentId) {
      return NextResponse.json({ error: "environmentId обязателен" }, { status: 400 });
    }
    const columns = await getColumns(environmentId);
    return NextResponse.json(columns);
  });
}
