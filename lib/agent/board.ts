import { getEnvironmentById } from "@/lib/services/environments";
import { getColumns } from "@/lib/services/columns";
import { getCategories } from "@/lib/services/categories";
import { getTasks } from "@/lib/services/tasks";
import { getSubtasksForTasks } from "@/lib/services/subtasks";

/** Подзадача глазами агента: модели хватает названия, срока и отметки. */
export type AgentSubtask = {
  id: string;
  title: string;
  dueDate: string | null;
  done: boolean;
};

type TaskWithSubtasks = Awaited<ReturnType<typeof getTasks>>[number] & {
  subtasks: AgentSubtask[];
};

export type BoardSnapshot = {
  environment: NonNullable<Awaited<ReturnType<typeof getEnvironmentById>>>;
  columns: Awaited<ReturnType<typeof getColumns>>;
  categories: Awaited<ReturnType<typeof getCategories>>;
  tasks: TaskWithSubtasks[];
};

/** Кладёт подзадачи внутрь задач — одним запросом на все задачи разом. */
export async function withSubtasks<T extends { id: string }>(
  tasks: T[]
): Promise<(T & { subtasks: AgentSubtask[] })[]> {
  const subtasks = await getSubtasksForTasks(tasks.map((t) => t.id));
  return tasks.map((task) => ({
    ...task,
    subtasks: subtasks
      .filter((s) => s.taskId === task.id)
      .map((s) => ({ id: s.id, title: s.title, dueDate: s.dueDate, done: s.completedAt !== null })),
  }));
}

export async function getBoardSnapshot(
  environmentId: string,
  includeArchived = false
): Promise<BoardSnapshot | null> {
  const environment = await getEnvironmentById(environmentId);
  if (!environment) return null;

  const [columns, categories, tasks] = await Promise.all([
    getColumns(environmentId),
    getCategories(environmentId),
    getTasks(environmentId, { includeArchived }).then(withSubtasks),
  ]);

  return { environment, columns, categories, tasks };
}
