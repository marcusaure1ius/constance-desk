"use client";

import { Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ParsedTask } from "@/lib/services/groq";

const priorityLabels: Record<string, { label: string; color: string; bg: string }> = {
  urgent: { label: "Срочный", color: "text-red-300", bg: "bg-red-950" },
  high: { label: "Высокий", color: "text-yellow-300", bg: "bg-yellow-950" },
  normal: { label: "Обычный", color: "text-stone-400", bg: "bg-stone-900" },
};

interface TaskPreviewItemProps {
  task: ParsedTask;
  checked: boolean;
  onToggle: () => void;
  onEdit: () => void;
}

export function TaskPreviewItem({ task, checked, onToggle, onEdit }: TaskPreviewItemProps) {
  const p = priorityLabels[task.priority ?? "normal"] ?? priorityLabels.normal;

  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-xl border bg-card p-3.5 transition-opacity",
        checked ? "opacity-100" : "opacity-40 border-border/50"
      )}
    >
      <button type="button" onClick={onToggle} className="mt-0.5 shrink-0">
        <div
          className={cn(
            "flex size-[18px] items-center justify-center rounded",
            checked ? "bg-primary" : "border-2 border-muted-foreground/40"
          )}
        >
          {checked && (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3">
              <path d="M20 6L9 17l-5-5" />
            </svg>
          )}
        </div>
      </button>

      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-foreground">{task.title}</div>
        <div className="mt-1 flex items-center gap-1.5 flex-wrap">
          {task.priority && task.priority !== "normal" && (
            <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px]", p.bg, p.color)}>
              <span className={cn("size-[5px] rounded-full", task.priority === "urgent" ? "bg-red-500" : "bg-yellow-400")} />
              {p.label}
            </span>
          )}
          {task.plannedDate && (
            <span className="text-[11px] text-amber-500">до {task.plannedDate}</span>
          )}
        </div>
      </div>

      {checked && (
        <button type="button" onClick={onEdit} className="shrink-0 p-1 text-muted-foreground hover:text-foreground">
          <Pencil className="size-3.5" />
        </button>
      )}
    </div>
  );
}
