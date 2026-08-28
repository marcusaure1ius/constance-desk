"use server";

import { revalidatePath } from "next/cache";
import {
  createFolder,
  createNote,
  deleteFolder,
  deleteNote,
  moveFolder,
  moveNote,
  renameFolder,
  updateNote,
} from "@/lib/services/notes";

/**
 * Дерево живёт в layout маршрута `/notes`, поэтому пересчитывать надо именно
 * его: `revalidatePath("/notes")` обновил бы только пустую страницу-заглушку, а
 * открытая заметка осталась бы со старым деревом.
 */
function revalidateNotes() {
  revalidatePath("/notes", "layout");
}

export async function createFolderAction(
  environmentId: string,
  name: string,
  parentId: string | null
) {
  const folder = await createFolder({ environmentId, name, parentId });
  revalidateNotes();
  return folder;
}

export async function renameFolderAction(id: string, name: string) {
  const folder = await renameFolder(id, name);
  revalidateNotes();
  return folder;
}

export async function moveFolderAction(id: string, parentId: string | null) {
  const folder = await moveFolder(id, parentId);
  revalidateNotes();
  return folder;
}

export async function deleteFolderAction(id: string) {
  await deleteFolder(id);
  revalidateNotes();
}

export async function createNoteAction(
  environmentId: string,
  title: string,
  folderId: string | null
) {
  const note = await createNote({ environmentId, title, folderId });
  revalidateNotes();
  return note;
}

export async function renameNoteAction(id: string, title: string) {
  const note = await updateNote(id, { title });
  revalidateNotes();
  return note;
}

/**
 * Автосохранение текста. Пересчёта маршрута здесь намеренно нет: текст в дереве
 * не показывается, а `revalidatePath` на каждом срабатывании дебаунса перетряхивал
 * бы дерево прямо под курсором.
 */
export async function saveNoteTextAction(id: string, text: string) {
  await updateNote(id, { text });
}

export async function moveNoteAction(id: string, folderId: string | null) {
  const note = await moveNote(id, folderId);
  revalidateNotes();
  return note;
}

export async function deleteNoteAction(id: string) {
  await deleteNote(id);
  revalidateNotes();
}
