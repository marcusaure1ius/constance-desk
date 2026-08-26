"use client";

import { useState, useEffect, useTransition, useMemo, useCallback, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useSearchParams, useRouter } from "next/navigation";
import { DragDropContext, type DropResult } from "@hello-pangea/dnd";
import { Plus, ChevronDown, ChevronRight, Archive } from "lucide-react";
import { BoardColumn } from "./board-column";
import { SwipeableTaskCard } from "./swipeable-task-card";
import { moveTaskAction } from "@/lib/actions/tasks";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { CreateTaskModal } from "@/components/modals/create-task-modal";
import { MoveTaskModal } from "@/components/modals/move-task-modal";
import { ArchiveModal } from "@/components/modals/archive-modal";
import { TaskEditDialog } from "./task-edit-dialog";
import { AgentChat } from "@/components/agent/agent-chat";
import { SmartInputSheet } from "@/components/smart-input/smart-input-sheet";
import { BoardFilter } from "@/components/board/board-filter";
import { BoardViewToggle } from "@/components/board/board-view-toggle";
import { EpicsBoard } from "@/components/board/epics-board";
import { useBoardFilter } from "@/hooks/use-board-filter";
import { useBoardView } from "@/hooks/use-board-view";
import { parseDroppableId, cellIndexToColumnPosition, buildLanes, catKey } from "@/lib/board/epics";

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
  environmentId: string;
}

function MobileColumnTabs({
  columns,
  activeTab,
  setActiveTab,
  tasksByColumn,
}: {
  columns: Column[];
  activeTab: string | undefined;
  setActiveTab: (id: string) => void;
  tasksByColumn: Map<string, Task[]>;
}) {
  const slot = useSyncExternalStore(
    () => () => {},
    () => document.getElementById("navbar-tabs-slot"),
    () => null
  );

  if (!slot) return null;

  return createPortal(
    <div className="flex items-center gap-0.5 rounded-full bg-muted/50 p-1 mx-3 mb-2 overflow-x-auto">
      {columns.map((col) => (
        <button
          key={col.id}
          onClick={() => setActiveTab(col.id)}
          className={cn(
            "flex-1 flex items-center justify-between gap-1.5 px-3 py-1 text-sm font-medium rounded-full whitespace-nowrap transition-colors",
            activeTab === col.id
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground"
          )}
        >
          {col.title}
          <span className="inline-flex items-center justify-center size-5 rounded-full bg-muted-foreground/15 text-xs">
            {(tasksByColumn.get(col.id) ?? []).length}
          </span>
        </button>
      ))}
    </div>,
    slot
  );
}

export function KanbanBoard({
  columns,
  tasks: initialTasks,
  categories,
  environmentId,
}: KanbanBoardProps) {
  const [tasks, setTasks] = useState(initialTasks);
  useEffect(() => { setTasks(initialTasks); }, [initialTasks]);
  const [, startTransition] = useTransition();
  const [activeTab, setActiveTab] = useState(columns[0]?.id);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createColumnId, setCreateColumnId] = useState<string | undefined>(undefined);
  const [smartInputOpen, setSmartInputOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [movingTaskId, setMovingTaskId] = useState<string | null>(null);
  const editingTask = editingTaskId ? tasks.find((t) => t.id === editingTaskId) : null;
  const movingTask = movingTaskId ? tasks.find((t) => t.id === movingTaskId) : null;
  const searchParams = useSearchParams();
  const router = useRouter();
  const searchQuery = searchParams.get("q")?.toLowerCase() ?? "";
  const { filterTask, config, hasFilters } = useBoardFilter();
  const filtersActive = config.active && hasFilters;
  const { mode, toggleCollapsed, isCollapsed, showEmptyEpics, agentLayout } = useBoardView();
  // Панель агента справа занимает 380px + отступ 24px: доска должна оставаться
  // слева, а не тянуться под неё (спека «доска остаётся слева»).
  const boardPad = agentLayout === "panel" ? "md:pr-[404px]" : "";

  useEffect(() => {
    if (searchParams.get("create") === "true") {
      setCreateModalOpen(true);
      router.replace("/", { scroll: false });
    }
  }, [searchParams, router]);

  useEffect(() => {
    if (searchParams.get("smart-input") === "true") {
      setSmartInputOpen(true);
      router.replace("/", { scroll: false });
    }
  }, [searchParams, router]);

  const tasksByColumn = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const col of columns) {
      const filtered = tasks
        .filter((t) => t.columnId === col.id)
        .filter((t) => !searchQuery || t.title.toLowerCase().includes(searchQuery))
        .filter(filterTask)
        .sort((a, b) => a.position - b.position);
      map.set(col.id, filtered);
    }
    return map;
  }, [tasks, columns, searchQuery, filterTask]);

  const filteredCount = searchQuery
    ? Array.from(tasksByColumn.values()).reduce((sum, arr) => sum + arr.length, 0)
    : 0;

  const handleDragEnd = useCallback(function handleDragEnd(result: DropResult) {
    const { source, destination, draggableId } = result;
    if (!destination) return;
    if (
      source.droppableId === destination.droppableId &&
      source.index === destination.index
    )
      return;

    // В режиме эпиков droppableId составной: "columnId__catKey".
    const isEpics = destination.droppableId.includes("__");
    const srcColumnId = isEpics
      ? parseDroppableId(source.droppableId).columnId
      : source.droppableId;
    const dest = isEpics
      ? parseDroppableId(destination.droppableId)
      : { columnId: destination.droppableId, catKey: "" };
    const destColumnId = dest.columnId;
    const destIndex = isEpics
      ? cellIndexToColumnPosition(
          tasks,
          draggableId,
          dest.columnId,
          dest.catKey,
          destination.index
        )
      : destination.index;

    // Optimistic update
    const previousTasks = tasks;
    setTasks((prev) => {
      const updated = prev.map((t) => ({ ...t }));
      const taskIndex = updated.findIndex((t) => t.id === draggableId);
      if (taskIndex === -1) return prev;

      const movedTask = updated[taskIndex];

      const sourceTasks = updated
        .filter((t) => t.columnId === srcColumnId && t.id !== draggableId)
        .sort((a, b) => a.position - b.position);
      sourceTasks.forEach((t, i) => {
        t.position = i;
      });

      movedTask.columnId = destColumnId;

      const destTasks = updated
        .filter((t) => t.columnId === destColumnId && t.id !== draggableId)
        .sort((a, b) => a.position - b.position);
      destTasks.splice(destIndex, 0, movedTask);
      destTasks.forEach((t, i) => {
        t.position = i;
      });

      return updated;
    });

    // Server update
    startTransition(async () => {
      try {
        await moveTaskAction(draggableId, destColumnId, destIndex);
      } catch {
        setTasks(previousTasks);
        toast.error("Не удалось переместить задачу");
      }
    });
  }, [tasks, startTransition]);

  const handleMoveTask = useCallback((taskId: string, targetColumnId: string) => {
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;

    const destTasks = tasks.filter((t) => t.columnId === targetColumnId);
    const newPosition = destTasks.length;

    // Optimistic update
    setTasks((prev) =>
      prev.map((t) =>
        t.id === taskId
          ? { ...t, columnId: targetColumnId, position: newPosition }
          : t
      )
    );

    startTransition(async () => {
      try {
        await moveTaskAction(taskId, targetColumnId, newPosition);
      } catch {
        setTasks(tasks);
        toast.error("Не удалось переместить задачу");
      }
    });
  }, [tasks, startTransition]);

  return (
    <>
      <div className="hidden md:flex items-center justify-between container mx-auto px-4 pt-4">
        <div className="flex items-center gap-2">
          <Button className="h-9" onClick={() => { setCreateColumnId(undefined); setCreateModalOpen(true); }}>
            <Plus className="mr-2 h-4 w-4" />
            Добавить задачу
          </Button>
          <BoardFilter />
          <BoardViewToggle />
        </div>
        <div className="flex items-center gap-2">
          {searchQuery && (
            <span className="text-sm text-muted-foreground">
              Найдено: {filteredCount}
            </span>
          )}
          <Button
            variant="outline"
            className="h-9"
            onClick={() => setArchiveOpen(true)}
          >
            <Archive className="mr-2 h-4 w-4" />
            Архив
          </Button>
        </div>
      </div>

      <DragDropContext onDragEnd={searchQuery || filtersActive ? () => {} : handleDragEnd}>
        {/* Desktop: вид колонок или дорожек-эпиков */}
        {mode === "epics" ? (
          <div className={cn("hidden md:block h-full", boardPad)}>
            <EpicsBoard
              columns={columns}
              tasks={Array.from(tasksByColumn.values()).flat()}
              categories={categories}
              onTaskClick={setEditingTaskId}
              onCreateTask={(columnId) => {
                setCreateColumnId(columnId);
                setCreateModalOpen(true);
              }}
            />
          </div>
        ) : (
          <div
            className={cn(
              "hidden md:flex gap-4 overflow-x-auto container mx-auto px-4 py-4 pb-36 h-full",
              boardPad
            )}
          >
            {columns.map((col) => (
              <BoardColumn
                key={col.id}
                column={col}
                tasks={(tasksByColumn.get(col.id) ?? [])}
                categories={categories}
                onTaskClick={setEditingTaskId}
                onCreateTask={(columnId) => {
                  setCreateColumnId(columnId);
                  setCreateModalOpen(true);
                }}
              />
            ))}
          </div>
        )}
      </DragDropContext>

      {/* Агент: лента снизу или панель справа — раскладка из настроек */}
      <AgentChat environmentId={environmentId} />

      {/* Mobile: tabs portal into navbar */}
      <MobileColumnTabs
        columns={columns}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        tasksByColumn={tasksByColumn}
      />

      {/* Mobile: task list */}
      <div className="md:hidden p-4 space-y-2">
        {activeTab && (
          <>
            <button
              onClick={() => {
                setCreateColumnId(activeTab);
                setCreateModalOpen(true);
              }}
              className="w-full flex items-center justify-center rounded-lg border-2 border-dashed border-muted-foreground/20 py-3 active:border-muted-foreground/40 active:bg-muted/50 transition-colors"
            >
              <div className="flex items-center justify-center size-6 rounded-full border-2 border-muted-foreground/30 text-muted-foreground/40">
                <Plus className="size-3.5" />
              </div>
            </button>
            {mode === "columns" ? (
              (tasksByColumn.get(activeTab) ?? []).map((task) => (
                <SwipeableTaskCard
                  key={task.id}
                  task={task}
                  categories={categories}
                  onClick={() => setEditingTaskId(task.id)}
                  onMovePress={() => setMovingTaskId(task.id)}
                />
              ))
            ) : (
              buildLanes(
                categories,
                tasksByColumn.get(activeTab) ?? [],
                { showEmpty: showEmptyEpics }
              ).map((lane) => {
                const laneTasks = (tasksByColumn.get(activeTab) ?? []).filter(
                  (t) => catKey(t.categoryId) === lane.key
                );
                const collapsed = isCollapsed(lane.key);
                return (
                  <div key={lane.key} className="space-y-2">
                    <button
                      onClick={() => toggleCollapsed(lane.key)}
                      className="w-full flex items-center gap-2 rounded-md bg-muted/60 px-3 py-2 text-left"
                    >
                      {collapsed ? (
                        <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                      ) : (
                        <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
                      )}
                      {lane.category?.color && (
                        <span
                          className="size-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: lane.category.color }}
                        />
                      )}
                      <span className="text-sm font-semibold">
                        {lane.category ? lane.category.name : "Без эпика"}
                      </span>
                      <span className="ml-1 text-xs text-muted-foreground">
                        {laneTasks.length}
                      </span>
                    </button>
                    {!collapsed &&
                      laneTasks.map((task) => (
                        <SwipeableTaskCard
                          key={task.id}
                          task={task}
                          categories={categories}
                          onClick={() => setEditingTaskId(task.id)}
                          onMovePress={() => setMovingTaskId(task.id)}
                        />
                      ))}
                  </div>
                );
              })
            )}
          </>
        )}
      </div>

      <CreateTaskModal
        open={createModalOpen}
        onOpenChange={(open) => {
          setCreateModalOpen(open);
          if (!open) setCreateColumnId(undefined);
        }}
        columns={columns}
        categories={categories}
        defaultColumnId={createColumnId ?? columns[0]?.id}
      />

      {editingTask && (
        <TaskEditDialog
          task={editingTask}
          categories={categories}
          open={true}
          onOpenChange={(open) => {
            if (!open) setEditingTaskId(null);
          }}
        />
      )}

      {movingTask && (
        <MoveTaskModal
          open={true}
          onOpenChange={(open) => {
            if (!open) setMovingTaskId(null);
          }}
          columns={columns}
          currentColumnId={movingTask.columnId}
          onSelect={(columnId) => handleMoveTask(movingTask.id, columnId)}
        />
      )}

      <SmartInputSheet
        open={smartInputOpen}
        onOpenChange={setSmartInputOpen}
        defaultColumnId={columns[0]?.id ?? ""}
      />

      <ArchiveModal
        open={archiveOpen}
        onOpenChange={setArchiveOpen}
        environmentId={environmentId}
        categories={categories}
      />
    </>
  );
}
