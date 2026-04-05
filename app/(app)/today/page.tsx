import { getActiveEnvironmentId } from "@/lib/environment";
import { getActiveEnvironment } from "@/lib/services/environments";
import { getColumns } from "@/lib/services/columns";
import { getCategories } from "@/lib/services/categories";
import { getTodayBriefing } from "@/lib/services/today";
import { TodayBriefing } from "@/components/today/today-briefing";

export default async function TodayPage() {
  const cookieValue = await getActiveEnvironmentId();
  const activeEnv = await getActiveEnvironment(cookieValue);

  if (!activeEnv) return null;

  const [briefing, columnsData, categoriesData] = await Promise.all([
    getTodayBriefing(activeEnv.id),
    getColumns(activeEnv.id),
    getCategories(activeEnv.id),
  ]);

  if (!briefing) return null;

  return (
    <TodayBriefing
      briefing={briefing}
      columns={columnsData}
      categories={categoriesData}
    />
  );
}
