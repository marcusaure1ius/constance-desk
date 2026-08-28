import { NotesShell } from "@/components/notes/notes-shell";
import { getActiveEnvironmentId } from "@/lib/environment";
import { getActiveEnvironment } from "@/lib/services/environments";
import { getNotesTree } from "@/lib/services/notes";

/**
 * Дерево живёт в layout, а не в странице: при переходе между заметками Next
 * перерисовывает только `page`, поэтому дерево не моргает и не теряет
 * раскрытые папки.
 *
 * Какая заметка открыта, layout не знает — `params` дочернего сегмента `[id]`
 * сюда не приходит. Это определяет клиент по адресу страницы.
 */
export default async function NotesLayout({ children }: { children: React.ReactNode }) {
  const cookieValue = await getActiveEnvironmentId();
  const activeEnv = await getActiveEnvironment(cookieValue);

  if (!activeEnv) return null;

  const { folders, notes } = await getNotesTree(activeEnv.id);

  return (
    <div className="container mx-auto px-2 py-2 md:px-4">
      <NotesShell
        environmentId={activeEnv.id}
        folders={folders.map(({ id, name, parentId }) => ({ id, name, parentId }))}
        notes={notes.map(({ id, title, folderId }) => ({ id, title, folderId }))}
      >
        {children}
      </NotesShell>
    </div>
  );
}
