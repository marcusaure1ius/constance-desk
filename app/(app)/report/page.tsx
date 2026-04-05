import { getActiveEnvironmentId } from "@/lib/environment";
import { getActiveEnvironment } from "@/lib/services/environments";
import { getExtendedWeeklyReport, getWeeklyTrend } from "@/lib/services/reports";
import { ReportPage } from "@/components/report/report-page";

export const dynamic = "force-dynamic";

export default async function ReportRoute() {
  const cookieValue = await getActiveEnvironmentId();
  const activeEnv = await getActiveEnvironment(cookieValue);
  if (!activeEnv) return null;

  const [report, trend] = await Promise.all([
    getExtendedWeeklyReport(new Date(), activeEnv.id),
    getWeeklyTrend(new Date(), activeEnv.id, 4),
  ]);

  return <ReportPage initialReport={report} initialTrend={trend} environmentId={activeEnv.id} />;
}
