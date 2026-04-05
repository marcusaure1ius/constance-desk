"use client";

import { format } from "date-fns";
import { ru } from "date-fns/locale";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import type { ExtendedReportTask } from "@/lib/services/reports";

interface CompletedListProps {
  completedTasks: ExtendedReportTask[];
  totalTasks: number;
}

export function CompletedList({ completedTasks, totalTasks }: CompletedListProps) {
  const completedCount = completedTasks.length;
  const progressPercent = totalTasks > 0 ? Math.round((completedCount / totalTasks) * 100) : 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Выполнено</CardTitle>
        <CardDescription>
          {completedCount} из {totalTasks} задач ({progressPercent}%)
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Progress bar */}
        <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
          <div
            className="h-full bg-green-500 transition-all"
            style={{ width: `${progressPercent}%` }}
          />
        </div>

        {/* Task list */}
        {completedTasks.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Нет выполненных задач за эту неделю.
          </p>
        ) : (
          <ul className="space-y-2">
            {completedTasks.map((task) => (
              <li
                key={task.id}
                className="rounded-lg border p-2.5 text-sm"
              >
                <span className="font-medium leading-snug line-clamp-2">
                  {task.title}
                </span>
                {task.completedAt && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {format(new Date(task.completedAt), "d MMMM", { locale: ru })}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
