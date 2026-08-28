/**
 * Сборка дерева из плоских списков.
 *
 * База отдаёт папки и заметки двумя таблицами, а рисуется одно дерево. Функция
 * чистая и без React — проверяется в офлайн-прогоне.
 */

export type FolderInput = { id: string; name: string; parentId: string | null };
export type NoteInput = { id: string; title: string; folderId: string | null };

export type TreeNode =
  | { kind: "folder"; id: string; name: string; children: TreeNode[] }
  | { kind: "note"; id: string; title: string };

/** Русский порядок: без локали «Ёлка» уезжает за «Яблоко». */
const collator = new Intl.Collator("ru", { sensitivity: "base", numeric: true });

/** Папки выше заметок, внутри группы — по алфавиту. Как в Obsidian. */
function compare(a: TreeNode, b: TreeNode): number {
  if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
  const left = a.kind === "folder" ? a.name : a.title;
  const right = b.kind === "folder" ? b.name : b.title;
  return collator.compare(left, right);
}

export function buildNoteTree(folders: FolderInput[], notes: NoteInput[]): TreeNode[] {
  const children = new Map<string | null, TreeNode[]>();
  const push = (key: string | null, node: TreeNode) => {
    const list = children.get(key);
    if (list) list.push(node);
    else children.set(key, [node]);
  };

  const folderNodes = new Map<string, Extract<TreeNode, { kind: "folder" }>>();
  for (const folder of folders) {
    folderNodes.set(folder.id, {
      kind: "folder",
      id: folder.id,
      name: folder.name,
      children: [],
    });
  }

  for (const folder of folders) {
    const node = folderNodes.get(folder.id)!;
    // Родитель из другой среды или удалённый — вешаем в корень, а не теряем.
    const parent = folder.parentId && folderNodes.has(folder.parentId) ? folder.parentId : null;
    push(parent, node);
  }

  for (const note of notes) {
    const folderId = note.folderId && folderNodes.has(note.folderId) ? note.folderId : null;
    push(folderId, { kind: "note", id: note.id, title: note.title });
  }

  for (const [key, list] of children) {
    list.sort(compare);
    if (key !== null) folderNodes.get(key)!.children = list;
  }

  return children.get(null) ?? [];
}

/** Идентификаторы папок на пути к заметке — чтобы раскрыть дерево до неё. */
export function folderChainToNote(
  folders: FolderInput[],
  noteFolderId: string | null
): string[] {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const chain: string[] = [];
  let current = noteFolderId;

  while (current && !chain.includes(current)) {
    chain.push(current);
    current = byId.get(current)?.parentId ?? null;
  }

  return chain;
}
