"use client";

import { useState, useTransition } from "react";
import { Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SwipeableTaskCard } from "@/components/board/swipeable-task-card";
import { TaskEditDialog } from "@/components/board/task-edit-dialog";
import { MoveTaskModal } from "@/components/modals/move-task-modal";
import { addToPlanAction } from "@/lib/actions/today";
import type { TodayBriefing as TodayBriefingType } from "@/lib/services/today";

type Column = { id: string; title: string; position: number };
type Category = { id: string; name: string; color: string | null };

interface TodayBriefingProps {
  briefing: TodayBriefingType;
  columns: Column[];
  categories: Category[];
}

const priorityBgColors: Record<string, string> = {
  urgent: "bg-red-500",
  high: "bg-yellow-500",
  normal: "bg-gray-400",
};

function formatDateRu(dateStr: string): string {
  const date = new Date(dateStr + "T12:00:00");
  return date.toLocaleDateString("ru-RU", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

function formatDateRuShort(dateStr: string): string {
  const date = new Date(dateStr + "T12:00:00");
  return date.toLocaleDateString("ru-RU", {
    weekday: "short",
    day: "numeric",
    month: "long",
  });
}

export function TodayBriefing({
  briefing,
  columns,
  categories,
}: TodayBriefingProps) {
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [movingTaskId, setMovingTaskId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [pendingTaskId, setPendingTaskId] = useState<string | null>(null);

  const allTasks = [
    ...briefing.inProgress,
    ...briefing.planned,
    ...briefing.completed,
    ...briefing.suggestions,
  ];
  const editingTask = editingTaskId
    ? allTasks.find((t) => t.id === editingTaskId) ?? null
    : null;
  const movingTask = movingTaskId
    ? allTasks.find((t) => t.id === movingTaskId) ?? null
    : null;

  const { done, total } = briefing.progress;
  const percentage = total > 0 ? Math.round((done / total) * 100) : 0;

  function handleAddToPlan(taskId: string) {
    setPendingTaskId(taskId);
    startTransition(async () => {
      await addToPlanAction(taskId);
      setPendingTaskId(null);
    });
  }

  return (
    <div className="max-w-[640px] mx-auto px-4 md:px-6 py-6 md:py-8 pb-20 md:pb-8">
      {/* Шапка */}
      <div className="flex items-start justify-between mb-4">
        <div>
          <h1 className="text-xl md:text-2xl font-bold">
            <span className="hidden md:inline">
              {formatDateRu(briefing.date)}
            </span>
            <span className="md:hidden">
              {formatDateRuShort(briefing.date)}
            </span>
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {total} {taskWord(total)} · {done} {doneWord(done)}
          </p>
        </div>
        {total > 0 && (
          <div
            className="relative size-10 flex-shrink-0 rounded-full"
            style={{
              background: `conic-gradient(var(--color-primary) 0% ${percentage}%, var(--color-muted) ${percentage}% 100%)`,
            }}
          >
            <div className="absolute inset-[5px] rounded-full bg-background flex items-center justify-center text-xs font-semibold text-primary">
              {done}/{total}
            </div>
          </div>
        )}
      </div>

      {/* Прогресс-бар */}
      {total > 0 && (
        <div className="h-[3px] bg-muted rounded-full mb-6 md:mb-8 overflow-hidden">
          <div
            className="h-full bg-primary rounded-full transition-all"
            style={{ width: `${percentage}%` }}
          />
        </div>
      )}

      {/* Секция: Завершить */}
      {briefing.inProgress.length > 0 && (
        <Section
          title={`Завершить · ${briefing.inProgress.length}`}
          dotColor="bg-red-500"
          titleColor="text-red-500"
        >
          <TaskGroup>
            {briefing.inProgress.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                categories={categories}
                subtitle={`${task.columnTitle} · ${priorityLabel(task.priority)}`}
                onClick={() => setEditingTaskId(task.id)}
                onMovePress={() => setMovingTaskId(task.id)}
              />
            ))}
          </TaskGroup>
        </Section>
      )}

      {/* Секция: Запланировано */}
      {briefing.planned.length > 0 && (
        <Section
          title={`Запланировано · ${briefing.planned.length}`}
          dotColor="bg-blue-500"
          titleColor="text-blue-500"
        >
          <TaskGroup>
            {briefing.planned.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                categories={categories}
                subtitle={`Бэклог · ${priorityLabel(task.priority)}`}
                onClick={() => setEditingTaskId(task.id)}
                onMovePress={() => setMovingTaskId(task.id)}
              />
            ))}
          </TaskGroup>
        </Section>
      )}

      {/* Секция: Выполнено */}
      {briefing.completed.length > 0 && (
        <Section
          title={`Выполнено · ${briefing.completed.length}`}
          dotColor="bg-green-500"
          titleColor="text-green-500"
        >
          <TaskGroup className="opacity-50">
            {briefing.completed.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                categories={categories}
                subtitle="Готово ✓"
                strikethrough
                onClick={() => setEditingTaskId(task.id)}
                onMovePress={() => setMovingTaskId(task.id)}
              />
            ))}
          </TaskGroup>
        </Section>
      )}

      {/* Разделитель + Можно взять */}
      {briefing.suggestions.length > 0 && (
        <>
          <div className="h-px bg-border my-6 md:my-7" />
          <Section
            title="Можно взять из бэклога"
            dotColor="bg-muted-foreground"
            titleColor="text-muted-foreground"
          >
            <p className="text-xs text-muted-foreground/60 mb-3">
              Топ по приоритету без плановой даты
            </p>
            <div className="rounded-lg border border-dashed overflow-hidden">
              {briefing.suggestions.map((task, i) => (
                <div
                  key={task.id}
                  className={`flex items-center gap-3 px-4 py-3 ${
                    i < briefing.suggestions.length - 1
                      ? "border-b border-dashed"
                      : ""
                  }`}
                >
                  <div
                    className={`w-[3px] h-8 rounded-full flex-shrink-0 ${
                      priorityBgColors[task.priority] ?? "bg-gray-400"
                    }`}
                  />
                  <div
                    className="flex-1 min-w-0 cursor-pointer"
                    onClick={() => setEditingTaskId(task.id)}
                  >
                    <p className="text-sm text-muted-foreground font-medium truncate">
                      {task.title}
                    </p>
                    <p className="text-xs text-muted-foreground/60 mt-0.5">
                      Бэклог · {priorityLabel(task.priority)}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs text-primary shrink-0"
                    disabled={isPending && pendingTaskId === task.id}
                    onClick={() => handleAddToPlan(task.id)}
                  >
                    {isPending && pendingTaskId === task.id
                      ? "..."
                      : "+ В план"}
                  </Button>
                </div>
              ))}
            </div>
          </Section>
        </>
      )}

      {/* Пустое состояние */}
      {total === 0 && briefing.suggestions.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
          <Sun className="size-10 mb-3 opacity-30" />
          <p className="text-sm">Нет задач на сегодня</p>
        </div>
      )}

      {/* Модалки */}
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
          onSelect={async (columnId) => {
            const { moveTaskAction } = await import("@/lib/actions/tasks");
            const allBriefingTasks = [
              ...briefing.inProgress,
              ...briefing.planned,
              ...briefing.completed,
            ];
            const destTasks = allBriefingTasks.filter(
              (t) => t.columnId === columnId
            );
            await moveTaskAction(movingTask.id, columnId, destTasks.length);
            setMovingTaskId(null);
          }}
        />
      )}
    </div>
  );
}

/* --- Helper Components --- */

function Section({
  title,
  dotColor,
  titleColor,
  children,
}: {
  title: string;
  dotColor: string;
  titleColor: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-5 md:mb-7">
      <div
        className={`flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider mb-3 ${titleColor}`}
      >
        <div className={`size-1.5 rounded-full ${dotColor}`} />
        {title}
      </div>
      {children}
    </div>
  );
}

function TaskGroup({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-lg border overflow-hidden ${className ?? ""}`}>
      {children}
    </div>
  );
}

function TaskRow({
  task,
  categories,
  subtitle,
  strikethrough,
  onClick,
  onMovePress,
}: {
  task: TodayBriefingType["planned"][number] & { columnTitle?: string };
  categories: Category[];
  subtitle: string;
  strikethrough?: boolean;
  onClick: () => void;
  onMovePress: () => void;
}) {
  return (
    <div className="border-b last:border-b-0">
      {/* Desktop */}
      <div
        className="hidden md:flex items-center gap-3 px-4 py-3.5 cursor-pointer hover:bg-muted/50 transition-colors"
        onClick={onClick}
      >
        <div
          className={`w-[3px] h-8 rounded-full flex-shrink-0 ${
            priorityBgColors[task.priority] ?? "bg-gray-400"
          }`}
        />
        <div className="flex-1 min-w-0">
          <p
            className={`text-sm font-medium truncate ${
              strikethrough ? "line-through" : ""
            }`}
          >
            {task.title}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
        </div>
      </div>
      {/* Mobile: swipeable */}
      <div className="md:hidden">
        <SwipeableTaskCard
          task={task}
          categories={categories}
          onClick={onClick}
          onMovePress={onMovePress}
        />
      </div>
    </div>
  );
}

/* --- Utilities --- */

function priorityLabel(p: string): string {
  return p === "urgent" ? "Срочный" : p === "high" ? "Высокий" : "Обычный";
}

function taskWord(n: number): string {
  const r = n % 10;
  if (n >= 11 && n <= 14) return "задач";
  if (r === 1) return "задача";
  if (r >= 2 && r <= 4) return "задачи";
  return "задач";
}

function doneWord(n: number): string {
  const r = n % 10;
  if (n >= 11 && n <= 14) return "выполнено";
  if (r === 1) return "выполнена";
  return "выполнено";
}
