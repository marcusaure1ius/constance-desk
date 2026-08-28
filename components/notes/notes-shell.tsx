"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { PanelLeft } from "lucide-react";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { NotesTree } from "@/components/notes/notes-tree";
import {
  buildNoteTree,
  folderChainToNote,
  type FolderInput,
  type NoteInput,
} from "@/lib/notes/tree";

type NotesShellProps = {
  environmentId: string;
  folders: FolderInput[];
  notes: NoteInput[];
  children: React.ReactNode;
};

/**
 * Раскладка раздела: дерево слева, редактор справа.
 *
 * На телефоне рядом они не помещаются — дерево уезжает в выезжающую панель, а
 * экран целиком отдаётся тексту. Дерево при этом одно и то же, не две копии
 * компонента.
 */
export function NotesShell({ environmentId, folders, notes, children }: NotesShellProps) {
  const pathname = usePathname();
  const [sheetOpen, setSheetOpen] = React.useState(false);

  const activeNoteId = pathname.match(/^\/notes\/([^/]+)/)?.[1];
  const nodes = React.useMemo(() => buildNoteTree(folders, notes), [folders, notes]);
  const initialExpanded = React.useMemo(() => {
    const active = notes.find((note) => note.id === activeNoteId);
    return folderChainToNote(folders, active?.folderId ?? null);
  }, [folders, notes, activeNoteId]);

  const tree = (onNavigate?: () => void) => (
    <NotesTree
      environmentId={environmentId}
      nodes={nodes}
      activeNoteId={activeNoteId}
      initialExpanded={initialExpanded}
      onNavigate={onNavigate}
    />
  );

  return (
    <div className="flex h-[calc(100dvh-var(--app-header-height,4.5rem)-4.5rem)] min-h-0 overflow-hidden rounded-xl border bg-card md:h-[calc(100dvh-var(--app-header-height,4.5rem)-1rem)]">
      <aside className="hidden w-64 shrink-0 border-r md:flex md:flex-col">{tree()}</aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="border-b px-2 py-1.5 md:hidden">
          <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
            <SheetTrigger
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent"
              aria-label="Показать дерево заметок"
            >
              <PanelLeft className="size-4" /> Все заметки
            </SheetTrigger>
            <SheetContent side="left" className="p-0">
              <SheetTitle className="sr-only">Дерево заметок</SheetTitle>
              {tree(() => setSheetOpen(false))}
            </SheetContent>
          </Sheet>
        </div>

        <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
      </div>
    </div>
  );
}
