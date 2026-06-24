"use client";

import { memo } from "react";
import { Droppable, Draggable } from "@hello-pangea/dnd";
import { ChevronDown, ChevronRight } from "lucide-react";
import { TaskCard } from "./task-card";
import { makeDroppableId, laneProgress } from "@/lib/board/epics";
import { cn } from "@/lib/utils";

type SwimlaneTask = {
  id: string;
  title: string;
  description: string | null;
  columnId: string;
  categoryId: string | null;
  priority: "urgent" | "high" | "normal";
  position: number;
  plannedDate: string | null;
  completedAt: Date | null;
};

interface EpicSwimlaneProps {
  laneKey: string;
  title: string;
  color: string | null;
  columns: { id: string; title: string }[];
  tasks: SwimlaneTask[];
  categories: { id: string; name: string; color: string | null }[];
  lastColumnId: string | undefined;
  collapsed: boolean;
  onToggleCollapsed: (key: string) => void;
  onTaskClick: (taskId: string) => void;
}

export const EpicSwimlane = memo(function EpicSwimlane({
  laneKey,
  title,
  color,
  columns,
  tasks,
  categories,
  lastColumnId,
  collapsed,
  onToggleCollapsed,
  onTaskClick,
}: EpicSwimlaneProps) {
  const { done, total } = laneProgress(tasks, lastColumnId);

  return (
    <>
      {/* Заголовок дорожки на всю ширину сетки */}
      <button
        onClick={() => onToggleCollapsed(laneKey)}
        className="col-span-full sticky left-0 mt-2 flex items-center gap-2 rounded-md bg-muted/60 px-3 py-2 text-left hover:bg-muted transition-colors"
      >
        {collapsed ? (
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
        )}
        {color && (
          <span
            className="size-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: color }}
          />
        )}
        <span className="text-sm font-semibold">{title}</span>
        <span className="ml-1 text-xs text-muted-foreground">
          {done}/{total}
        </span>
      </button>

      {/* Ряд ячеек: по одной на колонку (только если развёрнуто) */}
      {!collapsed &&
        columns.map((col) => {
          const cellTasks = tasks
            .filter((t) => t.columnId === col.id)
            .sort((a, b) => a.position - b.position);
          return (
            <Droppable
              key={col.id}
              droppableId={makeDroppableId(col.id, laneKey)}
              type={laneKey}
            >
              {(provided, snapshot) => (
                <div
                  ref={provided.innerRef}
                  {...provided.droppableProps}
                  className={cn(
                    "flex min-h-[60px] flex-col rounded-md p-1 transition-colors",
                    snapshot.isDraggingOver && "bg-muted"
                  )}
                >
                  {cellTasks.map((task, index) => (
                    <Draggable key={task.id} draggableId={task.id} index={index}>
                      {(dp) => (
                        <div
                          ref={dp.innerRef}
                          {...dp.draggableProps}
                          {...dp.dragHandleProps}
                          className="mb-2 last:mb-0"
                        >
                          <TaskCard
                            task={task}
                            categories={categories}
                            onClick={() => onTaskClick(task.id)}
                          />
                        </div>
                      )}
                    </Draggable>
                  ))}
                  <div
                    className={cn(
                      !snapshot.isDraggingOver &&
                        snapshot.draggingFromThisWith &&
                        "hidden"
                    )}
                  >
                    {provided.placeholder}
                  </div>
                </div>
              )}
            </Droppable>
          );
        })}
    </>
  );
});
