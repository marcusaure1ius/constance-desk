import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { CalendarDays, BarChart3, Settings } from "lucide-react";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b bg-background">
        <div className="container flex h-14 items-center justify-between px-4">
          <Link href="/" className="text-lg font-bold">
            Constance
          </Link>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" id="today-plan-trigger">
              <CalendarDays className="mr-2 h-4 w-4" />
              <span className="hidden sm:inline">План на сегодня</span>
            </Button>
            <Button variant="ghost" size="sm" id="report-trigger">
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
    </div>
  );
}
