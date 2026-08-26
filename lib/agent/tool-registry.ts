/**
 * Общий реестр инструментов доски.
 *
 * Один инструмент описывается один раз и работает на всех поверхностях: MCP-сервер
 * регистрирует его через `registerTool`, телеграм-бот отдаёт модели через
 * function calling. Копий определений нет, значит и разъехаться нечему.
 */

import { z } from "zod";

/** Где инструмент доступен: MCP-сервер для внешних агентов, chat — бот. */
export type ToolSurface = "mcp" | "chat";

/**
 * Что вызов делает с доской. Отличается от `mutation`: тот отвечает на вопрос
 * «пускать ли инструмент в фазу анализа», а `impact` — «спрашивать ли
 * пользователя». Перенос задачи виден на доске и откатывается глазами,
 * созданная задача и переписанное название — нет.
 */
export type ToolImpact = "read" | "reversible" | "irreversible";

/** Схема входа: сырой shape, из него строятся и zod-объект, и JSON Schema. */
export type ToolShape = Record<string, z.ZodType>;

/** Доменная ошибка инструмента: «среда не найдена», «колонка не найдена». */
export class ToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolError";
  }
}

type ToolSpec<Shape extends ToolShape> = {
  name: string;
  title: string;
  description: string;
  inputSchema: Shape;
  surfaces: readonly ToolSurface[];
  /** true — инструмент меняет данные. В фазе анализа агенту такие не отдаются. */
  mutation: boolean;
  impact: ToolImpact;
  handler: (args: z.infer<z.ZodObject<Shape>>) => Promise<unknown>;
};

/**
 * Инструмент со стёртой схемой: `run` принимает сырые аргументы, поэтому реестр
 * можно перебирать циклом, не теряя типизацию в точке определения.
 */
export type Tool = {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly inputSchema: ToolShape;
  readonly surfaces: readonly ToolSurface[];
  readonly mutation: boolean;
  readonly impact: ToolImpact;
  /** Валидирует вход схемой инструмента и вызывает handler. Бросает при плохом входе. */
  readonly run: (rawArgs: unknown) => Promise<unknown>;
};

/**
 * Связывает zod-схему и handler в точке определения: аргументы handler выводятся
 * из схемы. Цикл по массиву без этого схлопнул бы типизацию до `any`.
 */
export function defineTool<Shape extends ToolShape>(spec: ToolSpec<Shape>): Tool {
  const schema = z.object(spec.inputSchema);
  return {
    name: spec.name,
    title: spec.title,
    description: spec.description,
    inputSchema: spec.inputSchema,
    surfaces: spec.surfaces,
    mutation: spec.mutation,
    impact: spec.impact,
    run: async (rawArgs) => spec.handler(schema.parse(rawArgs ?? {})),
  };
}

export type ToolFilter = {
  surface: ToolSurface;
  /** false — только читающие инструменты (фаза анализа агентского пути). */
  includeMutations?: boolean;
};

export function selectTools(tools: readonly Tool[], filter: ToolFilter): Tool[] {
  const { surface, includeMutations = true } = filter;
  return tools.filter(
    (tool) => tool.surfaces.includes(surface) && (includeMutations || !tool.mutation)
  );
}

/** Вызов не исполняется в цикле, а уходит пользователю на подтверждение. */
export function isDeferred(tool: Tool): boolean {
  return tool.impact === "irreversible";
}

/** Результат вызова инструмента. Провал — значение, а не исключение. */
export type ToolOutcome =
  | { ok: true; data: unknown }
  | { ok: false; error: string };

function errorMessage(error: unknown): string {
  if (error instanceof z.ZodError) {
    const issues = error.issues
      .map((issue) => `${issue.path.join(".") || "(корень)"} — ${issue.message}`)
      .join("; ");
    return `Неверные аргументы: ${issues}`;
  }
  return error instanceof Error ? error.message : "Внутренняя ошибка";
}

export async function runTool(tool: Tool, rawArgs: unknown): Promise<ToolOutcome> {
  try {
    return { ok: true, data: await tool.run(rawArgs) };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}

/** Ответ MCP-инструмента. Совместим с CallToolResult из SDK. */
export type McpToolResult = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

/**
 * Провал помечается `isError: true`. Без флага модель не отличает успех от
 * ошибки: и то и другое приходит обычным текстом.
 */
export function toMcpResult(outcome: ToolOutcome): McpToolResult {
  const payload = outcome.ok ? (outcome.data ?? null) : { error: outcome.error };
  const result: McpToolResult = {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
  };
  if (!outcome.ok) result.isError = true;
  return result;
}

/** Ответ инструмента для чат-моделей (OpenAI-совместимый формат Groq и OpenRouter). */
export type ToolMessage = {
  role: "tool";
  tool_call_id: string;
  content: string;
};

export function toToolMessage(toolCallId: string, outcome: ToolOutcome): ToolMessage {
  const payload = outcome.ok
    ? { ok: true, data: outcome.data ?? null }
    : { ok: false, error: outcome.error };
  return { role: "tool", tool_call_id: toolCallId, content: JSON.stringify(payload) };
}

/**
 * JSON Schema входа. Строится через `z.object(shape)`: сырой shape
 * `z.toJSONSchema` не принимает и бросает исключение.
 */
export function toJsonSchema(tool: Tool): Record<string, unknown> {
  return z.toJSONSchema(z.object(tool.inputSchema), { io: "input" });
}

/** Описание инструмента для function calling. */
export type FunctionSpec = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export function toFunctionSpec(tool: Tool): FunctionSpec {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: toJsonSchema(tool),
    },
  };
}
