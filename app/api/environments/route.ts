import { NextRequest, NextResponse } from "next/server";
import { withApiAuth } from "@/lib/api-auth";
import { getEnvironments } from "@/lib/services/environments";

export async function GET(request: NextRequest) {
  return withApiAuth(request, async () => {
    const environments = await getEnvironments();
    return NextResponse.json(environments);
  });
}
