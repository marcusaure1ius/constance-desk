"use client";

import { memo, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { formatDate, cn } from "@/lib/utils";
import { useTaskSubtasks, type Subtask } from "./task-subtasks";

type Task = {
  id: string;
  title: string;
  description: string | null;
  priority: "urgent" | "high" | "normal";
  categoryId: string | null;
  plannedDate: string | null;
  completedAt: Date | null;
  /** Нет поля — подзадачи на карточке не показываются (например, в архиве). */
  subtasks?: Subtask[];
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
  /** Где висит язычок подзадач: на кромке (доска) или внутри (свайп-карточка). */
  subtasksPlacement?: "edge" | "inline";
}

const priorityDot = {
  urgent: "bg-red-500",
  high: "bg-yellow-400",
  normal: "bg-gray-400",
};

export const TaskCard = memo(function TaskCard({
  task,
  categories,
  onClick,
  subtasksPlacement = "edge",
}: TaskCardProps) {
  if (!task.subtasks) return <CardBody task={task} categories={categories} onClick={onClick} />;
  return (
    <TaskCardWithSubtasks
      task={task}
      subtasks={task.subtasks}
      categories={categories}
      onClick={onClick}
      placement={subtasksPlacement}
    />
  );
});

function TaskCardWithSubtasks({
  task,
  subtasks,
  categories,
  onClick,
  placement,
}: {
  task: Task;
  subtasks: Subtask[];
  categories: Category[];
  onClick?: () => void;
  placement: "edge" | "inline";
}) {
  const { list, tab, hasVisibleTab } = useTaskSubtasks({ taskId: task.id, subtasks, placement });

  if (placement === "inline") {
    return (
      <CardBody task={task} categories={categories} onClick={onClick} trailing={tab}>
        {list}
      </CardBody>
    );
  }

  return (
    // Язычок наполовину выходит за кромку — снизу оставляем ему место
    <div className={cn("group/card relative", hasVisibleTab && "mb-2.5")}>
      <CardBody task={task} categories={categories} onClick={onClick}>
        {list}
      </CardBody>
      {tab}
    </div>
  );
}

function CardBody({
  task,
  categories,
  onClick,
  trailing,
  children,
}: {
  task: Task;
  categories: Category[];
  onClick?: () => void;
  /** Встаёт в конец строки с датой и категорией. */
  trailing?: ReactNode;
  children?: ReactNode;
}) {
  const category = categories.find((c) => c.id === task.categoryId);
  const showPriority = task.priority !== "normal" && !task.completedAt && !task.plannedDate;
  const hasExtra = task.completedAt || task.plannedDate || category || showPriority || trailing;

  return (
    <div
      onClick={onClick}
      className="cursor-pointer rounded-lg border bg-card p-3 shadow-sm transition-shadow hover:shadow-md"
    >
      <p className="font-medium text-sm">{task.title}</p>
      {hasExtra && (
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
          ) : showPriority ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
              <span className={cn("size-2 shrink-0 rounded-full", priorityDot[task.priority])} />
              {task.priority === "urgent" ? "Срочный" : "Высокий"}
            </span>
          ) : null}
          {category && (
            <Badge variant="secondary" className="text-xs max-w-full justify-start truncate">
              {category.name}
            </Badge>
          )}
          {trailing}
        </div>
      )}
      {children}
    </div>
  );
}
