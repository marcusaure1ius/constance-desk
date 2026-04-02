import { getColumns } from "@/lib/services/columns";
import { getTasks } from "@/lib/services/tasks";
import { getCategories } from "@/lib/services/categories";
import { KanbanBoard } from "@/components/board/kanban-board";

export const dynamic = "force-dynamic";

export default async function BoardPage() {
  const [columnsData, tasksData, categoriesData] = await Promise.all([
    getColumns(),
    getTasks(),
    getCategories(),
  ]);

  return (
    <div className="flex-1 overflow-hidden">
      <KanbanBoard
        columns={columnsData}
        tasks={tasksData}
        categories={categoriesData}
      />
    </div>
  );
}
