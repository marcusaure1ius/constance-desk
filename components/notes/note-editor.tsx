"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { Check, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { deleteNoteAction, renameNoteAction, saveNoteTextAction } from "@/lib/actions/notes";

/** CodeMirror весит немало и на сервере бесполезен — грузим только в браузере. */
const MarkdownEditor = dynamic(
  () => import("./markdown-editor").then((mod) => mod.MarkdownEditor),
  {
    ssr: false,
    loading: () => <div className="px-1 pt-2 text-sm text-muted-foreground">Открываю…</div>,
  }
);

/** Пауза после последнего нажатия клавиши до записи в базу. */
const AUTOSAVE_DELAY = 800;

type NoteEditorProps = {
  note: { id: string; title: string; text: string };
};

type SaveState = "saved" | "pending" | "saving";

export function NoteEditor({ note }: NoteEditorProps) {
  const router = useRouter();
  const [state, setState] = React.useState<SaveState>("saved");
  const [title, setTitle] = React.useState(note.title);

  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = React.useRef<string | null>(null);

  const flush = React.useCallback(async () => {
    const text = pendingRef.current;
    if (text === null) return;
    pendingRef.current = null;
    setState("saving");
    try {
      await saveNoteTextAction(note.id, text);
      setState("saved");
    } catch {
      setState("pending");
      toast.error("Не удалось сохранить заметку");
    }
  }, [note.id]);

  const handleChange = React.useCallback(
    (value: string) => {
      pendingRef.current = value;
      setState("pending");
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(flush, AUTOSAVE_DELAY);
    },
    [flush]
  );

  /**
   * Дожимает недописанное при уходе с заметки.
   *
   * Переключение заметки — не размонтирование: Next подставляет в тот же
   * компонент новые пропсы. Поэтому идентификатор берётся из замыкания эффекта,
   * а не из текущего рендера — иначе текст предыдущей заметки записался бы в
   * следующую.
   */
  React.useEffect(() => {
    const id = note.id;
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      const text = pendingRef.current;
      pendingRef.current = null;
      if (text !== null) void saveNoteTextAction(id, text);
    };
  }, [note.id]);

  const handleRename = async () => {
    const trimmed = title.trim();
    if (!trimmed || trimmed === note.title) {
      setTitle(note.title);
      return;
    }
    try {
      await renameNoteAction(note.id, trimmed);
    } catch (error) {
      setTitle(note.title);
      toast.error(error instanceof Error ? error.message : "Не удалось переименовать");
    }
  };

  const handleDelete = async () => {
    // Отложенная запись после удаления воскресила бы заметку.
    if (timerRef.current) clearTimeout(timerRef.current);
    pendingRef.current = null;
    try {
      await deleteNoteAction(note.id);
      router.push("/notes");
    } catch {
      toast.error("Не удалось удалить заметку");
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-2 border-b px-4 py-2.5">
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onBlur={handleRename}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
            if (event.key === "Escape") {
              setTitle(note.title);
              event.currentTarget.blur();
            }
          }}
          className="min-w-0 flex-1 truncate bg-transparent text-lg font-semibold outline-none"
          aria-label="Заголовок заметки"
        />
        <SaveIndicator state={state} />
        <AlertDialog>
          <AlertDialogTrigger
            className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            aria-label="Удалить заметку"
          >
            <Trash2 className="size-4" />
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Удалить «{note.title}»?</AlertDialogTitle>
              <AlertDialogDescription>
                Заметка исчезнет вместе с текстом. Отменить будет нельзя.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Отмена</AlertDialogCancel>
              <AlertDialogAction onClick={handleDelete}>Удалить</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </header>

      <div className="min-h-0 flex-1 overflow-hidden px-4">
        <MarkdownEditor key={note.id} initialValue={note.text} onChange={handleChange} />
      </div>
    </div>
  );
}

function SaveIndicator({ state }: { state: SaveState }) {
  if (state === "saving") {
    return (
      <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
        <Loader2 className="size-3 animate-spin" /> Сохраняю
      </span>
    );
  }
  if (state === "pending") {
    return <span className="shrink-0 text-xs text-muted-foreground">Не сохранено</span>;
  }
  return (
    <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
      <Check className="size-3" /> Сохранено
    </span>
  );
}
