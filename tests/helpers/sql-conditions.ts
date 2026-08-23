/**
 * Извлекает имена колонок, на которые ссылается условие drizzle.
 *
 * Зачем. Тесты сервисов мокают цепочку drizzle, поэтому мок вернёт одни и те же
 * данные независимо от WHERE. Из-за этого проверка «функция вернула то, что
 * подсунул мок» проходит и на сломанной фильтрации. Чтобы тест ловил именно
 * потерю фильтра, нужно смотреть на само условие, переданное в `.where()`.
 *
 *   columnRefs(eq(columns.environmentId, "x"))   → ["environment_id"]
 *   columnRefs(eq(columns.id, columns.id))       → ["id"]
 *
 * Обход намеренно не спускается в `table`: иначе из объекта таблицы вычерпаются
 * все её колонки и условия перестанут различаться.
 */
export function columnRefs(condition: unknown): string[] {
  const found: string[] = [];
  const visited = new Set<unknown>();

  const walk = (value: unknown) => {
    if (!value || typeof value !== "object" || visited.has(value)) return;
    visited.add(value);

    const node = value as Record<string, unknown>;
    if (typeof node.name === "string" && node.table !== undefined) {
      found.push(node.name);
      return;
    }

    for (const key of Object.getOwnPropertyNames(node)) {
      if (key === "table" || key === "_" || key === "decoder") continue;
      try {
        walk(node[key]);
      } catch {
        // геттеры, бросающие на доступ, нам не интересны
      }
    }
  };

  walk(condition);
  return found;
}

/** Ссылается ли условие на колонку с таким именем. */
export function conditionUses(condition: unknown, columnName: string): boolean {
  return columnRefs(condition).includes(columnName);
}
