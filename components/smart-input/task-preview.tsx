"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { TaskPreviewItem } from "./task-preview-item";
import type { ParsedTask } from "@/lib/services/groq";

function pluralTasks(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return `${n} задача`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return `${n} задачи`;
  return `${n} задач`;
}

interface TaskPreviewProps {
  tasks: ParsedTask[];
  sourceText: string;
  onConfirm: (tasks: ParsedTask[]) => void;
  onCancel: () => void;
  isPending: boolean;
}

export function TaskPreview({ tasks, sourceText, onConfirm, onCancel, isPending }: TaskPreviewProps) {
  const [checked, setChecked] = useState<boolean[]>(() => tasks.map(() => true));
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editedTasks, setEditedTasks] = useState<ParsedTask[]>(tasks);
  const [showSource, setShowSource] = useState(false);

  const selectedCount = checked.filter(Boolean).length;

  function toggleCheck(index: number) {
    setChecked((prev) => prev.map((v, i) => (i === index ? !v : v)));
  }

  function handleEditTitle(index: number, newTitle: string) {
    setEditedTasks((prev) => prev.map((t, i) => (i === index ? { ...t, title: newTitle } : t)));
  }

  function handleConfirm() {
    const selected = editedTasks.filter((_, i) => checked[i]);
    onConfirm(selected);
  }

  return (
    <div className="flex flex-col gap-2">
      {/* Исходный текст */}
      <div className="flex items-start justify-between gap-2 rounded-xl border bg-card px-3.5 py-2.5">
        <span className={cn("text-xs text-muted-foreground", showSource ? "whitespace-pre-wrap" : "truncate max-w-[80%]")}>
          {showSource ? sourceText : sourceText.slice(0, 60) + (sourceText.length > 60 ? "..." : "")}
        </span>
        <button
          type="button"
          onClick={() => setShowSource((v) => !v)}
          className="shrink-0 text-[11px] text-primary"
        >
          {showSource ? "скрыть" : "показать"}
        </button>
      </div>

      {/* Список задач */}
      {editedTasks.map((task, i) => (
        <div key={i}>
          {editingIndex === i ? (
            <div className="flex gap-2 rounded-xl border bg-card p-3">
              <Input
                value={task.title}
                onChange={(e) => handleEditTitle(i, e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && setEditingIndex(null)}
                autoFocus
                className="flex-1"
              />
              <Button size="sm" variant="outline" onClick={() => setEditingIndex(null)}>
                OK
              </Button>
            </div>
          ) : (
            <TaskPreviewItem
              task={task}
              checked={checked[i]}
              onToggle={() => toggleCheck(i)}
              onEdit={() => setEditingIndex(i)}
            />
          )}
        </div>
      ))}

      {/* Действия */}
      <div className="flex items-center justify-between pt-1">
        <span className="text-xs text-muted-foreground">
          {selectedCount === tasks.length
            ? `${pluralTasks(selectedCount)} выбрано`
            : `${selectedCount} из ${tasks.length} выбрано`}
        </span>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={onCancel} disabled={isPending}>
            Отмена
          </Button>
          <Button size="sm" onClick={handleConfirm} disabled={isPending || selectedCount === 0}>
            {isPending ? "Добавление..." : `Добавить ${pluralTasks(selectedCount)}`}
          </Button>
        </div>
      </div>
    </div>
  );
}
