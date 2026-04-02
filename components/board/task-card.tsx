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

const priorityColors = {
  urgent: "border-l-red-500",
  high: "border-l-yellow-500",
  normal: "border-l-gray-300",
};

export function TaskCard({ task, categories, onClick }: TaskCardProps) {
  const category = categories.find((c) => c.id === task.categoryId);

  return (
    <div
      onClick={onClick}
      className={cn(
        "cursor-pointer rounded-lg border border-l-4 bg-card p-3 shadow-sm transition-shadow hover:shadow-md",
        priorityColors[task.priority]
      )}
    >
      <p className="font-medium text-sm">{task.title}</p>
      <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
        {category && (
          <Badge variant="secondary" className="text-xs">
            {category.name}
          </Badge>
        )}
        {task.completedAt ? (
          <span>✓ {formatDate(task.completedAt)}</span>
        ) : task.plannedDate ? (
          <span>до {formatDate(task.plannedDate)}</span>
        ) : null}
      </div>
    </div>
  );
}
