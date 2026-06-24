"use client";

import { Plus } from "lucide-react";
import { EpicSwimlane } from "./epic-swimlane";
import { useBoardView } from "@/hooks/use-board-view";
import { buildLanes, catKey } from "@/lib/board/epics";

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

interface EpicsBoardProps {
  columns: { id: string; title: string }[];
  tasks: SwimlaneTask[];
  categories: { id: string; name: string; color: string | null }[];
  onTaskClick: (taskId: string) => void;
  onCreateTask?: (columnId: string) => void;
}

export function EpicsBoard({
  columns,
  tasks,
  categories,
  onTaskClick,
  onCreateTask,
}: EpicsBoardProps) {
  const { toggleCollapsed, isCollapsed } = useBoardView();
  const lanes = buildLanes(categories, tasks);
  const lastColumnId = columns[columns.length - 1]?.id;
  const gridCols = {
    gridTemplateColumns: `repeat(${columns.length}, minmax(200px, 1fr))`,
  };

  return (
    <div className="overflow-x-auto container mx-auto px-4 py-4 pb-36 h-full">
      <div className="relative">
        {/* Фоновые полосы колонок на всю высоту (выровнены с сеткой контента) */}
        <div className="absolute inset-0 flex gap-4" aria-hidden>
          {columns.map((col) => (
            <div
              key={col.id}
              className="flex-1 min-w-[200px] rounded-lg bg-muted/50"
            />
          ))}
        </div>

        {/* Контент поверх полос */}
        <div className="relative grid gap-x-4 gap-y-1" style={gridCols}>
          {/* Строка названий колонок */}
          {columns.map((col) => {
            const count = tasks.filter((t) => t.columnId === col.id).length;
            return (
              <div
                key={col.id}
                className="flex items-center justify-between px-4 pt-2 pb-1"
              >
                <h3 className="text-sm font-semibold">{col.title}</h3>
                <span className="inline-flex items-center justify-center size-5 rounded-full bg-muted-foreground/15 text-xs">
                  {count}
                </span>
              </div>
            );
          })}

          {/* Строка быстрого добавления — над всеми дорожками, по кнопке на колонку */}
          {columns.map((col) => (
            <button
              key={col.id}
              onClick={() => onCreateTask?.(col.id)}
              className="mx-3 mb-1 flex items-center justify-center rounded-lg border-2 border-dashed border-muted-foreground/20 py-3 hover:border-muted-foreground/40 hover:bg-muted/60 transition-colors cursor-pointer"
            >
              <div className="flex items-center justify-center size-6 rounded-full border-2 border-muted-foreground/30 text-muted-foreground/40">
                <Plus className="size-3.5" />
              </div>
            </button>
          ))}

          {/* Дорожки */}
          {lanes.map((lane) => {
            const laneTasks = tasks.filter(
              (t) => catKey(t.categoryId) === lane.key
            );
            return (
              <EpicSwimlane
                key={lane.key}
                laneKey={lane.key}
                title={lane.category ? lane.category.name : "Без эпика"}
                color={lane.category?.color ?? null}
                columns={columns}
                tasks={laneTasks}
                categories={categories}
                lastColumnId={lastColumnId}
                collapsed={isCollapsed(lane.key)}
                onToggleCollapsed={toggleCollapsed}
                onTaskClick={onTaskClick}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
