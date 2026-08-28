/**
 * Путь заметки — внешний язык для агента и MCP.
 *
 * Внутри всё держится на uuid, но модели удобнее написать
 * «Работа/Цены/Аномалии.md» одним вызовом, чем добывать идентификатор
 * цепочкой list-ов. Здесь только разбор и сборка строки: обращений к базе нет,
 * поэтому модуль целиком проверяется офлайн.
 */

/** Расширение необязательно: модель пишет и «Аномалии», и «Аномалии.md». */
const MARKDOWN_EXTENSION = /\.md$/i;

/** Разобранный путь: папки от корня среды и заголовок заметки. */
export type ParsedNotePath = {
  /** Пустой массив — заметка лежит в корне среды. */
  folders: string[];
  title: string;
};

export class NotePathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotePathError";
  }
}

/**
 * Разбирает сегменты пути папки.
 *
 * Пустые сегменты (двойной слэш, слэш по краям) отбрасываются молча — это
 * опечатка формы, а не смысла. А вот `.` и `..` отбрасывать нельзя: путь
 * «Работа/../Личное» означает совсем не то, что записано, и тихо подставить
 * своё толкование хуже, чем отказаться.
 */
export function parseFolderPath(path: string): string[] {
  const segments = path
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);

  for (const segment of segments) {
    if (segment === "." || segment === "..") {
      throw new NotePathError(
        `Относительные пути не поддерживаются: «${segment}» в «${path}»`
      );
    }
  }

  return segments;
}

/**
 * Разбирает полный путь заметки. Последний сегмент — заголовок, всё перед ним —
 * папки.
 */
export function parseNotePath(path: string): ParsedNotePath {
  const segments = parseFolderPath(path);
  const title = segments.pop()?.replace(MARKDOWN_EXTENSION, "").trim();

  if (!title) throw new NotePathError(`Пустой путь заметки: «${path}»`);

  return { folders: segments, title };
}

/**
 * Проверяет имя папки или заголовок заметки.
 *
 * Слэш — разделитель пути, поэтому имя с ним сделало бы заметку неадресуемой:
 * «Цены/КУ» в корне и «КУ» в папке «Цены» дали бы одну и ту же строку.
 */
export function assertValidSegment(name: string, what: "папки" | "заметки"): string {
  const trimmed = name.trim();
  if (!trimmed) throw new NotePathError(`Пустое имя ${what}`);
  if (trimmed.includes("/")) {
    throw new NotePathError(`Символ «/» в имени ${what} запрещён: «${name}»`);
  }
  return trimmed;
}

/** Собирает путь обратно в строку. Расширение не дописываем — оно не хранится. */
export function formatNotePath(folders: string[], title: string): string {
  return [...folders, title].join("/");
}
