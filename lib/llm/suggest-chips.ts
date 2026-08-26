import { chatJson, MODELS, type LlmProvider } from "@/lib/llm/client";

/**
 * Подсказки-чипсы под полем ввода ленты агента.
 *
 * Не путать с `capture.ts`/`parse-tasks.ts`: там модель разбирает текст
 * пользователя, здесь — придумывает три коротких примера того, что можно
 * сказать агенту, глядя на текущую доску. Вызывается редко (по первому
 * фокусу в поле, пока доска не менялась — см. `lib/actions/agent.ts`), поэтому
 * может позволить себе агентскую модель, а не дешёвую `smartInput`.
 *
 * Доске отдаём не снимок целиком, а сжатую выжимку (`buildBoardDigest`):
 * на доске из пары десятков задач JSON снимка — это заметный кусок контекста
 * ради трёх строк на выходе.
 */

/* ── выжимка доски ───────────────────────────────────────────────────────── */

export type DigestColumn = { id: string; title: string; position: number };
export type DigestCategory = { id: string; name: string };
export type DigestTask = {
  title: string;
  columnId: string;
  plannedDate?: string | null;
  completedAt?: Date | string | null;
};

/** Часть снимка доски (`BoardSnapshot` из `lib/agent/board.ts`), нужная выжимке. */
export type BoardDigestInput = {
  columns: DigestColumn[];
  categories: DigestCategory[];
  tasks: DigestTask[];
};

export type BoardDigestLimits = {
  /** Сколько просроченных задач перечислять поимённо — остальные только считаются. */
  overdueTasks: number;
  /** Сколько задач с ближайшим сроком перечислять поимённо. */
  upcomingTasks: number;
  /** Горизонт «ближайших дней»: сколько суток вперёд от сегодня считать сроком «скоро». */
  upcomingWindowDays: number;
  /** Сколько имён эпиков перечислять — остальные схлопываются в «+N ещё». */
  epicNames: number;
  /** Сколько задач «в работе» (средние колонки доски) перечислять поимённо. */
  inProgressTasks: number;
};

export const DEFAULT_DIGEST_LIMITS: BoardDigestLimits = {
  overdueTasks: 5,
  upcomingTasks: 5,
  upcomingWindowDays: 7,
  epicNames: 10,
  inProgressTasks: 5,
};

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Сегодня + `days` суток, в тех же ГГГГ-ММ-ДД. Считаем по UTC-полудню — без сдвига дня от часового пояса. */
function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return toIsoDate(date);
}

function isOpen(task: DigestTask): boolean {
  return task.completedAt == null;
}

function byPlannedDateAsc(a: DigestTask, b: DigestTask): number {
  return (a.plannedDate ?? "") < (b.plannedDate ?? "") ? -1 : 1;
}

/**
 * Список поимённо (до `limit`) + строка «ещё N», если что-то не влезло.
 * `describe` — как записать одну задачу строкой.
 */
function listLines(tasks: DigestTask[], limit: number, describe: (t: DigestTask) => string): string[] {
  if (tasks.length === 0) return ["- нет"];
  const lines = tasks.slice(0, limit).map((t) => `- ${describe(t)}`);
  const rest = tasks.length - limit;
  if (rest > 0) lines.push(`- ещё ${rest}`);
  return lines;
}

/**
 * Доска в виде короткой текстовой выжимки для промпта: сколько задач в каких
 * колонках, что просрочено, что запланировано на ближайшие дни, какие есть
 * эпики, что лежит «в работе». «В работе» — задачи в средних колонках доски
 * (не первая, не последняя), тем же способом, что и на странице «План на день»
 * (`lib/services/today.ts`).
 */
export function buildBoardDigest(
  board: BoardDigestInput,
  options: { today?: Date; limits?: BoardDigestLimits } = {}
): string {
  const limits = options.limits ?? DEFAULT_DIGEST_LIMITS;
  const today = toIsoDate(options.today ?? new Date());
  const horizon = addDays(today, limits.upcomingWindowDays);

  const columns = [...board.columns].sort((a, b) => a.position - b.position);
  const columnTitleById = new Map(columns.map((c) => [c.id, c.title]));
  const middleColumnIds = new Set(columns.slice(1, -1).map((c) => c.id));

  const open = board.tasks.filter(isOpen);
  const overdue = open
    .filter((t) => t.plannedDate != null && t.plannedDate < today)
    .sort(byPlannedDateAsc);
  const upcoming = open
    .filter((t) => t.plannedDate != null && t.plannedDate >= today && t.plannedDate <= horizon)
    .sort(byPlannedDateAsc);
  const inProgress = open.filter((t) => middleColumnIds.has(t.columnId));

  const lines: string[] = [];

  lines.push("Колонки:");
  if (columns.length === 0) {
    lines.push("- нет колонок");
  } else {
    for (const col of columns) {
      const count = board.tasks.filter((t) => t.columnId === col.id).length;
      lines.push(`- ${col.title}: ${count}`);
    }
  }

  lines.push("", `Просрочено (${overdue.length}):`);
  lines.push(...listLines(overdue, limits.overdueTasks, (t) => `«${t.title}» — срок был ${t.plannedDate}`));

  lines.push("", `Ближайшие дни, до ${horizon} (${upcoming.length}):`);
  lines.push(...listLines(upcoming, limits.upcomingTasks, (t) => `«${t.title}» — срок ${t.plannedDate}`));

  lines.push("", "Эпики:");
  if (board.categories.length === 0) {
    lines.push("- нет");
  } else {
    const names = board.categories.slice(0, limits.epicNames).map((c) => c.name);
    const rest = board.categories.length - names.length;
    lines.push(`- ${names.join(", ")}${rest > 0 ? ` (+${rest} ещё)` : ""}`);
  }

  lines.push("", `В работе (${inProgress.length}):`);
  lines.push(
    ...listLines(
      inProgress,
      limits.inProgressTasks,
      (t) => `«${t.title}» — ${columnTitleById.get(t.columnId) ?? "?"}`
    )
  );

  return lines.join("\n");
}

/* ── промпт ───────────────────────────────────────────────────────────────── */

export function buildSuggestChipsPrompt(): string {
  return `Ты предлагаешь короткие подсказки под полем ввода ИИ-агента на канбан-доске.

Агент умеет: посмотреть и разобрать доску, разложить задачу на шаги, перенести задачу в другую колонку, переформулировать названия задач, создать новую задачу.

Ниже — выжимка текущей доски. Предложи до трёх подсказок: то, что пользователь мог бы прямо сейчас сказать агенту. Пиши от первого лица — повелительное наклонение или вопрос, как настоящее сообщение в чат, а не описание того, что подсказка делает.

Правила:
- Опирайся только на настоящие задачи, эпики и сроки из выжимки. Не выдумывай названий и дат, которых там нет.
- Не длиннее 45 символов вместе с пробелами. Это жёсткий предел: подсказка стоит в один ряд с двумя другими, длинная туда не влезет и будет отброшена.
- Название задачи не переписывай целиком — бери узнаваемый кусок в кавычки-ёлочки. Не «Составить визуальные требования к отчету по ML», а «визуальные требования».
- Даты пиши по-человечески: «до 2 сентября», «на этой неделе». В выжимке они в машинном формате, в подсказку его не переноси.
- Три подсказки — про разное, не повторяй один и тот же смысл другими словами.
- Если в выжимке предложить нечего (пустая доска) — верни { "suggestions": [] }.

По форме подсказки выглядят так (задачи здесь выдуманы для примера — бери свои, из выжимки):
- Что горит на этой неделе?
- Разбей «интеграцию оплаты» на шаги
- Перенеси «настройку почты» в работу

Верни JSON: { "suggestions": ["...", "...", "..."] }`;
}

/* ── разбор ответа ────────────────────────────────────────────────────────── */

/** Не больше трёх чипсов — под текущую раскладку ленты (см. `components/agent/agent-chat.tsx`). */
const MAX_CHIPS = 3;
/** Чипс — одна строка интерфейса; длиннее — не помещается и обрезается было бы некрасиво, поэтому просто отсеиваем. */
const MAX_CHIP_LENGTH = 56;

function extractSuggestions(parsed: unknown): unknown[] {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === "object") {
    const suggestions = (parsed as Record<string, unknown>).suggestions;
    if (Array.isArray(suggestions)) return suggestions;
  }
  return [];
}

/**
 * Ответ модели → список чипсов. Мусор (битый JSON, не тот тип, пустые
 * строки) отсеивается молча — пустой список означает «покажи статичный
 * откат», а не «сломай ленту».
 */
export function parseSuggestChipsResponse(raw: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }

  const seen = new Set<string>();
  const result: string[] = [];

  for (const item of extractSuggestions(parsed)) {
    if (result.length >= MAX_CHIPS) break;
    if (typeof item !== "string") continue;

    const text = item.trim();
    if (!text || text.length > MAX_CHIP_LENGTH) continue;

    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    result.push(text);
  }

  return result;
}

/* ── вызов модели ─────────────────────────────────────────────────────────── */

export type SuggestChipsOptions = {
  today?: Date;
  limits?: BoardDigestLimits;
  providers?: LlmProvider[];
  fetchFn?: typeof fetch;
};

/**
 * Три подсказки под содержимое доски. Бросает, если модель недоступна —
 * тихий откат к статичным строкам живёт на вызывающей стороне
 * (`suggestChipsAction` в `lib/actions/agent.ts`), не здесь.
 */
export async function suggestChips(
  board: BoardDigestInput,
  options: SuggestChipsOptions = {}
): Promise<string[]> {
  const digest = buildBoardDigest(board, { today: options.today, limits: options.limits });

  const { content } = await chatJson({
    system: buildSuggestChipsPrompt(),
    user: digest,
    models: MODELS.agent,
    providers: options.providers,
    fetchFn: options.fetchFn,
  });

  return parseSuggestChipsResponse(content);
}
