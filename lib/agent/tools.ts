import { z } from "zod";
import { getBoardSnapshot } from "@/lib/agent/board";
import { createEpicTask } from "@/lib/agent/epic-task";
import {
  defineTool,
  selectTools,
  ToolError,
  type Tool,
  type ToolFilter,
} from "@/lib/agent/tool-registry";
import { createCategory } from "@/lib/services/categories";
import { getEnvironments } from "@/lib/services/environments";
import {
  getTasks,
  createTask,
  updateTask,
  moveTask,
  deleteTask,
} from "@/lib/services/tasks";

const priority = z.enum(["urgent", "high", "normal"]);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Единственный источник правды по инструментам доски. */
export const boardTools: readonly Tool[] = [
  defineTool({
    name: "list_environments",
    title: "Список сред",
    description: "Вернуть все среды (проекты).",
    inputSchema: {},
    surfaces: ["mcp", "chat"],
    mutation: false,
    impact: "read",
    handler: () => getEnvironments(),
  }),

  defineTool({
    name: "get_board",
    title: "Снимок доски",
    description:
      "Вернуть среду, колонки, эпики и задачи одним ответом. По умолчанию без архива.",
    inputSchema: {
      environmentId: z.string(),
      includeArchived: z.boolean().optional(),
    },
    surfaces: ["mcp", "chat"],
    mutation: false,
    impact: "read",
    handler: async ({ environmentId, includeArchived }) => {
      const snapshot = await getBoardSnapshot(environmentId, includeArchived);
      if (!snapshot) throw new ToolError("Среда не найдена");
      return snapshot;
    },
  }),

  defineTool({
    name: "list_tasks",
    title: "Список задач",
    description:
      "Вернуть задачи среды. По умолчанию без архива (задачи, выполненные более 30 дней назад).",
    inputSchema: {
      environmentId: z.string(),
      includeArchived: z.boolean().optional(),
    },
    surfaces: ["mcp", "chat"],
    mutation: false,
    impact: "read",
    handler: ({ environmentId, includeArchived }) =>
      getTasks(environmentId, { includeArchived }),
  }),

  defineTool({
    name: "create_task",
    title: "Создать задачу",
    description: "Создать задачу в указанной колонке.",
    inputSchema: {
      title: z.string(),
      columnId: z.string(),
      description: z.string().optional(),
      categoryId: z.string().optional(),
      priority: priority.optional(),
      plannedDate: isoDate.optional(),
    },
    surfaces: ["mcp", "chat"],
    mutation: true,
    impact: "irreversible",
    handler: (args) => createTask(args),
  }),

  defineTool({
    name: "create_epic",
    title: "Создать эпик",
    description: "Создать эпик (категорию) в среде.",
    inputSchema: {
      name: z.string(),
      environmentId: z.string(),
      color: z.string().optional(),
    },
    surfaces: ["mcp", "chat"],
    mutation: true,
    impact: "irreversible",
    handler: ({ name, color, environmentId }) =>
      createCategory(name, color, environmentId),
  }),

  defineTool({
    name: "create_epic_task",
    title: "Создать задачу в эпике",
    description: "Найти или создать эпик и создать в нём задачу одним вызовом.",
    inputSchema: {
      environmentId: z.string(),
      epicName: z.string(),
      columnName: z.string(),
      title: z.string(),
      description: z.string().optional(),
      priority: priority.optional(),
      plannedDate: isoDate.optional(),
      epicColor: z.string().optional(),
    },
    surfaces: ["mcp", "chat"],
    mutation: true,
    impact: "irreversible",
    handler: async (args) => {
      const result = await createEpicTask(args);
      if (!result.ok) throw new ToolError(result.error);
      return {
        task: result.task,
        category: result.category,
        createdCategory: result.createdCategory,
      };
    },
  }),

  defineTool({
    name: "update_task",
    title: "Обновить задачу",
    description: "Изменить поля задачи.",
    inputSchema: {
      id: z.string(),
      title: z.string().optional(),
      description: z.string().nullable().optional(),
      categoryId: z.string().nullable().optional(),
      priority: priority.optional(),
      plannedDate: isoDate.nullable().optional(),
    },
    surfaces: ["mcp", "chat"],
    mutation: true,
    impact: "irreversible",
    handler: ({ id, ...data }) => updateTask(id, data),
  }),

  defineTool({
    name: "move_task",
    title: "Переместить задачу",
    description: "Переместить задачу в колонку на позицию.",
    inputSchema: {
      taskId: z.string(),
      targetColumnId: z.string(),
      targetPosition: z.number().int().min(0),
    },
    surfaces: ["mcp", "chat"],
    mutation: true,
    impact: "reversible",
    handler: async ({ taskId, targetColumnId, targetPosition }) => {
      await moveTask(taskId, targetColumnId, targetPosition);
      return { success: true };
    },
  }),

  defineTool({
    name: "delete_task",
    title: "Удалить задачу",
    description: "Удалить задачу по id.",
    inputSchema: { id: z.string() },
    surfaces: ["mcp", "chat"],
    mutation: true,
    impact: "irreversible",
    handler: async ({ id }) => {
      await deleteTask(id);
      return { success: true };
    },
  }),
];

/** Инструменты, доступные поверхности. Мутации отключаются флагом. */
export function toolsFor(filter: ToolFilter): Tool[] {
  return selectTools(boardTools, filter);
}

/**
 * Инструмент по имени в рамках поверхности. Чужой инструмент не найдётся:
 * фильтр — свойство кода, а не текста промпта.
 */
export function findTool(name: string, filter: ToolFilter): Tool | undefined {
  return toolsFor(filter).find((tool) => tool.name === name);
}
