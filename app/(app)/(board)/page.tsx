import { getColumns } from "@/lib/services/columns";
import { getTasks } from "@/lib/services/tasks";
import { getCategories } from "@/lib/services/categories";
import { getActiveEnvironmentId } from "@/lib/environment";
import { getActiveEnvironment } from "@/lib/services/environments";
import { KanbanBoard } from "@/components/board/kanban-board";

export default async function BoardPage() {
  const cookieValue = await getActiveEnvironmentId();
  const activeEnv = await getActiveEnvironment(cookieValue);

  if (!activeEnv) return null;

  const [columnsData, tasksData, categoriesData] = await Promise.all([
    getColumns(activeEnv.id),
    getTasks(activeEnv.id),
    getCategories(activeEnv.id),
  ]);

  return (
    <div className="flex-1 overflow-hidden">
      <KanbanBoard
        columns={columnsData}
        tasks={tasksData}
        categories={categoriesData}
        environmentId={activeEnv.id}
      />
    </div>
  );
}
