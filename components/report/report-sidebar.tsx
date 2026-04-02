"use client";

import * as React from "react";
import { format, addWeeks, subWeeks, startOfWeek, endOfWeek } from "date-fns";
import { ru } from "date-fns/locale";
import { ChevronLeft, ChevronRight, Copy } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getReportAction, getReportTextAction } from "@/lib/actions/tasks";
import type { WeeklyReport } from "@/lib/services/reports";

interface ReportSidebarProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ReportSidebar({ open, onOpenChange }: ReportSidebarProps) {
  const [currentDate, setCurrentDate] = React.useState(() => new Date());
  const [report, setReport] = React.useState<WeeklyReport | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [copying, setCopying] = React.useState(false);

  const weekStart = startOfWeek(currentDate, { weekStartsOn: 1 });
  const weekEnd = endOfWeek(currentDate, { weekStartsOn: 1 });

  const weekLabel = `${format(weekStart, "d MMMM", { locale: ru })} — ${format(weekEnd, "d MMMM yyyy", { locale: ru })}`;

  const isCurrentWeek = React.useMemo(() => {
    const now = new Date();
    const nowStart = startOfWeek(now, { weekStartsOn: 1 });
    return weekStart.getTime() === nowStart.getTime();
  }, [weekStart]);

  React.useEffect(() => {
    if (!open) return;
    setLoading(true);
    getReportAction(currentDate.toISOString())
      .then((data) => setReport(data))
      .finally(() => setLoading(false));
  }, [open, currentDate]);

  function goToPrevWeek() {
    setCurrentDate((d) => subWeeks(d, 1));
  }

  function goToNextWeek() {
    setCurrentDate((d) => addWeeks(d, 1));
  }

  function goToCurrentWeek() {
    setCurrentDate(new Date());
  }

  async function handleCopy() {
    setCopying(true);
    try {
      const text = await getReportTextAction(currentDate.toISOString());
      await navigator.clipboard.writeText(text);
    } finally {
      setCopying(false);
    }
  }

  const completed = report?.completedCount ?? 0;
  const started = report?.startedCount ?? 0;
  const progressPercent = started > 0 ? Math.round((completed / started) * 100) : 0;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex flex-col w-full sm:max-w-md overflow-y-auto">
        <SheetHeader className="pb-2">
          <SheetTitle>Отчёт за неделю</SheetTitle>
        </SheetHeader>

        {/* Week navigation */}
        <div className="flex items-center gap-2 px-4 pb-2">
          <Button variant="ghost" size="icon-sm" onClick={goToPrevWeek} aria-label="Предыдущая неделя">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="flex-1 text-center text-sm font-medium">{weekLabel}</span>
          <Button variant="ghost" size="icon-sm" onClick={goToNextWeek} aria-label="Следующая неделя">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        {!isCurrentWeek && (
          <div className="px-4 pb-2">
            <Button variant="outline" size="sm" className="w-full" onClick={goToCurrentWeek}>
              Текущая неделя
            </Button>
          </div>
        )}

        {loading ? (
          <div className="flex flex-1 items-center justify-center px-4 py-8 text-sm text-muted-foreground">
            Загрузка…
          </div>
        ) : (
          <>
            {/* Summary */}
            <div className="px-4 pb-4">
              <p className="mb-2 text-sm text-muted-foreground">
                Выполнено: {completed} из {started} задач
              </p>
              <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
                <div
                  className="h-full bg-primary transition-all"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
            </div>

            {/* Task list */}
            <div className="flex-1 overflow-y-auto px-4 pb-4">
              {report && report.completedTasks.length === 0 ? (
                <p className="text-sm text-muted-foreground">Нет выполненных задач за эту неделю.</p>
              ) : (
                <ul className="space-y-3">
                  {report?.completedTasks.map((task) => (
                    <li key={task.id} className="rounded-lg border bg-card p-3 text-sm">
                      <div className="flex items-start justify-between gap-2">
                        <span className="font-medium leading-snug">{task.title}</span>
                        {task.categoryName && (
                          <Badge variant="secondary" className="shrink-0">
                            {task.categoryName}
                          </Badge>
                        )}
                      </div>
                      {task.description && (
                        <p className="mt-1 text-muted-foreground line-clamp-2">{task.description}</p>
                      )}
                      <p className="mt-1.5 text-xs text-muted-foreground">
                        {format(task.completedAt, "d MMMM yyyy", { locale: ru })}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Copy button */}
            <div className="px-4 pb-4">
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={handleCopy}
                disabled={copying}
              >
                <Copy className="mr-2 h-4 w-4" />
                {copying ? "Копирование…" : "Копировать текст"}
              </Button>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
