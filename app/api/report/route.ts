import { NextRequest, NextResponse } from "next/server";
import { withApiAuth } from "@/lib/api-auth";
import { getWeeklyReport, formatReportAsText } from "@/lib/services/reports";
import { startOfWeek } from "date-fns";

export async function GET(request: NextRequest) {
  return withApiAuth(request, async () => {
    const weekParam = request.nextUrl.searchParams.get("week");
    const environmentId = request.nextUrl.searchParams.get("environmentId");
    if (!environmentId) {
      return NextResponse.json(
        { error: "environmentId is required" },
        { status: 400 }
      );
    }
    const date = weekParam ? parseISOWeek(weekParam) : new Date();
    const report = await getWeeklyReport(date, environmentId);
    const fmt = request.nextUrl.searchParams.get("format");

    if (fmt === "text") {
      return new NextResponse(formatReportAsText(report), {
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }

    return NextResponse.json(report);
  });
}

function parseISOWeek(weekStr: string): Date {
  const match = weekStr.match(/^(\d{4})-W(\d{1,2})$/);
  if (!match) return new Date();
  const year = parseInt(match[1]);
  const week = parseInt(match[2]);
  const jan4 = new Date(year, 0, 4);
  const start = startOfWeek(jan4, { weekStartsOn: 1 });
  start.setDate(start.getDate() + (week - 1) * 7);
  return start;
}
