"use client";

import * as React from "react";
import { format, addWeeks, subWeeks, startOfWeek } from "date-fns";
import { ru } from "date-fns/locale";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ReportChart } from "@/components/report/report-chart";
import { ReportTables } from "@/components/report/report-tables";
import { CompletedList } from "@/components/report/completed-list";
import { ReportActions } from "@/components/report/report-actions";
import { getExtendedReportAction, getWeeklyTrendAction } from "@/lib/actions/tasks";
import type { ExtendedWeeklyReport, WeekTrendItem } from "@/lib/services/reports";

interface ReportPageProps {
  initialReport: ExtendedWeeklyReport;
  initialTrend: WeekTrendItem[];
  environmentId: string;
}

export function ReportPage({ initialReport, initialTrend, environmentId }: ReportPageProps) {
  const [currentDate, setCurrentDate] = React.useState(() => new Date());
  const [report, setReport] = React.useState<ExtendedWeeklyReport>(initialReport);
  const [trend, setTrend] = React.useState<WeekTrendItem[]>(initialTrend);
  const [loading, setLoading] = React.useState(false);
  const initialLoadDone = React.useRef(false);

  const weekStart = startOfWeek(currentDate, { weekStartsOn: 1 });
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);

  const weekLabel = `${format(weekStart, "d MMMM", { locale: ru })} — ${format(weekEnd, "d MMMM yyyy", { locale: ru })}`;

  const isCurrentWeek = React.useMemo(() => {
    const nowStart = startOfWeek(new Date(), { weekStartsOn: 1 });
    return weekStart.getTime() === nowStart.getTime();
  }, [weekStart]);

  React.useEffect(() => {
    // Skip the first render since we have initial data from the server
    if (!initialLoadDone.current) {
      initialLoadDone.current = true;
      return;
    }

    let cancelled = false;
    setLoading(true);

    Promise.all([
      getExtendedReportAction(currentDate.toISOString(), environmentId),
      getWeeklyTrendAction(currentDate.toISOString(), environmentId, 4),
    ])
      .then(([newReport, newTrend]) => {
        if (!cancelled) {
          setReport(newReport);
          setTrend(newTrend);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [currentDate, environmentId]);

  function goToPrevWeek() {
    setCurrentDate((d) => subWeeks(d, 1));
  }

  function goToNextWeek() {
    setCurrentDate((d) => addWeeks(d, 1));
  }

  function goToCurrentWeek() {
    setCurrentDate(new Date());
  }

  // Total unique tasks = carryover + new (deduplicated)
  const allTaskIds = new Set([
    ...report.carryoverTasks.map((t) => t.id),
    ...report.newTasks.map((t) => t.id),
  ]);
  const totalTasks = allTaskIds.size;

  return (
    <div className="container mx-auto px-4 py-6 space-y-6">
      {/* Header with navigation */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon-sm" onClick={goToPrevWeek} aria-label="Предыдущая неделя">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-lg sm:text-xl font-bold whitespace-nowrap">{weekLabel}</h1>
          <Button variant="ghost" size="icon-sm" onClick={goToNextWeek} aria-label="Следующая неделя">
            <ChevronRight className="h-4 w-4" />
          </Button>
          {!isCurrentWeek && (
            <Button variant="outline" size="sm" onClick={goToCurrentWeek} className="ml-2">
              Текущая неделя
            </Button>
          )}
        </div>
        <ReportActions report={report} environmentId={environmentId} />
      </div>

      {/* Content grid */}
      <div
        className={`grid grid-cols-1 lg:grid-cols-[3fr_1fr] gap-6 transition-opacity ${
          loading ? "opacity-50 pointer-events-none" : ""
        }`}
      >
        {/* Left column */}
        <div className="space-y-6">
          <ReportChart data={trend} />
          <ReportTables
            carryoverTasks={report.carryoverTasks}
            newTasks={report.newTasks}
          />
        </div>

        {/* Right column */}
        <CompletedList
          completedTasks={report.completedTasks}
          totalTasks={totalTasks}
        />
      </div>
    </div>
  );
}
