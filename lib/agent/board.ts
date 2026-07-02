import { getEnvironmentById } from "@/lib/services/environments";
import { getColumns } from "@/lib/services/columns";
import { getCategories } from "@/lib/services/categories";
import { getTasks } from "@/lib/services/tasks";

export type BoardSnapshot = {
  environment: NonNullable<Awaited<ReturnType<typeof getEnvironmentById>>>;
  columns: Awaited<ReturnType<typeof getColumns>>;
  categories: Awaited<ReturnType<typeof getCategories>>;
  tasks: Awaited<ReturnType<typeof getTasks>>;
};

export async function getBoardSnapshot(
  environmentId: string,
  includeArchived = false
): Promise<BoardSnapshot | null> {
  const environment = await getEnvironmentById(environmentId);
  if (!environment) return null;

  const [columns, categories, tasks] = await Promise.all([
    getColumns(environmentId),
    getCategories(environmentId),
    getTasks(environmentId, { includeArchived }),
  ]);

  return { environment, columns, categories, tasks };
}
