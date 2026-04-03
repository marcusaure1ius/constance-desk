"use server";

import { getTasksForToday } from "@/lib/services/tasks";
import { getColumns } from "@/lib/services/columns";

export async function getTodayPlanAction(environmentId: string) {
  const [todayTasks, columns] = await Promise.all([
    getTasksForToday(environmentId),
    getColumns(environmentId),
  ]);

  const grouped = columns
    .map((col) => ({
      column: col,
      tasks: todayTasks.filter((t) => t.columnId === col.id),
    }))
    .filter((g) => g.tasks.length > 0);

  return { grouped, totalCount: todayTasks.length };
}
