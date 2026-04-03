"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { DragDropContext, Droppable, Draggable, type DropResult } from "@hello-pangea/dnd";
import { GripVertical, Pencil, Trash2, Check, X } from "lucide-react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  createColumnAction,
  updateColumnAction,
  deleteColumnAction,
  reorderColumnsAction,
} from "@/lib/actions/columns";

type Column = {
  id: string;
  title: string;
  position: number;
};

interface ColumnsManagerProps {
  columns: Column[];
  environmentId: string;
}

export function ColumnsManager({ columns: initialColumns, environmentId }: ColumnsManagerProps) {
  const [columns, setColumns] = useState(initialColumns);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [isPending, startTransition] = useTransition();

  function startEdit(col: Column) {
    setEditingId(col.id);
    setEditValue(col.title);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditValue("");
  }

  function handleUpdate(id: string) {
    if (!editValue.trim()) return;
    startTransition(async () => {
      const updated = await updateColumnAction(id, editValue.trim());
      setColumns((prev) =>
        prev.map((c) => (c.id === id ? { ...c, title: updated.title } : c))
      );
      setEditingId(null);
      setEditValue("");
    });
  }

  function handleDelete(id: string) {
    startTransition(async () => {
      const result = await deleteColumnAction(id);
      if (result && "error" in result && result.error) {
        toast.error(result.error);
        return;
      }
      setColumns((prev) => prev.filter((c) => c.id !== id));
    });
  }

  function handleAdd() {
    if (!newTitle.trim()) return;
    startTransition(async () => {
      const created = await createColumnAction(newTitle.trim(), environmentId);
      setColumns((prev) => [...prev, created]);
      setNewTitle("");
    });
  }

  function handleDragEnd(result: DropResult) {
    if (!result.destination) return;
    const from = result.source.index;
    const to = result.destination.index;
    if (from === to) return;

    const reordered = Array.from(columns);
    const [moved] = reordered.splice(from, 1);
    reordered.splice(to, 0, moved);

    const updated = reordered.map((col, i) => ({ ...col, position: i }));
    setColumns(updated);

    startTransition(async () => {
      try {
        await reorderColumnsAction(updated.map((c) => c.id));
      } catch {
        setColumns(columns);
        toast.error("Не удалось изменить порядок");
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Колонки</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <DragDropContext onDragEnd={handleDragEnd}>
          <Droppable droppableId="columns">
            {(provided) => (
              <div ref={provided.innerRef} {...provided.droppableProps} className="space-y-2">
                {columns.map((col, index) => (
                  <Draggable key={col.id} draggableId={col.id} index={index}>
                    {(provided, snapshot) => (
                      <div
                        ref={provided.innerRef}
                        {...provided.draggableProps}
                        className={`flex items-center gap-2 rounded-lg p-1 ${snapshot.isDragging ? "bg-muted shadow-md" : ""}`}
                      >
                        <span
                          {...provided.dragHandleProps}
                          className="cursor-grab active:cursor-grabbing"
                        >
                          <GripVertical className="size-4 text-muted-foreground shrink-0" />
                        </span>
                        {editingId === col.id ? (
                          <>
                            <Input
                              value={editValue}
                              onChange={(e) => setEditValue(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") handleUpdate(col.id);
                                if (e.key === "Escape") cancelEdit();
                              }}
                              className="flex-1"
                              autoFocus
                            />
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => handleUpdate(col.id)}
                              disabled={isPending}
                            >
                              <Check className="size-4" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={cancelEdit}
                              disabled={isPending}
                            >
                              <X className="size-4" />
                            </Button>
                          </>
                        ) : (
                          <>
                            <span className="flex-1 text-sm">{col.title}</span>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => startEdit(col)}
                              disabled={isPending}
                            >
                              <Pencil className="size-4" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => handleDelete(col.id)}
                              disabled={isPending}
                            >
                              <Trash2 className="size-4" />
                            </Button>
                          </>
                        )}
                      </div>
                    )}
                  </Draggable>
                ))}
                {provided.placeholder}
              </div>
            )}
          </Droppable>
        </DragDropContext>

        <div className="flex items-center gap-2 pt-2">
          <Input
            placeholder="Новая колонка"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleAdd();
            }}
            className="flex-1"
          />
          <Button onClick={handleAdd} disabled={isPending || !newTitle.trim()}>
            Добавить
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
