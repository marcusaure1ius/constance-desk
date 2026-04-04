"use client";

import * as React from "react";
import Link from "next/link";
import { LogoIcon } from "@/components/logo-icon";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { Search, LayoutDashboard, CalendarDays, Plus, BarChart3, Settings } from "lucide-react";
import { Input } from "@/components/ui/input";
import { ReportSidebar } from "@/components/report/report-sidebar";
import { TodayPlanModal } from "@/components/modals/today-plan-modal";
import { UserMenu } from "@/components/user-menu";
import { EnvironmentTheme } from "@/components/environment-theme";

type Environment = {
  id: string;
  name: string;
  color: string;
  position: number;
};

interface AppShellProps {
  children: React.ReactNode;
  activeEnvironment: Environment | null;
  environments: Environment[];
  nickname: string | null;
}

export function AppShell({ children, activeEnvironment, environments, nickname }: AppShellProps) {
  const [reportOpen, setReportOpen] = React.useState(false);
  const [todayPlanOpen, setTodayPlanOpen] = React.useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const searchParamsRef = React.useRef(searchParams);
  searchParamsRef.current = searchParams;
  const [searchValue, setSearchValue] = React.useState(searchParams.get("q") ?? "");
  const debounceRef = React.useRef<ReturnType<typeof setTimeout>>(null);

  React.useEffect(() => {
    setSearchValue(searchParams.get("q") ?? "");
  }, [searchParams]);

  React.useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  function handleSearchChange(value: string) {
    setSearchValue(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const params = new URLSearchParams(searchParamsRef.current.toString());
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
      <EnvironmentTheme color={activeEnvironment?.color ?? null} />
      <header className="border-b bg-background">
        <div className="container mx-auto relative flex h-14 items-center gap-4 px-4">
          <Link href="/" className="flex items-center gap-2 shrink-0">
            <LogoIcon size={22} />
            <span className="hidden sm:inline text-sm font-semibold uppercase tracking-[2.5px]">
              Constance
            </span>
          </Link>
          <div className="relative flex-1 mx-2 md:max-w-md">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Поиск..."
              value={searchValue}
              onChange={(e) => handleSearchChange(e.target.value)}
              className="w-full rounded-full border-none bg-muted pl-9 pr-4 focus-visible:ring-0 focus-visible:border-none"
            />
          </div>
          <div className="flex items-center gap-3 ml-auto">
            <nav className="hidden md:flex items-center gap-0.5 rounded-full bg-muted p-1">
              <Link
                href="/"
                className={`px-3 py-1 text-sm font-medium rounded-full transition-colors ${
                  pathname === "/"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Доска
              </Link>
              <button
                onClick={() => setTodayPlanOpen(true)}
                className="px-3 py-1 text-sm font-medium rounded-full transition-colors text-muted-foreground hover:text-foreground"
              >
                План на сегодня
              </button>
              <button
                onClick={() => setReportOpen(true)}
                className="px-3 py-1 text-sm font-medium rounded-full transition-colors text-muted-foreground hover:text-foreground"
              >
                Отчёт
              </button>
              <Link
                href="/settings"
                className={`px-3 py-1 text-sm font-medium rounded-full transition-colors ${
                  pathname === "/settings"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Настройки
              </Link>
            </nav>
            <UserMenu activeEnvironment={activeEnvironment} environments={environments} nickname={nickname} />
          </div>
        </div>
      </header>
      <main className="flex-1 pb-16 md:pb-0">{children}</main>

      <nav className="fixed bottom-0 left-0 right-0 z-50 border-t bg-background md:hidden">
        <div className="flex h-14 items-center justify-around px-2">
          <Link
            href="/"
            className={`flex flex-col items-center justify-center p-2 rounded-lg transition-colors ${
              pathname === "/" ? "text-foreground" : "text-muted-foreground"
            }`}
          >
            <LayoutDashboard className="h-5 w-5" />
          </Link>
          <button
            onClick={() => setTodayPlanOpen(true)}
            className="flex flex-col items-center justify-center p-2 rounded-lg transition-colors text-muted-foreground"
          >
            <CalendarDays className="h-5 w-5" />
          </button>
          <Link
            href="/?create=true"
            className="flex items-center justify-center size-10 rounded-full bg-primary text-primary-foreground shadow-md"
          >
            <Plus className="h-5 w-5" />
          </Link>
          <button
            onClick={() => setReportOpen(true)}
            className="flex flex-col items-center justify-center p-2 rounded-lg transition-colors text-muted-foreground"
          >
            <BarChart3 className="h-5 w-5" />
          </button>
          <Link
            href="/settings"
            className={`flex flex-col items-center justify-center p-2 rounded-lg transition-colors ${
              pathname === "/settings" ? "text-foreground" : "text-muted-foreground"
            }`}
          >
            <Settings className="h-5 w-5" />
          </Link>
        </div>
      </nav>

      <ReportSidebar open={reportOpen} onOpenChange={setReportOpen} environmentId={activeEnvironment?.id ?? ""} />
      <TodayPlanModal open={todayPlanOpen} onOpenChange={setTodayPlanOpen} environmentId={activeEnvironment?.id ?? ""} />
    </div>
  );
}
