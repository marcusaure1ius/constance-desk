"use client";

import { useState, useTransition, useEffect } from "react";
import { DragDropContext, type DropResult } from "@hello-pangea/dnd";
import { BoardColumn } from "./board-column";
import { TaskCard } from "./task-card";
import { moveTaskAction } from "@/lib/actions/tasks";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type Column = { id: string; title: string; position: number };
type Task = {
  id: string;
  title: string;
  description: string | null;
  columnId: string;
  categoryId: string | null;
  priority: "urgent" | "high" | "normal";
  position: number;
  startDate: string;
  plannedDate: string | null;
  completedAt: Date | null;
};
type Category = { id: string; name: string; color: string | null };

interface KanbanBoardProps {
  columns: Column[];
  tasks: Task[];
  categories: Category[];
}

export function KanbanBoard({
  columns,
  tasks: initialTasks,
  categories,
}: KanbanBoardProps) {
  const [tasks, setTasks] = useState(initialTasks);
  const [isPending, startTransition] = useTransition();
  const [activeTab, setActiveTab] = useState(columns[0]?.id);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  function getTasksForColumn(columnId: string) {
    return tasks
      .filter((t) => t.columnId === columnId)
      .sort((a, b) => a.position - b.position);
  }

  function handleDragEnd(result: DropResult) {
    const { source, destination, draggableId } = result;
    if (!destination) return;
    if (
      source.droppableId === destination.droppableId &&
      source.index === destination.index
    )
      return;

    // Optimistic update
    const previousTasks = tasks;
    setTasks((prev) => {
      const updated = [...prev];
      const taskIndex = updated.findIndex((t) => t.id === draggableId);
      if (taskIndex === -1) return prev;

      const task = { ...updated[taskIndex] };
      task.columnId = destination.droppableId;
      task.position = destination.index;
      updated[taskIndex] = task;

      return updated;
    });

    // Server update
    startTransition(async () => {
      try {
        await moveTaskAction(
          draggableId,
          destination.droppableId,
          destination.index
        );
      } catch {
        setTasks(previousTasks);
        toast.error("Не удалось переместить задачу");
      }
    });
  }

  if (!mounted) {
    return (
      <div className="flex gap-4 overflow-x-auto p-4">
        {columns.map((col) => (
          <div
            key={col.id}
            className="flex w-72 flex-shrink-0 flex-col rounded-lg bg-muted/50 p-2"
          >
            <div className="mb-2 flex items-center justify-between px-2">
              <h3 className="text-sm font-semibold">{col.title}</h3>
              <span className="text-xs text-muted-foreground">
                {getTasksForColumn(col.id).length}
              </span>
            </div>
            <div className="flex min-h-[100px] flex-1 flex-col gap-2 rounded-md p-1" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <>
      <DragDropContext onDragEnd={handleDragEnd}>
        {/* Desktop: horizontal columns */}
        <div className="hidden md:flex gap-4 overflow-x-auto p-4 h-full">
          {columns.map((col) => (
            <BoardColumn
              key={col.id}
              column={col}
              tasks={getTasksForColumn(col.id)}
              categories={categories}
            />
          ))}
        </div>
      </DragDropContext>

      {/* Mobile: tabs */}
      <div className="md:hidden flex flex-col">
        <div className="flex border-b overflow-x-auto">
          {columns.map((col) => (
            <button
              key={col.id}
              onClick={() => setActiveTab(col.id)}
              className={cn(
                "px-4 py-2 text-sm font-medium whitespace-nowrap border-b-2 transition-colors",
                activeTab === col.id
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground"
              )}
            >
              {col.title} ({getTasksForColumn(col.id).length})
            </button>
          ))}
        </div>
        <div className="p-4 space-y-2">
          {activeTab &&
            getTasksForColumn(activeTab).map((task) => (
              <TaskCard key={task.id} task={task} categories={categories} />
            ))}
        </div>
      </div>
    </>
  );
}
