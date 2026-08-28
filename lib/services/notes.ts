import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { noteFolders, notes } from "@/lib/db/schema";
import {
  assertValidSegment,
  formatNotePath,
  parseFolderPath,
  parseNotePath,
} from "@/lib/notes/path";

export type NoteFolder = typeof noteFolders.$inferSelect;
export type Note = typeof notes.$inferSelect;

/** Строка списка: текст заметки в дереве не нужен и может быть большим. */
export type NoteSummary = Omit<Note, "text">;

/** Доменная ошибка заметок: «папки нет», «такая заметка уже есть». */
export class NotesError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotesError";
  }
}

/** Папки и заметки среды плоскими списками — дерево собирается выше. */
export async function getNotesTree(environmentId: string): Promise<{
  folders: NoteFolder[];
  notes: NoteSummary[];
}> {
  const [folderRows, noteRows] = await Promise.all([
    db
      .select()
      .from(noteFolders)
      .where(eq(noteFolders.environmentId, environmentId))
      .orderBy(asc(noteFolders.name)),
    db
      .select({
        id: notes.id,
        title: notes.title,
        folderId: notes.folderId,
        environmentId: notes.environmentId,
        createdAt: notes.createdAt,
        updatedAt: notes.updatedAt,
      })
      .from(notes)
      .where(eq(notes.environmentId, environmentId))
      .orderBy(asc(notes.title)),
  ]);

  return { folders: folderRows, notes: noteRows };
}

export async function getNote(id: string): Promise<Note | undefined> {
  const [note] = await db.select().from(notes).where(eq(notes.id, id));
  return note;
}

/* ------------------------------ Папки ------------------------------ */

/**
 * Ищет папку среди детей `parentId`. Корень — это `parentId = null`, и
 * сравнивать его через `eq` нельзя: в SQL `null = null` не истина, а null.
 */
async function findChildFolder(
  environmentId: string,
  parentId: string | null,
  name: string
): Promise<NoteFolder | undefined> {
  const [folder] = await db
    .select()
    .from(noteFolders)
    .where(
      and(
        eq(noteFolders.environmentId, environmentId),
        parentId === null
          ? isNull(noteFolders.parentId)
          : eq(noteFolders.parentId, parentId),
        eq(noteFolders.name, name)
      )
    );
  return folder;
}

export async function createFolder(input: {
  environmentId: string;
  name: string;
  parentId?: string | null;
}): Promise<NoteFolder> {
  const name = assertValidSegment(input.name, "папки");
  const parentId = input.parentId ?? null;

  if (parentId !== null) await assertFolderInEnvironment(parentId, input.environmentId);

  const existing = await findChildFolder(input.environmentId, parentId, name);
  if (existing) throw new NotesError(`Папка «${name}» здесь уже есть`);

  const [folder] = await db
    .insert(noteFolders)
    .values({ name, parentId, environmentId: input.environmentId })
    .returning();
  return folder;
}

export async function renameFolder(id: string, name: string): Promise<NoteFolder> {
  const trimmed = assertValidSegment(name, "папки");
  const folder = await getFolder(id);
  if (!folder) throw new NotesError("Папка не найдена");

  const existing = await findChildFolder(folder.environmentId, folder.parentId, trimmed);
  if (existing && existing.id !== id) throw new NotesError(`Папка «${trimmed}» здесь уже есть`);

  const [updated] = await db
    .update(noteFolders)
    .set({ name: trimmed, updatedAt: new Date() })
    .where(eq(noteFolders.id, id))
    .returning();
  return updated;
}

/**
 * Переносит папку. Отдельная проверка на цикл обязательна: составной внешний
 * ключ стережёт среду, но папку, положенную внутрь собственного потомка, база
 * примет — получится кольцо, невидимое из дерева и неудаляемое каскадом.
 */
export async function moveFolder(id: string, parentId: string | null): Promise<NoteFolder> {
  const folder = await getFolder(id);
  if (!folder) throw new NotesError("Папка не найдена");

  if (parentId !== null) {
    if (parentId === id) throw new NotesError("Папку нельзя вложить в саму себя");
    await assertFolderInEnvironment(parentId, folder.environmentId);
    const chain = await folderChainIds(parentId);
    if (chain.includes(id)) {
      throw new NotesError("Папку нельзя вложить в собственную подпапку");
    }
  }

  const existing = await findChildFolder(folder.environmentId, parentId, folder.name);
  if (existing && existing.id !== id) {
    throw new NotesError(`Папка «${folder.name}» в этом месте уже есть`);
  }

  const [updated] = await db
    .update(noteFolders)
    .set({ parentId, updatedAt: new Date() })
    .where(eq(noteFolders.id, id))
    .returning();
  return updated;
}

/** Удаление каскадное: подпапки и заметки внутри уходят вместе с папкой. */
export async function deleteFolder(id: string): Promise<void> {
  await db.delete(noteFolders).where(eq(noteFolders.id, id));
}

export async function getFolder(id: string): Promise<NoteFolder | undefined> {
  const [folder] = await db.select().from(noteFolders).where(eq(noteFolders.id, id));
  return folder;
}

async function assertFolderInEnvironment(
  folderId: string,
  environmentId: string
): Promise<NoteFolder> {
  const folder = await getFolder(folderId);
  if (!folder) throw new NotesError("Папка не найдена");
  if (folder.environmentId !== environmentId) {
    throw new NotesError("Папка принадлежит другому проекту");
  }
  return folder;
}

/**
 * Идентификаторы папки и всех её предков, снизу вверх.
 *
 * Подъём циклом, а не рекурсивным CTE: дерево папок мелкое, а сырой SQL здесь
 * стоил бы привязки к драйверу ради экономии двух-трёх запросов.
 */
async function folderChainIds(folderId: string): Promise<string[]> {
  const chain: string[] = [];
  let current: string | null = folderId;

  while (current && !chain.includes(current)) {
    chain.push(current);
    const folder: NoteFolder | undefined = await getFolder(current);
    if (!folder) break;
    current = folder.parentId;
  }

  return chain;
}

/* ----------------------------- Заметки ----------------------------- */

async function findNoteInFolder(
  environmentId: string,
  folderId: string | null,
  title: string
): Promise<Note | undefined> {
  const [note] = await db
    .select()
    .from(notes)
    .where(
      and(
        eq(notes.environmentId, environmentId),
        folderId === null ? isNull(notes.folderId) : eq(notes.folderId, folderId),
        eq(notes.title, title)
      )
    );
  return note;
}

export async function createNote(input: {
  environmentId: string;
  title: string;
  folderId?: string | null;
  text?: string;
}): Promise<Note> {
  const title = assertValidSegment(input.title, "заметки");
  const folderId = input.folderId ?? null;

  if (folderId !== null) await assertFolderInEnvironment(folderId, input.environmentId);

  const existing = await findNoteInFolder(input.environmentId, folderId, title);
  if (existing) throw new NotesError(`Заметка «${title}» здесь уже есть`);

  const [note] = await db
    .insert(notes)
    .values({
      title,
      text: input.text ?? "",
      folderId,
      environmentId: input.environmentId,
    })
    .returning();
  return note;
}

export async function updateNote(
  id: string,
  data: { title?: string; text?: string }
): Promise<Note> {
  const note = await getNote(id);
  if (!note) throw new NotesError("Заметка не найдена");

  const patch: { title?: string; text?: string; updatedAt: Date } = { updatedAt: new Date() };

  if (data.title !== undefined) {
    const title = assertValidSegment(data.title, "заметки");
    const existing = await findNoteInFolder(note.environmentId, note.folderId, title);
    if (existing && existing.id !== id) throw new NotesError(`Заметка «${title}» здесь уже есть`);
    patch.title = title;
  }
  if (data.text !== undefined) patch.text = data.text;

  const [updated] = await db.update(notes).set(patch).where(eq(notes.id, id)).returning();
  return updated;
}

/** Дописывает в конец с пустой строкой-разделителем. Уже написанное не трогает. */
export async function appendToNote(id: string, text: string): Promise<Note> {
  const note = await getNote(id);
  if (!note) throw new NotesError("Заметка не найдена");

  const separator = note.text.trim() ? "\n\n" : "";
  return updateNote(id, { text: `${note.text}${separator}${text}` });
}

export async function moveNote(id: string, folderId: string | null): Promise<Note> {
  const note = await getNote(id);
  if (!note) throw new NotesError("Заметка не найдена");

  if (folderId !== null) await assertFolderInEnvironment(folderId, note.environmentId);

  const existing = await findNoteInFolder(note.environmentId, folderId, note.title);
  if (existing && existing.id !== id) {
    throw new NotesError(`Заметка «${note.title}» в этом месте уже есть`);
  }

  const [updated] = await db
    .update(notes)
    .set({ folderId, updatedAt: new Date() })
    .where(eq(notes.id, id))
    .returning();
  return updated;
}

export async function deleteNote(id: string): Promise<void> {
  await db.delete(notes).where(eq(notes.id, id));
}

/* ------------------------- Адресация путями ------------------------- */

/**
 * Идёт по сегментам от корня. `create: true` — недостающие папки заводятся по
 * дороге: агенту, пишущему «Работа/Цены/Аномалии», незачем создавать каждую
 * папку отдельным вызовом.
 */
async function walkFolders(
  environmentId: string,
  segments: string[],
  options: { create: boolean }
): Promise<string | null> {
  let parentId: string | null = null;

  for (const segment of segments) {
    const name = assertValidSegment(segment, "папки");
    const found: NoteFolder | undefined = await findChildFolder(
      environmentId,
      parentId,
      name
    );

    if (found) {
      parentId = found.id;
      continue;
    }
    if (!options.create) throw new NotesError(`Папки «${segments.join("/")}» нет`);

    const created = await createFolder({ environmentId, name, parentId });
    parentId = created.id;
  }

  return parentId;
}

/** Папка по пути. Пустой путь — корень среды (`null`). */
export async function resolveFolderPath(
  environmentId: string,
  path: string
): Promise<string | null> {
  return walkFolders(environmentId, parseFolderPath(path), { create: false });
}

export async function ensureFolderPath(
  environmentId: string,
  segments: string[]
): Promise<string | null> {
  return walkFolders(environmentId, segments, { create: true });
}

/** Заметка по пути. Не найдена — `undefined`, а не исключение. */
export async function findNoteByPath(
  environmentId: string,
  path: string
): Promise<Note | undefined> {
  const { folders, title } = parseNotePath(path);
  let folderId: string | null;
  try {
    folderId = await walkFolders(environmentId, folders, { create: false });
  } catch {
    // Нет папки — значит нет и заметки. Разные слова про одно и то же.
    return undefined;
  }
  return findNoteInFolder(environmentId, folderId, title);
}

/** Заметка по пути или внятная ошибка — то, что нужно инструментам. */
export async function requireNoteByPath(environmentId: string, path: string): Promise<Note> {
  const note = await findNoteByPath(environmentId, path);
  if (!note) throw new NotesError(`Заметки «${path}» нет`);
  return note;
}

/** Путь папки от корня среды. Корень — пустой массив. */
export async function folderSegments(folderId: string | null): Promise<string[]> {
  if (folderId === null) return [];

  const segments: string[] = [];
  let current: string | null = folderId;

  while (current) {
    const folder: NoteFolder | undefined = await getFolder(current);
    if (!folder) break;
    segments.unshift(folder.name);
    current = folder.parentId;
  }

  return segments;
}

/** Заводит заметку по пути, создавая недостающие папки. Для инструментов. */
export async function createNoteByPath(
  environmentId: string,
  path: string,
  text?: string
): Promise<Note> {
  const { folders, title } = parseNotePath(path);
  const folderId = await ensureFolderPath(environmentId, folders);
  return createNote({ environmentId, title, folderId, text });
}

export type FolderWithPath = NoteFolder & { path: string };

/** Папки среды с путями от корня — чтобы агент увидел дерево одним вызовом. */
export async function listFoldersWithPaths(
  environmentId: string
): Promise<FolderWithPath[]> {
  const folders = await db
    .select()
    .from(noteFolders)
    .where(eq(noteFolders.environmentId, environmentId))
    .orderBy(asc(noteFolders.name));

  const byId = new Map(folders.map((folder) => [folder.id, folder]));

  return folders
    .map((folder) => {
      const segments: string[] = [];
      let current: string | null = folder.id;
      while (current) {
        const item: NoteFolder | undefined = byId.get(current);
        if (!item) break;
        segments.unshift(item.name);
        current = item.parentId;
      }
      return { ...folder, path: segments.join("/") };
    })
    .sort((a, b) => a.path.localeCompare(b.path, "ru"));
}

export type NoteWithPath = NoteSummary & { path: string };

/**
 * Заметки среды с путями. `folder` ограничивает выдачу поддеревом — папкой и
 * всем, что внутри неё.
 */
export async function listNotesWithPaths(
  environmentId: string,
  folder?: string
): Promise<NoteWithPath[]> {
  const { folders, notes: noteRows } = await getNotesTree(environmentId);
  const byId = new Map(folders.map((item) => [item.id, item]));

  const pathOf = (folderId: string | null): string[] => {
    const segments: string[] = [];
    let current = folderId;
    while (current) {
      const item = byId.get(current);
      if (!item) break;
      segments.unshift(item.name);
      current = item.parentId;
    }
    return segments;
  };

  const prefix = folder ? parseFolderPath(folder) : [];
  const result: NoteWithPath[] = [];

  for (const note of noteRows) {
    const segments = pathOf(note.folderId);
    // Поддерево, а не только сама папка: «Работа» отдаёт и «Работа/Цены/…».
    if (!prefix.every((segment, index) => segments[index] === segment)) continue;
    result.push({ ...note, path: formatNotePath(segments, note.title) });
  }

  return result;
}
