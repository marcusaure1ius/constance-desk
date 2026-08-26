/**
 * ПРОТОТИП. Мок агента: ни модели, ни инструментов, ни записи в базу.
 *
 * Нужен ровно для одного — посмотреть на живой доске, как выглядит разговор с
 * агентом и куда он помещается. Ответы собираются из настоящих задач среды,
 * поэтому демонстрация врёт только в одном месте: думает не модель, а regexp.
 * Файл выкидывается целиком, когда решение по форме принято.
 */

export type MockTask = {
  title: string;
  plannedDate: string | null;
  columnTitle: string;
  priority: "urgent" | "high" | "normal";
};

export type ToolChip = { tool: string; args?: string; result?: string };
export type ProposedTask = { title: string; meta?: string };
export type Rename = { from: string; to: string };

export type AgentBlock =
  | { kind: "tools"; steps: ToolChip[] }
  | { kind: "text"; text: string }
  | { kind: "tasks"; caption: string; items: ProposedTask[]; confirm: string }
  | { kind: "renames"; caption: string; items: Rename[]; confirm: string };

export type ChatMessage =
  | { id: string; role: "user"; text: string }
  | {
      id: string;
      role: "agent";
      blocks: AgentBlock[];
      thinking?: boolean;
      /** Сколько модель думала до первого вызова. Показывается строкой «Думал N с». */
      thoughtMs?: number;
    };

const DATE_RU = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long" });

function formatDate(iso: string): string {
  return DATE_RU.format(new Date(iso));
}

/** Убирает канцелярит начала фразы и приводит к повелительному наклонению. */
export function cleanTitle(raw: string): string {
  let text = raw.replace(/^\s*(нужно|надо|необходимо)\s+/i, "");
  // \b в JS считает границу слова по ASCII, на кириллице он не срабатывает —
  // поэтому хвосты режутся по пробелам и запятым, а не по границам слов.
  text = text.replace(/\s*,\s*(там|а там|и там)\s.*$/i, "");
  text = text.replace(/(^|\s)возможно\s+/i, "$1");
  text = text.trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Черновик описания: агент не выдумывает факты, а раскладывает задачу по трём вопросам. */
export function draftDescription(title: string): string {
  return [
    `Зачем: ${cleanTitle(title).toLowerCase()} — иначе работа встанет на следующем шаге.`,
    "",
    "Что сделать:",
    "— собрать вводные и понять, чего не хватает;",
    "— сделать первую версию и показать заинтересованным;",
    "— учесть правки и зафиксировать результат.",
    "",
    "Готово, когда: результат согласован и лежит там, где его найдут без вопросов.",
  ].join("\n");
}

function overdue(tasks: MockTask[], today: Date): MockTask[] {
  const iso = today.toISOString().slice(0, 10);
  return tasks
    .filter((t) => t.plannedDate && t.plannedDate < iso && t.columnTitle !== "Готово")
    .sort((a, b) => (a.plannedDate! < b.plannedDate! ? -1 : 1));
}

function messyTitles(tasks: MockTask[]): MockTask[] {
  return tasks.filter((t) => cleanTitle(t.title) !== t.title);
}

function splitToTasks(text: string): string[] {
  return text
    .split(/[\n;]|(?<=[.!?])\s+(?=[А-ЯA-Z])/)
    .map((part) => part.trim().replace(/^[-—•*\d.)\s]+/, ""))
    .filter((part) => part.length > 3);
}

function stepsFor(title: string): ProposedTask[] {
  if (/демк|демо/i.test(title)) {
    return [
      { title: "Выбрать 3 сценария для показа", meta: "Бэклог" },
      { title: "Подготовить данные и доступы", meta: "Бэклог" },
      { title: "Собрать сценарий показа на 10 минут", meta: "Бэклог" },
      { title: "Прогнать демо на команде", meta: "Бэклог · до 5 сентября" },
    ];
  }
  return [
    { title: "Уточнить объём и критерий готовности", meta: "Бэклог" },
    { title: "Собрать материалы и вводные", meta: "Бэклог" },
    { title: "Сделать первую версию", meta: "Бэклог" },
    { title: "Показать и собрать правки", meta: "Бэклог" },
  ];
}

/** Задача, на которую ссылается фраза: по кавычкам или по совпадению слов. */
function findTask(input: string, tasks: MockTask[]): MockTask | undefined {
  const quoted = input.match(/[«"']([^»"']+)[»"']/)?.[1];
  const needle = (quoted ?? input).toLowerCase();
  const words = needle.split(/\s+/).filter((w) => w.length > 4);
  // Совпадений может быть несколько — берём задачу, где их больше.
  const scored = tasks
    .map((t) => ({
      task: t,
      hits: words.filter((w) => t.title.toLowerCase().includes(w)).length,
    }))
    .sort((a, b) => b.hits - a.hits);
  return scored[0]?.hits ? scored[0].task : undefined;
}

export function respond(input: string, tasks: MockTask[], today: Date): AgentBlock[] {
  const text = input.toLowerCase();

  if (/горит|срочн|приоритет|что.*делать|просроч|на неделе/.test(text)) {
    const late = overdue(tasks, today);
    const lines = late
      .slice(0, 4)
      .map((t) => `• ${t.title} — срок был ${formatDate(t.plannedDate!)}, лежит в «${t.columnTitle}»`);
    return [
      {
        kind: "tools",
        steps: [
          {
            tool: "get_board",
            args: '{ environmentId: "env_work" }',
            result: `${tasks.length} задач в 3 колонках`,
          },
        ],
      },
      {
        kind: "text",
        text:
          late.length === 0
            ? "Просроченного нет. В «В работе» две задачи — с них и продолжай."
            : `Просрочено ${late.length}. Вот что я бы разгрёб первым:\n${lines.join("\n")}\n\nПервая лежит дольше всех — с неё?`,
      },
    ];
  }

  if (/разбей|разложи|шаги|подзадач|план по/.test(text)) {
    const target = findTask(input, tasks);
    const title = target?.title ?? "задачу";
    return [
      {
        kind: "tools",
        steps: [
          {
            tool: "get_board",
            args: '{ environmentId: "env_work" }',
            result: `${tasks.length} задач в 3 колонках`,
          },
        ],
      },
      { kind: "text", text: `«${title}» — большая. Разложил бы так:` },
      {
        kind: "tasks",
        caption: "Эпик «Демо ИИ-инструментов» · 4 задачи",
        items: stepsFor(title),
        confirm: "Создать 4 задачи",
      },
    ];
  }

  if (/почисти|переформулируй|нейминг|названия|формулировк/.test(text)) {
    const messy = messyTitles(tasks).slice(0, 4);
    return [
      {
        kind: "tools",
        steps: [
          {
            tool: "list_tasks",
            args: '{ environmentId: "env_work", includeArchived: false }',
            result: `${tasks.length} задач`,
          },
        ],
      },
      {
        kind: "text",
        text: `Нашёл ${messy.length} названия, где начало съедает смысл. Предлагаю так:`,
      },
      {
        kind: "renames",
        caption: "Смысл не меняю, только формулировку",
        items: messy.map((t) => ({ from: t.title, to: cleanTitle(t.title) })),
        confirm: `Переименовать ${messy.length}`,
      },
    ];
  }

  if (/перенеси|переложи|в работу|закрой|сделал|готово/.test(text)) {
    const target = findTask(input, tasks);
    return [
      {
        kind: "tools",
        steps: [
          {
            tool: "get_board",
            args: '{ environmentId: "env_work" }',
            result: `${tasks.length} задач в 3 колонках`,
          },
          {
            tool: "move_task",
            args: '{ taskId: "…", targetColumnId: "col_progress", targetPosition: 0 }',
            result: target ? "перенесена" : "не найдена",
          },
        ],
      },
      {
        kind: "text",
        text: target
          ? `Перенёс «${target.title}» в «В работе».`
          : "Не нашёл такую задачу. Назови точнее или покажи на доске.",
      },
    ];
  }

  const items = splitToTasks(input);
  return [
    { kind: "text", text: items.length > 1 ? "Понял так:" : "Понял, задача одна:" },
    {
      kind: "tasks",
      caption: "Первая колонка · «Бэклог»",
      items: items.map((title) => ({ title: cleanTitle(title), meta: "Бэклог" })),
      confirm: `Создать ${items.length === 1 ? "задачу" : `${items.length} задачи`}`,
    },
  ];
}

export const SUGGESTIONS = [
  "Что у меня горит?",
  "Разбей «сделать демку» на шаги",
  "Почисти формулировки в бэклоге",
];
