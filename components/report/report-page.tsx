"use client";

import type { ExtendedWeeklyReport, WeekTrendItem } from "@/lib/services/reports";

interface ReportPageProps {
  initialReport: ExtendedWeeklyReport;
  initialTrend: WeekTrendItem[];
  environmentId: string;
}

export function ReportPage({ initialReport, initialTrend, environmentId }: ReportPageProps) {
  return (
    <div className="container mx-auto px-4 py-6">
      <h1 className="text-2xl font-bold">Отчёт</h1>
      <p className="text-muted-foreground text-sm mt-2">Страница отчёта (в разработке)</p>
    </div>
  );
}
