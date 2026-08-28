"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  ChevronRight,
  FilePlus2,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  MoreHorizontal,
  Pencil,
  Trash2,
} from "lucide-react";
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
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  createFolderAction,
  createNoteAction,
  deleteFolderAction,
  deleteNoteAction,
  moveFolderAction,
  moveNoteAction,
  renameFolderAction,
  renameNoteAction,
} from "@/lib/actions/notes";
import { type TreeNode } from "@/lib/notes/tree";
import { cn } from "@/lib/utils";

/** Что сейчас редактируется inline: создание новой строки или переименование. */
type Draft =
  | { mode: "create"; kind: "folder" | "note"; parentId: string | null }
  | { mode: "rename"; kind: "folder" | "note"; id: string; value: string };

type NotesTreeProps = {
  environmentId: string;
  nodes: TreeNode[];
  activeNoteId?: string;
  /** Папки, раскрытые изначально: путь до открытой заметки. */
  initialExpanded: string[];
  onNavigate?: () => void;
};

export function NotesTree({
  environmentId,
  nodes,
  activeNoteId,
  initialExpanded,
  onNavigate,
}: NotesTreeProps) {
  const router = useRouter();
  const [expanded, setExpanded] = React.useState<Set<string>>(
    () => new Set(initialExpanded)
  );
  const [draft, setDraft] = React.useState<Draft | null>(null);
  const [dropTarget, setDropTarget] = React.useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = React.useState<TreeNode | null>(null);

  // Открытая заметка раскрывает свои папки: переход по ссылке из чата агента
  // не должен приводить в дерево, где выбранной заметки не видно.
  React.useEffect(() => {
    setExpanded((current) => {
      if (initialExpanded.every((id) => current.has(id))) return current;
      return new Set([...current, ...initialExpanded]);
    });
  }, [initialExpanded]);

  const toggle = (id: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const startCreate = (kind: "folder" | "note", parentId: string | null) => {
    if (parentId) setExpanded((current) => new Set(current).add(parentId));
    setDraft({ mode: "create", kind, parentId });
  };

  const submitDraft = async (value: string) => {
    const trimmed = value.trim();
    const current = draft;
    setDraft(null);
    if (!current || !trimmed) return;

    try {
      if (current.mode === "create" && current.kind === "folder") {
        await createFolderAction(environmentId, trimmed, current.parentId);
      } else if (current.mode === "create") {
        const note = await createNoteAction(environmentId, trimmed, current.parentId);
        router.push(`/notes/${note.id}`);
        onNavigate?.();
      } else if (current.kind === "folder") {
        await renameFolderAction(current.id, trimmed);
      } else {
        await renameNoteAction(current.id, trimmed);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не получилось");
    }
  };

  const handleDrop = async (targetFolderId: string | null, raw: string) => {
    setDropTarget(null);
    const [kind, id] = raw.split(":");
    if (!id) return;

    try {
      if (kind === "note") await moveNoteAction(id, targetFolderId);
      else await moveFolderAction(id, targetFolderId);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не получилось перенести");
    }
  };

  const remove = async (node: TreeNode) => {
    setPendingDelete(null);
    try {
      if (node.kind === "folder") {
        await deleteFolderAction(node.id);
      } else {
        await deleteNoteAction(node.id);
        if (node.id === activeNoteId) router.push("/notes");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не получилось удалить");
    }
  };

  const renderNodes = (items: TreeNode[], depth: number): React.ReactNode =>
    items.map((node) => {
      if (draft?.mode === "rename" && draft.id === node.id) {
        return (
          <DraftRow
            key={`rename-${node.id}`}
            depth={depth}
            kind={draft.kind}
            initial={draft.value}
            onSubmit={submitDraft}
            onCancel={() => setDraft(null)}
          />
        );
      }

      if (node.kind === "note") {
        return (
          <Row
            key={node.id}
            depth={depth}
            active={node.id === activeNoteId}
            draggable
            onDragStart={(event) => event.dataTransfer.setData("text/plain", `note:${node.id}`)}
            onClick={() => {
              router.push(`/notes/${node.id}`);
              onNavigate?.();
            }}
            icon={<FileText className="size-4 shrink-0 text-muted-foreground" />}
            label={node.title}
            menu={
              <NodeMenu
                onRename={() =>
                  setDraft({ mode: "rename", kind: "note", id: node.id, value: node.title })
                }
                onDelete={() => setPendingDelete(node)}
              />
            }
          />
        );
      }

      const isOpen = expanded.has(node.id);
      return (
        <div key={node.id}>
          <Row
            depth={depth}
            highlighted={dropTarget === node.id}
            draggable
            onDragStart={(event) => event.dataTransfer.setData("text/plain", `folder:${node.id}`)}
            onDragOver={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setDropTarget(node.id);
            }}
            onDragLeave={() => setDropTarget((current) => (current === node.id ? null : current))}
            onDrop={(event) => {
              event.preventDefault();
              event.stopPropagation();
              void handleDrop(node.id, event.dataTransfer.getData("text/plain"));
            }}
            onClick={() => toggle(node.id)}
            icon={
              <>
                <ChevronRight
                  className={cn(
                    "size-3.5 shrink-0 text-muted-foreground transition-transform",
                    isOpen && "rotate-90"
                  )}
                />
                {isOpen ? (
                  <FolderOpen className="size-4 shrink-0 text-muted-foreground" />
                ) : (
                  <Folder className="size-4 shrink-0 text-muted-foreground" />
                )}
              </>
            }
            label={node.name}
            menu={
              <NodeMenu
                onCreateNote={() => startCreate("note", node.id)}
                onCreateFolder={() => startCreate("folder", node.id)}
                onRename={() =>
                  setDraft({ mode: "rename", kind: "folder", id: node.id, value: node.name })
                }
                onDelete={() => setPendingDelete(node)}
              />
            }
          />
          {isOpen && (
            <>
              {renderNodes(node.children, depth + 1)}
              {draft?.mode === "create" && draft.parentId === node.id && (
                <DraftRow
                  depth={depth + 1}
                  kind={draft.kind}
                  onSubmit={submitDraft}
                  onCancel={() => setDraft(null)}
                />
              )}
            </>
          )}
        </div>
      );
    });

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-1 px-2 py-2">
        <span className="px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Заметки
        </span>
        <div className="flex items-center gap-0.5">
          <IconButton
            label="Новая заметка"
            onClick={() => startCreate("note", null)}
            icon={<FilePlus2 className="size-4" />}
          />
          <IconButton
            label="Новая папка"
            onClick={() => startCreate("folder", null)}
            icon={<FolderPlus className="size-4" />}
          />
        </div>
      </div>

      <div
        className={cn(
          "min-h-0 flex-1 overflow-y-auto px-1 pb-4",
          dropTarget === "__root__" && "bg-accent/40"
        )}
        onDragOver={(event) => {
          event.preventDefault();
          setDropTarget("__root__");
        }}
        onDragLeave={() => setDropTarget((current) => (current === "__root__" ? null : current))}
        onDrop={(event) => {
          event.preventDefault();
          void handleDrop(null, event.dataTransfer.getData("text/plain"));
        }}
      >
        {renderNodes(nodes, 0)}
        {draft?.mode === "create" && draft.parentId === null && (
          <DraftRow
            depth={0}
            kind={draft.kind}
            onSubmit={submitDraft}
            onCancel={() => setDraft(null)}
          />
        )}
        {nodes.length === 0 && !draft && (
          <p className="px-3 py-6 text-sm text-muted-foreground">
            Пусто. Заведите первую заметку кнопкой выше.
          </p>
        )}
      </div>

      <DeleteDialog
        node={pendingDelete}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => pendingDelete && remove(pendingDelete)}
      />
    </div>
  );
}

/**
 * Подтверждение удаления. Один диалог на всё дерево, а не по штуке на строку:
 * узлов бывает много, а открыт всегда ровно один вопрос.
 *
 * Для папки предупреждение не косметическое — удаление каскадное, и вместе с
 * ней уходит всё вложенное.
 */
function DeleteDialog({
  node,
  onCancel,
  onConfirm,
}: {
  node: TreeNode | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const isFolder = node?.kind === "folder";
  const name = node ? (node.kind === "folder" ? node.name : node.title) : "";

  return (
    <AlertDialog open={node !== null} onOpenChange={(open) => !open && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {isFolder ? `Удалить папку «${name}»?` : `Удалить «${name}»?`}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {isFolder
              ? "Вместе с папкой исчезнут все вложенные папки и заметки. Отменить будет нельзя."
              : "Заметка исчезнет вместе с текстом. Отменить будет нельзя."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Отмена</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>Удалить</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function IconButton({
  label,
  icon,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
    >
      {icon}
    </button>
  );
}

type RowProps = {
  depth: number;
  label: string;
  icon: React.ReactNode;
  menu: React.ReactNode;
  active?: boolean;
  highlighted?: boolean;
} & React.HTMLAttributes<HTMLDivElement> &
  Pick<React.HTMLAttributes<HTMLDivElement>, "onDragStart" | "onDragOver" | "onDrop">;

function Row({
  depth,
  label,
  icon,
  menu,
  active,
  highlighted,
  className,
  ...rest
}: RowProps & { draggable?: boolean }) {
  return (
    <div
      {...rest}
      className={cn(
        "group flex cursor-pointer items-center gap-1.5 rounded-md py-1.5 pr-1 text-sm transition-colors hover:bg-accent",
        active && "bg-accent font-medium",
        highlighted && "bg-accent ring-1 ring-primary/40",
        className
      )}
      style={{ paddingLeft: 8 + depth * 14 }}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span
        className="opacity-0 transition-opacity group-hover:opacity-100 data-[open]:opacity-100"
        onClick={(event) => event.stopPropagation()}
      >
        {menu}
      </span>
    </div>
  );
}

function NodeMenu({
  onCreateNote,
  onCreateFolder,
  onRename,
  onDelete,
}: {
  onCreateNote?: () => void;
  onCreateFolder?: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="rounded p-1 text-muted-foreground hover:bg-background hover:text-foreground"
        aria-label="Действия"
      >
        <MoreHorizontal className="size-4" />
      </DropdownMenuTrigger>
      {/* w-auto перекрывает `w-(--anchor-width)` из общего компонента: якорь
          здесь — кнопка в 24 пикселя, и подписи переносились по слогам. */}
      <DropdownMenuContent align="end" className="w-auto min-w-max">
        {onCreateNote && (
          <DropdownMenuItem onClick={onCreateNote}>
            <FilePlus2 className="size-4" /> Новая заметка
          </DropdownMenuItem>
        )}
        {onCreateFolder && (
          <DropdownMenuItem onClick={onCreateFolder}>
            <FolderPlus className="size-4" /> Новая папка
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onClick={onRename}>
          <Pencil className="size-4" /> Переименовать
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={onDelete}>
          <Trash2 className="size-4" /> Удалить
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Строка-заготовка: поле ввода прямо в дереве, без модального окна. */
function DraftRow({
  depth,
  kind,
  initial = "",
  onSubmit,
  onCancel,
}: {
  depth: number;
  kind: "folder" | "note";
  initial?: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = React.useState(initial);

  return (
    <div
      className="flex items-center gap-1.5 rounded-md py-1 pr-1"
      style={{ paddingLeft: 8 + depth * 14 }}
    >
      {kind === "folder" ? (
        <Folder className="size-4 shrink-0 text-muted-foreground" />
      ) : (
        <FileText className="size-4 shrink-0 text-muted-foreground" />
      )}
      <input
        autoFocus
        value={value}
        placeholder={kind === "folder" ? "Имя папки" : "Название заметки"}
        onChange={(event) => setValue(event.target.value)}
        onBlur={() => onSubmit(value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") onSubmit(value);
          if (event.key === "Escape") onCancel();
        }}
        className="min-w-0 flex-1 rounded border bg-background px-1.5 py-0.5 text-sm outline-none focus:ring-1 focus:ring-primary/40"
      />
    </div>
  );
}
