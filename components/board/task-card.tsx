"use client";

import { Badge } from "@/components/ui/badge";
import { formatDate, cn } from "@/lib/utils";

type Task = {
  id: string;
  title: string;
  description: string | null;
  priority: "urgent" | "high" | "normal";
  categoryId: string | null;
  plannedDate: string | null;
  completedAt: Date | null;
};

type Category = {
  id: string;
  name: string;
  color: string | null;
};

interface TaskCardProps {
  task: Task;
  categories: Category[];
  onClick?: () => void;
}

const priorityDot = {
  urgent: "bg-red-500",
  high: "bg-yellow-400",
  normal: "bg-gray-400",
};

export function TaskCard({ task, categories, onClick }: TaskCardProps) {
  const category = categories.find((c) => c.id === task.categoryId);
  const hasDateOrCategory = task.completedAt || task.plannedDate || category;

  return (
    <div
      onClick={onClick}
      className="cursor-pointer rounded-lg border bg-card p-3 shadow-sm transition-shadow hover:shadow-md"
    >
      <p className="font-medium text-sm">{task.title}</p>
      {hasDateOrCategory && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {task.completedAt ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
              <span className="size-2 shrink-0 rounded-full bg-green-500" />
              {formatDate(task.completedAt)}
            </span>
          ) : task.plannedDate ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
              <span className={cn("size-2 shrink-0 rounded-full", priorityDot[task.priority])} />
              до {formatDate(task.plannedDate)}
            </span>
          ) : null}
          {category && (
            <Badge variant="secondary" className="text-xs max-w-full justify-start truncate">
              {category.name}
            </Badge>
          )}
        </div>
      )}
    </div>
  );
}
