import { getEnvironmentById } from "@/lib/services/environments";
import { getColumns } from "@/lib/services/columns";
import { getCategories, createCategory } from "@/lib/services/categories";
import { createTask } from "@/lib/services/tasks";

export type CreateEpicTaskInput = {
  environmentId: string;
  epicName: string;
  columnName: string;
  title: string;
  description?: string;
  priority?: "urgent" | "high" | "normal";
  plannedDate?: string;
  epicColor?: string;
};

type Category = Awaited<ReturnType<typeof createCategory>>;
type Task = Awaited<ReturnType<typeof createTask>>;

export type CreateEpicTaskResult =
  | { ok: true; task: Task; category: Category; createdCategory: boolean }
  | { ok: false; error: string };

export async function createEpicTask(
  input: CreateEpicTaskInput
): Promise<CreateEpicTaskResult> {
  const environment = await getEnvironmentById(input.environmentId);
  if (!environment) {
    return { ok: false, error: "Среда не найдена" };
  }

  const columns = await getColumns(input.environmentId);
  const column = columns.find((c) => c.title === input.columnName);
  if (!column) {
    return { ok: false, error: `Колонка "${input.columnName}" не найдена` };
  }

  const categories = await getCategories(input.environmentId);
  let category = categories.find((c) => c.name === input.epicName) as Category | undefined;
  let createdCategory = false;
  if (!category) {
    category = await createCategory(input.epicName, input.epicColor, input.environmentId);
    createdCategory = true;
  }

  const task = await createTask({
    title: input.title,
    description: input.description,
    columnId: column.id,
    categoryId: category.id,
    priority: input.priority,
    plannedDate: input.plannedDate,
  });

  return { ok: true, task, category, createdCategory };
}
