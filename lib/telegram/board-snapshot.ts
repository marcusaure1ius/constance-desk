import { getBoardSnapshot, type BoardSnapshot } from "@/lib/agent/board";
import { getEnvironments } from "@/lib/services/environments";

/**
 * Снимок доски для агентов бота — прямо в промпте.
 *
 * Без него каждый захват начинал с шага get_board (5–9 с на круг к модели),
 * и только вторым шагом предлагал вызовы. Снимок собирается теми же
 * `getBoardSnapshot`, что и инструмент, но компактно: строка на задачу, без
 * описаний (только пометка), колонка и эпик названием, а не id. Активная
 * среда — первой.
 */

/** Потолок задач во всех средах: снимок не должен раздувать промпт. */
export const SNAPSHOT_TASK_LIMIT = 150;

export type SnapshotTask = {
  id: string;
  title: string;
  description: string | null;
  subtasks: { id: string; title: string }[];
};

export type PromptBoard = {
  /** Текст снимка для промпта. */
  text: string;
  /** Задачи снимка — ими цикл подписывает отложенные правки в карточке. */
  tasks: SnapshotTask[];
};

/** Все среды, активная первой, — снимок для промпта. Среды нет — null. */
export async function loadPromptBoard(activeEnvironmentId: string): Promise<PromptBoard | null> {
  const environments = await getEnvironments();
  const ordered = [
    ...environments.filter((e) => e.id === activeEnvironmentId),
    ...environments.filter((e) => e.id !== activeEnvironmentId),
  ];
  const boards = (await Promise.all(ordered.map((e) => getBoardSnapshot(e.id)))).filter(
    (board): board is BoardSnapshot => board !== null
  );
  if (boards.length === 0) return null;
  return formatPromptBoard(boards, { activeEnvironmentId });
}

type SnapshotInput = Pick<BoardSnapshot, "environment" | "columns" | "categories"> & {
  tasks: (Pick<
    BoardSnapshot["tasks"][number],
    "id" | "title" | "description" | "columnId" | "categoryId" | "plannedDate" | "completedAt" | "createdAt" | "position"
  > & { subtasks: { id: string; title: string; dueDate: string | null; done: boolean }[] })[];
};

/**
 * Чистая часть: снимки сред → текст. Больше потолка — сначала уходят
 * выполненные, потом самые старые; сколько не показано, снимок говорит сам.
 */
export function formatPromptBoard(
  boards: SnapshotInput[],
  options: { activeEnvironmentId: string; limit?: number }
): PromptBoard {
  const limit = options.limit ?? SNAPSHOT_TASK_LIMIT;

  const all = boards.flatMap((board) => board.tasks);
  const ranked = [...all].sort((a, b) => {
    const doneDiff = Number(a.completedAt !== null) - Number(b.completedAt !== null);
    if (doneDiff !== 0) return doneDiff;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
  const kept = new Set(ranked.slice(0, limit).map((task) => task.id));

  const lines: string[] = [
    "# Доска сейчас (все среды, прочитана перед этим запросом — актуальна; id бери отсюда)",
  ];
  const tasks: SnapshotTask[] = [];

  for (const board of boards) {
    const active = board.environment.id === options.activeEnvironmentId;
    const columnTitle = new Map(board.columns.map((c) => [c.id, c.title]));
    const columnOrder = new Map(board.columns.map((c, i) => [c.id, i]));
    const epicName = new Map(board.categories.map((c) => [c.id, c.name]));

    lines.push(
      "",
      `## Среда «${board.environment.name}» id=${board.environment.id}${active ? " — активная" : ""}`,
      `Колонки: ${
        board.columns.length > 0
          ? board.columns
              .map((c, i) => `${c.id} «${c.title}»${i === 0 ? " (первая)" : ""}`)
              .join(" | ")
          : "нет"
      }`,
      `Эпики: ${
        board.categories.length > 0
          ? board.categories.map((c) => `${c.id} «${c.name}»`).join(" | ")
          : "нет"
      }`
    );

    const shown = board.tasks
      .filter((task) => kept.has(task.id))
      .sort(
        (a, b) =>
          (columnOrder.get(a.columnId) ?? 0) - (columnOrder.get(b.columnId) ?? 0) ||
          a.position - b.position
      );
    const hidden = board.tasks.length - shown.length;

    lines.push(`Задачи (${shown.length}):${shown.length === 0 ? " нет" : ""}`);
    for (const task of shown) {
      const parts = [`- ${task.id} «${task.title}»`, columnTitle.get(task.columnId) ?? "колонка?"];
      const epic = task.categoryId ? epicName.get(task.categoryId) : undefined;
      if (epic) parts.push(`эпик «${epic}»`);
      if (task.plannedDate) parts.push(`срок ${task.plannedDate}`);
      if (task.completedAt) parts.push("выполнена");
      if (task.description?.trim()) parts.push("есть описание");
      if (task.subtasks.length > 0) {
        parts.push(
          `подзадачи: ${task.subtasks
            .map(
              (s) =>
                `${s.id} «${s.title}»${s.dueDate ? ` до ${s.dueDate}` : ""}${s.done ? " ✓" : ""}`
            )
            .join("; ")}`
        );
      }
      lines.push(parts.join(" · "));
      tasks.push({
        id: task.id,
        title: task.title,
        description: task.description,
        subtasks: task.subtasks.map((s) => ({ id: s.id, title: s.title })),
      });
    }
    if (hidden > 0) {
      lines.push(
        `(ещё ${hidden} не показано: выполненные и самые старые — при нужде list_tasks этой среды)`
      );
    }
  }

  return { text: lines.join("\n"), tasks };
}
