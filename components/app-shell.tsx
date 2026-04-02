"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { CalendarDays, BarChart3, Settings, LayoutDashboard, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { ReportSidebar } from "@/components/report/report-sidebar";
import { TodayPlanModal } from "@/components/modals/today-plan-modal";
import { UserMenu } from "@/components/user-menu";

interface AppShellProps {
  children: React.ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const [reportOpen, setReportOpen] = React.useState(false);
  const [todayPlanOpen, setTodayPlanOpen] = React.useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const [searchValue, setSearchValue] = React.useState(searchParams.get("q") ?? "");
  const debounceRef = React.useRef<ReturnType<typeof setTimeout>>(null);

  function handleSearchChange(value: string) {
    setSearchValue(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString());
      if (value.trim()) {
        params.set("q", value.trim());
      } else {
        params.delete("q");
      }
      router.replace(`?${params.toString()}`, { scroll: false });
    }, 300);
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b bg-background">
        <div className="container mx-auto flex h-14 items-center gap-4 px-4">
          <Link href="/" className="text-lg font-bold shrink-0">
            Constance
          </Link>
          <div className="relative hidden md:block">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Поиск..."
              value={searchValue}
              onChange={(e) => handleSearchChange(e.target.value)}
              className="w-64 pl-9 pr-3"
            />
          </div>
          <div className="flex items-center gap-2 ml-auto">
            <Link
              href="/"
              className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
            >
              <LayoutDashboard className="mr-2 h-4 w-4" />
              <span className="hidden sm:inline">Доска</span>
            </Link>
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
            <UserMenu />
          </div>
        </div>
      </header>
      <main className="flex-1">{children}</main>

      <ReportSidebar open={reportOpen} onOpenChange={setReportOpen} />
      <TodayPlanModal open={todayPlanOpen} onOpenChange={setTodayPlanOpen} />
    </div>
  );
}
