"use client";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@/components/ui/card";
import type { ExtendedReportTask } from "@/lib/services/reports";

interface ReportTablesProps {
  carryoverTasks: ExtendedReportTask[];
  newTasks: ExtendedReportTask[];
}

function StatusBadge({ completedAt }: { completedAt: Date | null }) {
  if (completedAt) {
    return (
      <Badge className="bg-green-500/10 text-green-600 dark:text-green-400 border-transparent">
        Готово
      </Badge>
    );
  }
  return (
    <Badge className="bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border-transparent">
      В работе
    </Badge>
  );
}

function TaskTable({
  title,
  tasks,
  emptyMessage,
}: {
  title: string;
  tasks: ExtendedReportTask[];
  emptyMessage: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {tasks.length === 0 ? (
          <p className="text-sm text-muted-foreground">{emptyMessage}</p>
        ) : (
          <div className="space-y-2">
            {tasks.map((task) => (
              <div
                key={task.id}
                className="flex items-center justify-between gap-2 rounded-lg border p-2.5 text-sm"
              >
                <div className="flex-1 min-w-0">
                  <span className="font-medium leading-snug line-clamp-1">
                    {task.title}
                  </span>
                  {task.categoryName && (
                    <span className="text-xs text-muted-foreground ml-2">
                      {task.categoryName}
                    </span>
                  )}
                </div>
                <StatusBadge completedAt={task.completedAt} />
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function ReportTables({ carryoverTasks, newTasks }: ReportTablesProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      <TaskTable
        title="Переходящие задачи"
        tasks={carryoverTasks}
        emptyMessage="Нет переходящих задач."
      />
      <TaskTable
        title="Новые задачи"
        tasks={newTasks}
        emptyMessage="Нет новых задач за эту неделю."
      />
    </div>
  );
}
