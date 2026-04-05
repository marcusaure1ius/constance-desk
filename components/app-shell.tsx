"use client";

import * as React from "react";
import Link from "next/link";
import { LogoIcon } from "@/components/logo-icon";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { Search, LayoutDashboard, Sun, Plus, BarChart3, Settings } from "lucide-react";
import { Input } from "@/components/ui/input";
import { FilterBottomSheet } from "@/components/board/filter-bottom-sheet";
import { useBoardFilter } from "@/hooks/use-board-filter";
import { UserMenu } from "@/components/user-menu";
import { EnvironmentTheme } from "@/components/environment-theme";
import { useScrollDirection } from "@/hooks/use-scroll-direction";

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
  const navbarVisible = useScrollDirection();
  const headerRef = React.useRef<HTMLElement>(null);
  const [headerHeight, setHeaderHeight] = React.useState(0);

  React.useEffect(() => {
    if (!headerRef.current) return;
    const observer = new ResizeObserver(([entry]) => {
      setHeaderHeight(entry.contentRect.height + 16); // 16px = margin top + bottom (8+8)
    });
    observer.observe(headerRef.current);
    return () => observer.disconnect();
  }, []);

  const [filterSheetOpen, setFilterSheetOpen] = React.useState(false);
  const { config: filterConfig, updateConfig } = useBoardFilter();
  const filterActive = filterConfig.active && (filterConfig.today || filterConfig.highPriority);
  const filterLongPressTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const filterIsLongPress = React.useRef(false);
  const longPressTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const isLongPress = React.useRef(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const searchParamsRef = React.useRef(searchParams);
  React.useEffect(() => {
    searchParamsRef.current = searchParams;
  }, [searchParams]);
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

  const [fabPressed, setFabPressed] = React.useState(false);

  function handleFabTouchStart() {
    isLongPress.current = false;
    setFabPressed(true);
    longPressTimer.current = setTimeout(() => {
      isLongPress.current = true;
      setFabPressed(false);
      router.push("/?smart-input=true");
    }, 500);
  }

  function handleFabTouchEnd(e: React.TouchEvent) {
    setFabPressed(false);
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    if (!isLongPress.current) {
      e.preventDefault();
      router.push("/?create=true");
    }
  }

  function handleFabTouchCancel() {
    setFabPressed(false);
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }

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
      <header
        ref={headerRef}
        className={`fixed top-0 left-0 right-0 z-50 transition-transform duration-300 ease-in-out ${
          navbarVisible ? "translate-y-0" : "-translate-y-[calc(100%+16px)]"
        }`}
      >
        <div className="mx-2 mt-2 mb-2 md:container md:mx-auto md:px-2">
          <div className="rounded-2xl bg-background/72 backdrop-blur-xl border border-white/30 dark:border-white/10 shadow-[0_4px_30px_rgba(0,0,0,0.06)]">
          <div className="relative flex h-14 items-center gap-4 px-4">
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
              <Link
                href="/today"
                className={`px-3 py-1 text-sm font-medium rounded-full transition-colors ${
                  pathname === "/today"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Сегодня
              </Link>
              <Link
                href="/report"
                className={`px-3 py-1 text-sm font-medium rounded-full transition-colors ${
                  pathname === "/report"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Отчёт
              </Link>
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
          <div id="navbar-tabs-slot" className="md:hidden px-3 pb-2" />
          </div>
        </div>
      </header>
      <main className="flex-1 pb-16 md:pb-0" style={{ paddingTop: headerHeight }}>{children}</main>

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
            className={`relative flex flex-col items-center justify-center p-2 rounded-lg transition-colors ${
              pathname === "/today" ? "text-foreground" : "text-muted-foreground"
            }`}
            onClick={() => {
              if (filterIsLongPress.current) {
                filterIsLongPress.current = false;
                return;
              }
              router.push("/today");
            }}
            onTouchStart={() => {
              filterIsLongPress.current = false;
              filterLongPressTimer.current = setTimeout(() => {
                filterIsLongPress.current = true;
                if (filterActive) {
                  updateConfig({ today: false, highPriority: false, active: false });
                } else {
                  setFilterSheetOpen(true);
                }
              }, 500);
            }}
            onTouchEnd={() => {
              if (filterLongPressTimer.current) {
                clearTimeout(filterLongPressTimer.current);
                filterLongPressTimer.current = null;
              }
            }}
            onTouchCancel={() => {
              if (filterLongPressTimer.current) {
                clearTimeout(filterLongPressTimer.current);
                filterLongPressTimer.current = null;
              }
            }}
          >
            <Sun className="h-5 w-5" />
            {filterActive && (
              <div
                className="absolute top-1.5 right-1.5 size-2 rounded-full border-2 border-background"
                style={{ backgroundColor: activeEnvironment?.color ?? "var(--color-primary)" }}
              />
            )}
          </button>
          <button
            onTouchStart={handleFabTouchStart}
            onTouchEnd={handleFabTouchEnd}
            onTouchCancel={handleFabTouchCancel}
            onClick={() => router.push("/?create=true")}
            className="relative flex items-center justify-center size-10 rounded-full bg-primary text-primary-foreground shadow-md"
          >
            {fabPressed && (
              <svg className="absolute inset-[-6px] size-[calc(100%+12px)]" viewBox="0 0 52 52">
                <circle
                  cx="26" cy="26" r="24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="4"
                  strokeLinecap="round"
                  strokeDasharray="150.8"
                  strokeDashoffset="150.8"
                  className="animate-[fab-ring_500ms_linear_forwards] text-primary"
                />
              </svg>
            )}
            <Plus className="h-5 w-5" />
          </button>
          <Link
            href="/report"
            className={`flex flex-col items-center justify-center p-2 rounded-lg transition-colors ${
              pathname === "/report" ? "text-foreground" : "text-muted-foreground"
            }`}
          >
            <BarChart3 className="h-5 w-5" />
          </Link>
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

      <FilterBottomSheet open={filterSheetOpen} onOpenChange={setFilterSheetOpen} />
    </div>
  );
}
