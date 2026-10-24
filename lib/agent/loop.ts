import { buildAgentPrompt } from "@/lib/llm/agent-prompt";
import { CHAT_TIMEOUT_MS, chatTools, type ChatMessage } from "@/lib/llm/chat-tools";
import { MODELS } from "@/lib/llm/client";
import type { DeferredCall } from "./apply";
import type { AgentEvent } from "./events";
import {
  isDeferred,
  runTool,
  toFunctionSpec,
  toToolMessage,
  type Tool,
} from "./tool-registry";
import { toolsFor } from "./tools";
import { formatShortDate } from "@/lib/telegram/format";

/**
 * Цикл «модель ↔ инструменты».
 *
 * Генератор, а не функция с колбэком: события нужны браузеру по мере
 * появления, а `for await` в роуте читается лучше, чем подписка.
 *
 * Главное свойство — перехват. Инструменты с `impact: "irreversible"` модель
 * видит и вызывает как обычно, но цикл их не исполняет: аргументы уходят
 * пользователю предложением. Запрет живёт здесь, а не в промпте, потому что
 * промпт — это текст, а текст модель вправе проигнорировать.
 */

export type RunAgentOptions = {
  message: string;
  history?: ChatMessage[];
  environmentId: string;
  today?: string;
  tools?: Tool[];
  chat?: typeof chatTools;
  maxSteps?: number;
  /** Свой системный промпт вместо промпта доски (захват из телеграма). */
  systemPrompt?: string;
  /** Откладывать любой мутирующий вызов, а не только необратимые. */
  deferAll?: boolean;
  /**
   * Момент (мс эпохи), к которому цикл обязан закончить. Новый шаг не
   * начинается, если до него осталось меньше MIN_STEP_MS, а ответа модели
   * ждём не дольше остатка. Нужен боту: функцию на платформе убивают молча,
   * и вместо черновика пользователь видел бы вечное «Разбираю…». Не задан —
   * цикл ограничен только числом шагов, как на сайте.
   */
  deadlineAt?: number;
  /**
   * Задачи, уже известные модели без инструментов (снимок доски в промпте
   * бота), — ими подписываются отложенные правки, как задачами из get_board.
   */
  knownTasks?: { id: string; title: string; description?: string | null; subtasks?: unknown }[];
  /**
   * Шаг, все вызовы которого отложены, — последний: предложение уходит сразу,
   * а текстом становится текст этого же шага (может быть пустым). Без этого
   * цикл спрашивал модель ещё раз ради заключительной фразы — лишний круг в
   * несколько секунд. Только для захвата из бота: сайту нужен ответ модели.
   */
  stopAfterDeferred?: boolean;
};

/** Меньше этого до дедлайна новый шаг не начинаем: модель не успеет ответить. */
export const MIN_STEP_MS = 15_000;

/** Заголовок изменяемого поля — для карточки предложения, когда id задачи не резолвится в название. */
const FIELD_LABELS: Record<string, string> = {
  title: "название",
  description: "описание",
  categoryId: "эпик",
  priority: "приоритет",
  plannedDate: "срок",
  dueDate: "срок",
};

/** Сколько знаков нового текста показывать в подписи правки. */
const PREVIEW_LIMIT = 60;

function preview(value: string): string {
  const flat = value.replace(/\s+/g, " ").trim();
  const chars = Array.from(flat);
  return chars.length <= PREVIEW_LIMIT ? flat : chars.slice(0, PREVIEW_LIMIT - 1).join("") + "…";
}

/** «2026-10-30» → «30.10» (в другом году — с годом); не дата — как есть. */
function shortDate(value: string, today: Date): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? formatShortDate(value, today) : value;
}

/**
 * Что меняет правка — с новым значением там, где его видно коротко: подпись
 * «Изменить «X»: описание» не говорит, что именно запишется. Описание,
 * дописанное к прежнему, показывается добавленным хвостом.
 */
function changedFields(
  args: Record<string, unknown>,
  context: { previousDescription?: string; today: Date }
): string[] {
  return Object.keys(args)
    .filter((key) => key !== "id" && args[key] !== undefined)
    .map((key) => {
      const name = FIELD_LABELS[key] ?? key;
      const value = args[key];

      if (key === "title" && typeof value === "string" && value.trim()) {
        return `${name} → «${preview(value)}»`;
      }
      if (key === "description") {
        if (value === null || value === "") return `${name} очищается`;
        if (typeof value !== "string") return name;
        const before = context.previousDescription?.trim();
        if (before && value.startsWith(before) && value.trim() !== before) {
          return `${name} + «${preview(value.slice(before.length))}»`;
        }
        return `${name} → «${preview(value)}»`;
      }
      if (key === "plannedDate" || key === "dueDate") {
        if (value === null) return `${name} снят`;
        if (typeof value === "string") return `${name} → ${shortDate(value, context.today)}`;
      }
      return name;
    });
}

/** Задачи из ответа read-инструмента (get_board отдаёт снимок, list_tasks — голый массив). */
function extractTasks(data: unknown): { id: string; title: string; description?: unknown }[] {
  const list = Array.isArray(data)
    ? data
    : Array.isArray((data as { tasks?: unknown })?.tasks)
      ? (data as { tasks: unknown[] }).tasks
      : [];

  return list.filter(
    (item): item is { id: string; title: string } =>
      !!item &&
      typeof item === "object" &&
      typeof (item as { id?: unknown }).id === "string" &&
      typeof (item as { title?: unknown }).title === "string"
  );
}

/** Подзадачи, вложенные в прочитанные задачи (get_board и list_tasks кладут их в `subtasks`). */
function extractSubtasks(tasks: object[]): { id: string; title: string }[] {
  return tasks.flatMap((task) => {
    const subtasks = (task as { subtasks?: unknown }).subtasks;
    return Array.isArray(subtasks) ? extractTasks(subtasks) : [];
  });
}

/**
 * Человеческое описание отложенного вызова для карточки предложения.
 * Заголовок задачи резолвится из уже прочитанных инструментом задач — id
 * пользователю ничего не говорит, три удаления по id выглядят одинаково.
 */
function describeDeferred(
  toolName: string,
  args: unknown,
  known: {
    taskTitles: Map<string, string>;
    subtaskTitles: Map<string, string>;
    taskDescriptions: Map<string, string>;
    today: Date;
  }
): string | undefined {
  const { taskTitles, subtaskTitles, taskDescriptions, today } = known;
  const record = (args && typeof args === "object" ? args : {}) as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id : undefined;

  const quoted = (key: string, fallback: string) =>
    typeof record[key] === "string" && record[key] ? (record[key] as string) : fallback;

  if (toolName === "create_task" || toolName === "create_epic_task") {
    const base =
      toolName === "create_task"
        ? `Задача «${quoted("title", "без названия")}»`
        : `Задача «${quoted("title", "без названия")}» в эпике «${quoted("epicName", "без названия")}»`;
    const due =
      typeof record.plannedDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(record.plannedDate)
        ? ` · срок ${formatShortDate(record.plannedDate, today)}`
        : "";
    const count = Array.isArray(record.subtasks) ? record.subtasks.length : 0;
    const subs = count > 0 ? ` · ${count} ${plural(count, "подзадача", "подзадачи", "подзадач")}` : "";
    return `${base}${due}${subs}`;
  }

  if (toolName === "create_epic") return `Эпик «${quoted("name", "без названия")}»`;
  if (toolName === "create_note") return `Заметка «${quoted("path", "без названия")}»`;
  if (toolName === "append_note") return `Дописать в «${quoted("path", "без названия")}»`;

  if (toolName === "move_task") {
    const title = typeof record.taskId === "string" ? taskTitles.get(record.taskId) : undefined;
    return `Перенести «${title ?? record.taskId ?? "задачу"}»`;
  }

  if (toolName === "complete_subtask") {
    const title = id ? subtaskTitles.get(id) : undefined;
    return `Отметить подзадачу «${title ?? id ?? "(id неизвестен)"}»`;
  }

  if (toolName === "create_subtask") {
    const taskTitle = typeof record.taskId === "string" ? taskTitles.get(record.taskId) : undefined;
    const title = typeof record.title === "string" ? record.title : "без названия";
    const due = typeof record.dueDate === "string" ? ` · срок ${shortDate(record.dueDate, today)}` : "";
    return `Добавить подзадачу «${title}»${taskTitle ? ` в «${taskTitle}»` : ""}${due}`;
  }

  if (toolName === "delete_subtask" || toolName === "update_subtask") {
    const title = id ? subtaskTitles.get(id) : undefined;
    const name = title ? `подзадачу «${title}»` : `подзадачу ${id ?? "(id неизвестен)"}`;
    if (toolName === "delete_subtask") return `Удалить ${name}`;
    const fields = changedFields(record, { today });
    return `Изменить ${name}${fields.length > 0 ? `: ${fields.join(", ")}` : ""}`;
  }

  if (toolName !== "delete_task" && toolName !== "update_task") return undefined;

  const title = id ? taskTitles.get(id) : undefined;

  if (toolName === "delete_task") {
    return title ? `Удалить «${title}»` : `Удалить задачу ${id ?? "(id неизвестен)"}`;
  }

  const fields = changedFields(record, {
    previousDescription: id ? taskDescriptions.get(id) : undefined,
    today,
  });
  const fieldsPart = fields.length > 0 ? `: ${fields.join(", ")}` : "";
  return title ? `Изменить «${title}»${fieldsPart}` : `Изменить задачу ${id ?? "(id неизвестен)"}${fieldsPart}`;
}

export async function* runAgent(options: RunAgentOptions): AsyncGenerator<AgentEvent> {
  const tools = options.tools ?? toolsFor({ surface: "chat" });
  const chat = options.chat ?? chatTools;
  const maxSteps = options.maxSteps ?? 6;
  const today = options.today ?? new Date().toISOString().slice(0, 10);
  const specs = tools.map(toFunctionSpec);

  const messages: ChatMessage[] = [
    {
      role: "system",
      content:
        options.systemPrompt ??
        buildAgentPrompt({ today, environmentId: options.environmentId }),
    },
    ...(options.history ?? []),
    { role: "user", content: options.message },
  ];

  const deferred: DeferredCall[] = [];
  // Заголовки задач и подзадач из уже прочитанных инструментов get_board/list_tasks —
  // ими подписываются отложенные правки и удаления в карточке предложения.
  const taskTitles = new Map<string, string>();
  const subtaskTitles = new Map<string, string>();
  // Прежние описания — чтобы подпись дописанного описания показала только добавленное.
  const taskDescriptions = new Map<string, string>();
  const todayDate = new Date(`${today}T00:00:00Z`);

  /** Запоминает заголовки и описания прочитанных задач — для подписей предложений. */
  const remember = (data: unknown) => {
    const tasks = extractTasks(data);
    for (const task of tasks) {
      taskTitles.set(task.id, task.title);
      if (typeof task.description === "string") taskDescriptions.set(task.id, task.description);
    }
    for (const sub of extractSubtasks(tasks)) subtaskTitles.set(sub.id, sub.title);
  };
  if (options.knownTasks) remember(options.knownTasks);

  try {
    yield { type: "thinking" };

    let outOfTime = false;
    for (let step = 0; step < maxSteps; step++) {
      const left = options.deadlineAt === undefined ? undefined : options.deadlineAt - Date.now();
      if (left !== undefined && left < MIN_STEP_MS) {
        outOfTime = true;
        break;
      }

      const reply = await chat({
        messages,
        model: MODELS.agent,
        tools: specs,
        ...(left !== undefined ? { timeoutMs: Math.min(CHAT_TIMEOUT_MS, left) } : {}),
      });

      if (reply.toolCalls.length === 0) {
        if (reply.content.trim()) yield { type: "text", text: reply.content.trim() };
        if (deferred.length > 0) {
          yield { type: "proposal", id: `p${step}`, calls: deferred };
        }
        return;
      }

      messages.push({ role: "assistant", content: reply.content, tool_calls: reply.raw });

      // Модели нужно увидеть результат хотя бы одного вызова — шаг не последний.
      let needsReply = false;

      for (const call of reply.toolCalls) {
        const tool = tools.find((t) => t.name === call.tool);

        if (!tool) {
          needsReply = true;
          yield { type: "tool_start", id: call.id, tool: call.tool, args: call.args };
          yield { type: "tool_end", id: call.id, tool: call.tool, error: "Неизвестный инструмент" };
          messages.push(toToolMessage(call.id, { ok: false, error: "Неизвестный инструмент" }));
          continue;
        }

        if (isDeferred(tool) || (options.deferAll && tool.mutation)) {
          const label = describeDeferred(call.tool, call.args, {
            taskTitles,
            subtaskTitles,
            taskDescriptions,
            today: Number.isNaN(todayDate.getTime()) ? new Date() : todayDate,
          });
          deferred.push({ tool: call.tool, args: call.args, ...(label ? { label } : {}) });
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: JSON.stringify({
              ok: true,
              deferred: true,
              note: "Отложено: пользователь подтвердит вручную. Повторять вызов не нужно.",
            }),
          });
          continue;
        }

        needsReply = true;
        yield { type: "tool_start", id: call.id, tool: call.tool, args: call.args };

        const outcome = await runTool(tool, call.args);

        yield outcome.ok
          ? { type: "tool_end", id: call.id, tool: call.tool, result: summarizeResult(outcome.data) }
          : { type: "tool_end", id: call.id, tool: call.tool, error: outcome.error };

        if (outcome.ok) {
          remember(outcome.data);

          // move_task меняет доску, а сервисы реестра про Next.js не знают —
          // без этого события клиент не узнает, что доску надо перерисовать.
          if (tool.mutation) yield { type: "board_changed" };
        }

        messages.push(toToolMessage(call.id, outcome));
      }

      if (options.stopAfterDeferred && !needsReply && deferred.length > 0) {
        if (reply.content.trim()) yield { type: "text", text: reply.content.trim() };
        yield { type: "proposal", id: `p${step}`, calls: deferred };
        return;
      }
    }

    if (deferred.length > 0) {
      yield { type: "proposal", id: "p-timeout", calls: deferred };
    }
    yield {
      type: "error",
      message: outOfTime ? "Агент не уложился в отведённое время" : "Агент не уложился в отведённые шаги",
    };
  } catch (error) {
    yield {
      type: "error",
      message: error instanceof Error ? error.message : "Модель недоступна",
    };
  }
}

/** Короткая сводка ответа инструмента — она идёт в строку следа, а не в модель. */
export function summarizeResult(data: unknown): string {
  if (Array.isArray(data)) return `${data.length} ${plural(data.length, "элемент", "элемента", "элементов")}`;

  if (data && typeof data === "object") {
    const tasks = (data as { tasks?: unknown }).tasks;
    const columns = (data as { columns?: unknown }).columns;

    if (Array.isArray(tasks) && Array.isArray(columns)) {
      return `${tasks.length} ${plural(tasks.length, "задача", "задачи", "задач")} в ${columns.length} ${plural(columns.length, "колонке", "колонках", "колонках")}`;
    }
    if (Array.isArray(tasks)) {
      return `${tasks.length} ${plural(tasks.length, "задача", "задачи", "задач")}`;
    }
  }

  return JSON.stringify(data ?? null).slice(0, 80);
}

function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}
