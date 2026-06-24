"use client";

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
}

export function EpicsBoard({
  columns,
  tasks,
  categories,
  onTaskClick,
}: EpicsBoardProps) {
  const { toggleCollapsed, isCollapsed } = useBoardView();
  const lanes = buildLanes(categories, tasks);
  const lastColumnId = columns[columns.length - 1]?.id;

  return (
    <div className="overflow-x-auto container mx-auto px-4 py-4 pb-36 h-full">
      <div
        className="grid gap-x-4 gap-y-1 min-w-max"
        style={{
          gridTemplateColumns: `repeat(${columns.length}, minmax(220px, 1fr))`,
        }}
      >
        {/* Строка названий колонок */}
        {columns.map((col) => (
          <div key={col.id} className="px-2 pb-1 text-sm font-semibold">
            {col.title}
          </div>
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
  );
}
