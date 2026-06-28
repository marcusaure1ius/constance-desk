import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { z } from "zod";
import { isValidAgentKey } from "@/lib/api-auth";
import { getBoardSnapshot } from "@/lib/agent/board";
import { createEpicTask } from "@/lib/agent/epic-task";
import { getEnvironments } from "@/lib/services/environments";
import {
  getTasks,
  createTask,
  updateTask,
  moveTask,
  deleteTask,
} from "@/lib/services/tasks";
import { createCategory } from "@/lib/services/categories";

const json = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
});

const safeJson = async (fn: () => Promise<unknown>) => {
  try {
    return json(await fn());
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Внутренняя ошибка" });
  }
};

const handler = createMcpHandler(
  (server) => {
    server.registerTool(
      "list_environments",
      { title: "Список сред", description: "Вернуть все среды (проекты).", inputSchema: {} },
      async () => safeJson(() => getEnvironments())
    );

    server.registerTool(
      "get_board",
      {
        title: "Снимок доски",
        description: "Вернуть среду, колонки, эпики и задачи одним ответом.",
        inputSchema: { environmentId: z.string() },
      },
      async ({ environmentId }) =>
        safeJson(async () => {
          const snapshot = await getBoardSnapshot(environmentId);
          if (!snapshot) return { error: "Среда не найдена" };
          return snapshot;
        })
    );

    server.registerTool(
      "list_tasks",
      {
        title: "Список задач",
        description: "Вернуть задачи среды.",
        inputSchema: { environmentId: z.string() },
      },
      async ({ environmentId }) => safeJson(() => getTasks(environmentId))
    );

    server.registerTool(
      "create_task",
      {
        title: "Создать задачу",
        description: "Создать задачу в указанной колонке.",
        inputSchema: {
          title: z.string(),
          columnId: z.string(),
          description: z.string().optional(),
          categoryId: z.string().optional(),
          priority: z.enum(["urgent", "high", "normal"]).optional(),
          plannedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        },
      },
      async (args) => safeJson(() => createTask(args))
    );

    server.registerTool(
      "create_epic",
      {
        title: "Создать эпик",
        description: "Создать эпик (категорию) в среде.",
        inputSchema: {
          name: z.string(),
          environmentId: z.string(),
          color: z.string().optional(),
        },
      },
      async ({ name, color, environmentId }) =>
        safeJson(() => createCategory(name, color, environmentId))
    );

    server.registerTool(
      "create_epic_task",
      {
        title: "Создать задачу в эпике",
        description: "Найти или создать эпик и создать в нём задачу одним вызовом.",
        inputSchema: {
          environmentId: z.string(),
          epicName: z.string(),
          columnName: z.string(),
          title: z.string(),
          description: z.string().optional(),
          priority: z.enum(["urgent", "high", "normal"]).optional(),
          plannedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
          epicColor: z.string().optional(),
        },
      },
      async (args) =>
        safeJson(async () => {
          const result = await createEpicTask(args);
          if (!result.ok) return { error: result.error };
          return {
            task: result.task,
            category: result.category,
            createdCategory: result.createdCategory,
          };
        })
    );

    server.registerTool(
      "update_task",
      {
        title: "Обновить задачу",
        description: "Изменить поля задачи.",
        inputSchema: {
          id: z.string(),
          title: z.string().optional(),
          description: z.string().nullable().optional(),
          categoryId: z.string().nullable().optional(),
          priority: z.enum(["urgent", "high", "normal"]).optional(),
          plannedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
        },
      },
      async ({ id, ...data }) => safeJson(() => updateTask(id, data))
    );

    server.registerTool(
      "move_task",
      {
        title: "Переместить задачу",
        description: "Переместить задачу в колонку на позицию.",
        inputSchema: {
          taskId: z.string(),
          targetColumnId: z.string(),
          targetPosition: z.number().int().min(0),
        },
      },
      async ({ taskId, targetColumnId, targetPosition }) =>
        safeJson(async () => {
          await moveTask(taskId, targetColumnId, targetPosition);
          return { success: true };
        })
    );

    server.registerTool(
      "delete_task",
      {
        title: "Удалить задачу",
        description: "Удалить задачу по id.",
        inputSchema: { id: z.string() },
      },
      async ({ id }) =>
        safeJson(async () => {
          await deleteTask(id);
          return { success: true };
        })
    );
  },
  { serverInfo: { name: "constance", version: "1.0.0" }, capabilities: { tools: {} } },
  { basePath: "/api/mcp", maxDuration: 60 }
);

const verifyToken = async (
  _req: Request,
  bearerToken?: string
): Promise<AuthInfo | undefined> => {
  if (!isValidAgentKey(bearerToken)) return undefined;
  return { token: bearerToken!, scopes: ["board:write"], clientId: "agent" };
};

const authHandler = withMcpAuth(handler, verifyToken, { required: true });

export { authHandler as GET, authHandler as POST };
