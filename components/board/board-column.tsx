"use client";

import { memo } from "react";
import { Droppable, Draggable } from "@hello-pangea/dnd";
import { Plus } from "lucide-react";
import { TaskCard } from "./task-card";
import { cn } from "@/lib/utils";

type Task = {
  id: string;
  title: string;
  description: string | null;
  priority: "urgent" | "high" | "normal";
  categoryId: string | null;
  plannedDate: string | null;
  completedAt: Date | null;
  position: number;
};

type Category = {
  id: string;
  name: string;
  color: string | null;
};

interface BoardColumnProps {
  column: { id: string; title: string };
  tasks: Task[];
  categories: Category[];
  onTaskClick?: (taskId: string) => void;
  onCreateTask?: (columnId: string) => void;
}

export const BoardColumn = memo(function BoardColumn({
  column,
  tasks,
  categories,
  onTaskClick,
  onCreateTask,
}: BoardColumnProps) {
  return (
    <div className="flex flex-1 min-w-[200px] flex-col rounded-lg bg-muted/50 p-2">
      <div className="mb-2 flex items-center justify-between px-2">
        <h3 className="text-sm font-semibold">{column.title}</h3>
        <span className="inline-flex items-center justify-center size-5 rounded-full bg-muted-foreground/15 text-xs">
          {tasks.length}
        </span>
      </div>
      {onCreateTask && (
        <button
          onClick={() => onCreateTask(column.id)}
          className="mb-2 mx-1 flex items-center justify-center rounded-lg border-2 border-dashed border-muted-foreground/20 py-3 hover:border-muted-foreground/40 hover:bg-muted/50 transition-colors cursor-pointer"
        >
          <div className="flex items-center justify-center size-6 rounded-full border-2 border-muted-foreground/30 text-muted-foreground/40">
            <Plus className="size-3.5" />
          </div>
        </button>
      )}
      <Droppable droppableId={column.id}>
        {(provided, snapshot) => (
          <div
            ref={provided.innerRef}
            {...provided.droppableProps}
            className={cn(
              "flex min-h-[100px] flex-1 flex-col rounded-md p-1 transition-colors",
              snapshot.isDraggingOver && "bg-muted"
            )}
          >
            {tasks.map((task, index) => (
              <Draggable key={task.id} draggableId={task.id} index={index}>
                {(provided) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.draggableProps}
                    {...provided.dragHandleProps}
                    className="mb-2 last:mb-0"
                  >
                    <TaskCard
                      task={task}
                      categories={categories}
                      onClick={() => onTaskClick?.(task.id)}
                    />
                  </div>
                )}
              </Draggable>
            ))}
            <div className={cn(!snapshot.isDraggingOver && snapshot.draggingFromThisWith && "hidden")}>
              {provided.placeholder}
            </div>
          </div>
        )}
      </Droppable>
    </div>
  );
});
