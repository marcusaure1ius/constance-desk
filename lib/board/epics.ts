export const NO_EPIC = "none";

export type EpicTask = {
  id: string;
  columnId: string;
  categoryId: string | null;
  position: number;
};

export type EpicCategory = { id: string; name: string; color: string | null };

export type Lane = { key: string; category: EpicCategory | null };

/** Ключ дорожки: id категории или NO_EPIC для задач без эпика. */
export function catKey(categoryId: string | null): string {
  return categoryId ?? NO_EPIC;
}

/** droppableId ячейки «колонка × эпик». columnId — uuid без "__", поэтому разделитель безопасен. */
export function makeDroppableId(columnId: string, key: string): string {
  return `${columnId}__${key}`;
}

export function parseDroppableId(droppableId: string): {
  columnId: string;
  catKey: string;
} {
  const idx = droppableId.lastIndexOf("__");
  return {
    columnId: droppableId.slice(0, idx),
    catKey: droppableId.slice(idx + 2),
  };
}

/**
 * Порядок дорожек: категории как есть + «Без эпика» в конце, если такие задачи
 * есть.
 *
 * `tasks` приходят уже после поиска и фильтров доски, поэтому «пустая» дорожка
 * здесь — та, в которой нет ВИДИМЫХ задач: при поиске остаются только эпики с
 * находками. `showEmpty` (настройка доски) возвращает пустые категории обратно;
 * «Без эпика» дорожкой без задач не бывает в любом случае — это не эпик, а место
 * для задач без категории.
 */
export function buildLanes(
  categories: EpicCategory[],
  tasks: { categoryId: string | null }[],
  options: { showEmpty?: boolean } = {}
): Lane[] {
  const lanes: Lane[] = categories
    .filter(
      (c) => options.showEmpty || tasks.some((t) => t.categoryId === c.id)
    )
    .map((c) => ({ key: c.id, category: c }));
  if (tasks.some((t) => t.categoryId == null)) {
    lanes.push({ key: NO_EPIC, category: null });
  }
  return lanes;
}

/** «Сделано» = задача в последней колонке доски. */
export function laneProgress(
  laneTasks: { columnId: string }[],
  lastColumnId: string | undefined
): { done: number; total: number } {
  const total = laneTasks.length;
  const done = lastColumnId
    ? laneTasks.filter((t) => t.columnId === lastColumnId).length
    : 0;
  return { done, total };
}

/**
 * Переводит индекс дропа внутри ячейки «эпик × колонка» в глобальную позицию
 * вставки в целевой колонке (контракт moveTaskAction — индекс среди задач
 * колонки без перетаскиваемой; идентичен виду колонок).
 */
export function cellIndexToColumnPosition(
  allTasks: EpicTask[],
  taskId: string,
  targetColumnId: string,
  targetCatKey: string,
  cellIndex: number
): number {
  const columnTasks = allTasks
    .filter((t) => t.columnId === targetColumnId && t.id !== taskId)
    .sort((a, b) => a.position - b.position);

  const epicTasks = columnTasks.filter(
    (t) => catKey(t.categoryId) === targetCatKey
  );

  const anchor = epicTasks[cellIndex];
  if (!anchor) return columnTasks.length; // дроп в конец дорожки → в конец колонки
  return columnTasks.findIndex((t) => t.id === anchor.id);
}
