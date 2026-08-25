import { chatJson, MODELS, type LlmProvider } from "@/lib/llm/client";

/**
 * Захват: сообщение из телеграма → список типизированных элементов.
 *
 * Три решения, которые здесь важнее кода.
 *
 * 1. Формулировка автора не переписывается. «физюрики», «итмо», «вэду», «mcp» —
 *    это его рабочие слова, а не опечатки. На gpt-oss-20b замерено, как модель
 *    «улучшила» русскую задачу до «Fix login bug»: для пользователя это потеря
 *    данных, а не помощь. Промпт запрещает перевод прямо, а `guardTranslation`
 *    ловит случаи, когда модель запрет проигнорировала.
 *
 * 2. Делит на элементы модель, а не регулярка. «Сходить к суровцеву, заполнить
 *    итмо, ответить по вэду» — три задачи, а «Показать какие есть данные в
 *    датасете, в голограмме, во внешних данных» — одна: запятые в обоих
 *    случаях, разница в числе действий. Механическая резка ошибётся всегда.
 *
 * 3. Один вызов возвращает СПИСОК разнотипных элементов. Реальное сообщение
 *    смешанное: «написать комментарии по стратегии» — задача, а следующая фраза
 *    того же сообщения — мысль. Возврат одного типа заставил бы выбирать.
 */

export type CaptureKind = "task" | "note" | "read" | "question" | "raw";
export type CapturePriority = "urgent" | "high" | "normal";

export type CapturedItem = {
  kind: CaptureKind;
  /** Формулировка автора: заголовок задачи или текст элемента. */
  text: string;
  priority?: CapturePriority;
  /** Срок задачи, ГГГГ-ММ-ДД. Отдельного поля под срок в схеме нет — это plannedDate. */
  plannedDate?: string;
  /** Имя эпика ИЗ доски. Выдуманные имена отсеиваются при разборе ответа. */
  epic?: string;
  /**
   * Только для question: сообщение написано прошедшим временем («ответил по
   * вэду»), то есть речь о деле, которое уже сделано. Бот всё равно ничего не
   * закрывает сам — он показывает найденное с кнопкой.
   */
  done?: boolean;
};

/** Контекст доски для промпта: только имена, без идентификаторов. */
export type CaptureBoard = {
  environmentName: string;
  environmentNames: string[];
  columnTitles: string[];
  epicNames: string[];
};

const KINDS: readonly CaptureKind[] = ["task", "note", "read", "question", "raw"];
const PRIORITIES: readonly CapturePriority[] = ["urgent", "high", "normal"];

const WEEKDAYS = [
  "воскресенье",
  "понедельник",
  "вторник",
  "среда",
  "четверг",
  "пятница",
  "суббота",
];

/**
 * Промпт разбора с подставленным контекстом доски.
 *
 * Контекст здесь не для красоты: на живом ключе замерено, что без него модель
 * придумывает несуществующие колонки и эпики («In Progress», «Login issues»),
 * а с ним отвечает вдвое быстрее и вдвое дешевле по токенам.
 */
export function buildCapturePrompt(board: CaptureBoard, today: Date): string {
  const iso = toIsoDate(today);
  const weekday = WEEKDAYS[today.getUTCDay()];

  return `Ты разбираешь входящие сообщения владельца канбан-доски. Сообщения телеграфные: обрывок на бегу, надиктованная мысль, список дел через запятую.

Верни JSON вида { "items": [ ... ] } — список элементов. В одном сообщении их может быть несколько и разных типов.

Поля элемента:
- kind — тип элемента:
  - "task" — дело, которое сделает автор (есть действие)
  - "note" — мысль, тема, наблюдение; действия нет
  - "read" — чужой материал: ссылка, пост, видео
  - "question" — вопрос к доске, поиск по ней и рассказ о СДЕЛАННОМ деле
  - "raw" — непонятно, к чему это
- text — формулировка элемента
- source — дословный кусок исходного сообщения, из которого взят элемент
- priority — только для task: "urgent" | "high" | "normal"
- plannedDate — только для task: срок в формате ГГГГ-ММ-ДД
- epic — только для task: имя эпика ИЗ СПИСКА НИЖЕ, если задача явно про него
- done — только для question: true, если автор пишет о деле в ПРОШЕДШЕМ времени

ГЛАВНОЕ ПРАВИЛО: text — это слова автора, а не твой пересказ.
- НЕ переводи. Русский текст остаётся русским, английский английским.
- НЕ исправляй жаргон, сокращения и опечатки. «физюрики», «итмо», «вэду», «mcp», «кку» — рабочие слова автора, пиши их ровно так, как он написал.
- НЕ добавляй уточнений, которых в сообщении нет.
- Убери ровно две вещи: «надо»/«нужно» в начале и @упоминания. Больше ничего.
  «Надо написать комментарии по стратегии» → «написать комментарии по стратегии»
- Адрес почты — НЕ упоминание. «Отправить отчёт на pochta@vshe.ru» остаётся целиком.

ПРОШЕДШЕЕ ВРЕМЯ — НЕ НОВАЯ ЗАДАЧА.
- «ответил по вэду», «сделал итмо», «отправил слайды» — дело уже сделано, заводить его на доску нельзя: получится мусорная задача, которую тут же надо закрывать.
- Такое сообщение — это { "kind": "question", "done": true, "text": <ключевые слова для поиска> }.
- То же для явного поиска: «найди задачи по вэду», «что там с итмо» → { "kind": "question", "text": "вэду" }.
- text у question — КОРОТКИЙ поисковый запрос: одно-два слова, по которым задачу можно найти подстрокой. Без «найди», «что там с», без глагола. «ответил по вэду» → "вэду". «что там с итмо» → "итмо".

ДЕЛЕНИЕ НА ЭЛЕМЕНТЫ — по числу действий, а не по запятым.
- «Сходить к суровцеву, заполнить итмо, ответить по вэду» → ТРИ задачи: три разных действия.
- «Показать какие есть данные в датасете, в голограмме, во внешних данных» → ОДНА задача: действие одно («показать»), перечисление — его дополнения.

СРОК. Сегодня ${iso}, ${weekday}.
- «до 25.08» → ближайшее будущее 25 августа в формате ГГГГ-ММ-ДД
- «до пятницы» → дата ближайшей пятницы
- «завтра» → следующий день
- Срока в тексте нет — поля нет. Не выдумывай.

ПРИОРИТЕТ. "urgent" — «срочно», «горит», «блокер», «asap». "high" — «важно», «в первую очередь». Иначе "normal".

ДОСКА. Существуют только эти имена, других не придумывай:
- Активный проект: ${board.environmentName}
- Все проекты: ${listOrDash(board.environmentNames)}
- Колонки активного проекта (выбирать колонку не нужно, это для понимания устройства): ${listOrDash(board.columnTitles)}
- Эпики активного проекта: ${listOrDash(board.epicNames)}

Если разобрать не получается — верни один элемент { "kind": "raw", "text": <всё сообщение целиком> }.`;
}

type RawItem = Record<string, unknown>;

/**
 * Разбор ответа модели в элементы. Всё, что не проходит проверку, отбрасывается
 * молча: ответ модели — это данные, а не код, и «сломанное поле» здесь норма.
 * Пустой список — сигнал вызывающему, что разобрать не удалось.
 */
export function parseCaptureResponse(
  raw: string,
  context: { board?: CaptureBoard; sourceText: string }
): CapturedItem[] {
  const rawItems = extractItems(raw);
  if (rawItems.length === 0) return [];

  const items: CapturedItem[] = [];

  for (const entry of rawItems) {
    if (!entry || typeof entry !== "object") continue;

    const kind = normalizeKind(entry.kind);
    const source = asText(entry.source);
    // Когда элемент один, исходником считается всё сообщение: модель могла не
    // вернуть source, а проверка на перевод без исходника не работает.
    const origin = source ?? (rawItems.length === 1 ? context.sourceText : undefined);

    const modelText = asText(entry.text) ?? asText(entry.title);
    if (!modelText) continue;

    const text = kind === "task" ? taskTitle(modelText, origin) : modelText;
    if (!text) continue;

    const item: CapturedItem = { kind, text };

    if (kind === "question" && entry.done === true) item.done = true;

    if (kind === "task") {
      const priority = normalizePriority(entry.priority);
      if (priority) item.priority = priority;

      const plannedDate = normalizeDate(entry.plannedDate ?? entry.dueDate);
      if (plannedDate) item.plannedDate = plannedDate;

      const epic = normalizeEpic(entry.epic, context.board);
      if (epic) item.epic = epic;
    }

    items.push(item);
  }

  return items;
}

export type CaptureInput = {
  text: string;
  board: CaptureBoard;
  today?: Date;
  providers?: LlmProvider[];
  fetchFn?: typeof fetch;
};

/** Один вызов модели: сообщение → элементы. Бросает, если модель недоступна. */
export async function captureItems(input: CaptureInput): Promise<CapturedItem[]> {
  const { content } = await chatJson({
    system: buildCapturePrompt(input.board, input.today ?? new Date()),
    user: input.text,
    models: MODELS.capture,
    providers: input.providers,
    fetchFn: input.fetchFn,
  });

  return parseCaptureResponse(content, { board: input.board, sourceText: input.text });
}

/* ── разбор полей ─────────────────────────────────────────────────────────── */

function extractItems(raw: string): RawItem[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }

  // Модель просили вернуть объект, но иногда приходит голый массив.
  if (Array.isArray(parsed)) return parsed as RawItem[];
  if (parsed && typeof parsed === "object") {
    const items = (parsed as RawItem).items;
    if (Array.isArray(items)) return items as RawItem[];
  }
  return [];
}

function asText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** Незнакомый тип — не повод терять текст: он становится raw. */
function normalizeKind(value: unknown): CaptureKind {
  if (typeof value !== "string") return "raw";
  const kind = value.trim().toLowerCase();
  return (KINDS as readonly string[]).includes(kind) ? (kind as CaptureKind) : "raw";
}

function normalizePriority(value: unknown): CapturePriority | undefined {
  if (typeof value !== "string") return undefined;
  const priority = value.trim().toLowerCase();
  return (PRIORITIES as readonly string[]).includes(priority)
    ? (priority as CapturePriority)
    : undefined;
}

/** Дата обязана быть настоящей: «2026-02-31» база отвергнет уже на вставке. */
function normalizeDate(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const date = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return undefined;
  // «2026-02-31» регулярку проходит, но Date нормализует его в 3 марта:
  // расхождение и означает, что такой даты нет.
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return toIsoDate(parsed) === date ? date : undefined;
}

/**
 * Эпик принимается, только если такой на доске есть. Имя приводится к
 * написанию доски: дальше по нему ищется категория, и «техдолг» не должен
 * разъезжаться с «Техдолг».
 */
function normalizeEpic(value: unknown, board: CaptureBoard | undefined): string | undefined {
  const name = asText(value);
  if (!name || !board) return undefined;
  return board.epicNames.find((epic) => epic.toLowerCase() === name.toLowerCase());
}

/* ── защита формулировки ──────────────────────────────────────────────────── */

/**
 * «Надо ...», «Нужно бы ...» в начале — единственные слова, которые снимаются.
 * Границу слова приходится писать через просмотр вперёд: `\b` в JS считает
 * словом только латиницу, и после кириллического «надо» он не срабатывает.
 */
const LEADING_DUTY = /^(?:надо|нужно)(?=\s|$)\s*(?:бы(?=\s|$)\s*)?/iu;
/**
 * @упоминания: в телеграме это латиница, цифры и подчёркивание.
 *
 * Просмотр назад обязателен, иначе под правило попадает почта: в
 * «Отправить отчёт на pochta@vshe.ru» вырезалось «@vshe», и от адреса
 * оставалось «pochta .ru». Упоминание начинается там, где перед «собакой»
 * ничего нет или стоит разделитель; если слева буква, цифра или типичный для
 * адреса символ — это почта, а не обращение к человеку. Дефиса среди этих
 * символов нет намеренно: адреса, у которых он стоит вплотную к «собаке»
 * («ivan-@mail.ru»), не бывает, а «созвон -@ivan_petrov» — обычная запись, и
 * упоминание в ней сниматься обязано.
 *
 * Первая ветка — упоминание перед знаком препинания: она забирает и пробел
 * слева, иначе «Спросить @ivan_petrov, потом» превращалось в «Спросить , потом».
 * Пробел перед «собакой» сам по себе доказывает, что это не почта.
 */
const MENTION = / @[A-Za-z0-9_]{2,}(?=[,.;:!?])|(?<![\p{L}\p{N}._%+])@[A-Za-z0-9_]{2,}/gu;
const LATIN = /[A-Za-z]/;
const CYRILLIC = /[А-Яа-яЁё]/;

/**
 * Поднимает первую букву. Идёт по кодовым точкам, а не по индексу: у эмодзи
 * в начале строки `charAt(0)` вернул бы половину суррогатной пары.
 */
function capitalizeFirst(text: string): string {
  const [first] = text;
  if (!first) return text;
  const upper = first.toLocaleUpperCase("ru");
  return upper === first ? text : upper + text.slice(first.length);
}

export function sanitizeTitle(title: string): string {
  const withoutDuty = title.replace(LEADING_DUTY, "");
  const cleaned = withoutDuty
    // Пустой строкой, а не пробелом: иначе «слайды (@ivan) до среды»
    // превращалось в «слайды ( ) до среды».
    .replace(MENTION, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  // Сообщение целиком состояло из «Надо» или из одного упоминания: пусть лучше
  // останется как было, чем задача без названия.
  if (cleaned.length === 0) return title.trim();

  // «Надо написать комментарии» → «написать комментарии»: сняв служебное
  // начало, мы обнажили строчную букву, и задача выглядит на доске обрывком.
  // Поднимаем ровно в этом случае — если начало не трогали, регистр автора
  // не наше дело.
  return withoutDuty !== title ? capitalizeFirst(cleaned) : cleaned;
}

/**
 * Заголовок задачи: чистка плюс проверка на перевод.
 *
 * Если в исходной фразе латиницы нет, а в заголовке она появилась — модель
 * перевела текст, несмотря на запрет. Тогда берётся исходная фраза: она
 * заведомо на языке автора. Латиница внутри русской фразы («пилот по mcp»)
 * проверку не трогает — там латиница есть с обеих сторон.
 */
function taskTitle(modelText: string, origin: string | undefined): string {
  if (origin && CYRILLIC.test(origin) && !LATIN.test(origin) && LATIN.test(modelText)) {
    return sanitizeTitle(origin);
  }
  return sanitizeTitle(modelText);
}

/* ── мелочи ───────────────────────────────────────────────────────────────── */

function listOrDash(values: string[]): string {
  return values.length > 0 ? values.join(", ") : "—";
}

/** Дата в ГГГГ-ММ-ДД по UTC — так же, как её считает вся остальная доска. */
export function toIsoDate(date: Date): string {
  return date.toISOString().split("T")[0];
}
