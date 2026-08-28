import { NotebookPen } from "lucide-react";

/** Заметка не выбрана. Дерево рядом, поэтому подсказка короткая. */
export default function NotesPage() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
      <NotebookPen className="size-8 text-muted-foreground" />
      <p className="text-sm text-muted-foreground">
        Выберите заметку слева или создайте новую.
      </p>
    </div>
  );
}
