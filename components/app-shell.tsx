"use client";

import * as React from "react";
import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { CalendarDays, BarChart3, Settings } from "lucide-react";
import { ReportSidebar } from "@/components/report/report-sidebar";

// Placeholder — replaced in Task 14
function TodayPlanModal({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  if (!open) return null;
  return null;
}

interface AppShellProps {
  children: React.ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const [reportOpen, setReportOpen] = React.useState(false);
  const [todayPlanOpen, setTodayPlanOpen] = React.useState(false);

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b bg-background">
        <div className="container flex h-14 items-center justify-between px-4">
          <Link href="/" className="text-lg font-bold">
            Constance
          </Link>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => setTodayPlanOpen(true)}>
              <CalendarDays className="mr-2 h-4 w-4" />
              <span className="hidden sm:inline">План на сегодня</span>
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setReportOpen(true)}>
              <BarChart3 className="mr-2 h-4 w-4" />
              <span className="hidden sm:inline">Отчёт</span>
            </Button>
            <Link
              href="/settings"
              className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
            >
              <Settings className="mr-2 h-4 w-4" />
              <span className="hidden sm:inline">Настройки</span>
            </Link>
          </div>
        </div>
      </header>
      <main className="flex-1">{children}</main>

      <ReportSidebar open={reportOpen} onOpenChange={setReportOpen} />
      <TodayPlanModal open={todayPlanOpen} onOpenChange={setTodayPlanOpen} />
    </div>
  );
}
