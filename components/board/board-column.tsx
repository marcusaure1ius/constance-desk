"use client";

import { Droppable, Draggable } from "@hello-pangea/dnd";
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
}

export function BoardColumn({
  column,
  tasks,
  categories,
  onTaskClick,
}: BoardColumnProps) {
  return (
    <div className="flex w-72 flex-shrink-0 flex-col rounded-lg bg-muted/50 p-2">
      <div className="mb-2 flex items-center justify-between px-2">
        <h3 className="text-sm font-semibold">{column.title}</h3>
        <span className="text-xs text-muted-foreground">{tasks.length}</span>
      </div>
      <Droppable droppableId={column.id}>
        {(provided, snapshot) => (
          <div
            ref={provided.innerRef}
            {...provided.droppableProps}
            className={cn(
              "flex min-h-[100px] flex-1 flex-col gap-2 rounded-md p-1 transition-colors",
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
            {provided.placeholder}
          </div>
        )}
      </Droppable>
    </div>
  );
}
