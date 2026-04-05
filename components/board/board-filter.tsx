"use client";

import { Sun, SlidersHorizontal, CalendarDays, CircleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuCheckboxItem,
} from "@/components/ui/dropdown-menu";
import { useBoardFilter } from "@/hooks/use-board-filter";

export function BoardFilter() {
  const { config, updateConfig, hasFilters } = useBoardFilter();

  return (
    <div className="flex items-center gap-1">
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="outline" size="icon" className="size-9" />}
        >
          <SlidersHorizontal className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Фильтры</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuCheckboxItem
              checked={config.today}
              onClick={() => updateConfig({ today: !config.today })}
            >
              <CalendarDays className="size-4" />
              Дата — сегодня
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={config.highPriority}
              onClick={() => updateConfig({ highPriority: !config.highPriority })}
            >
              <CircleAlert className="size-4" />
              Высокий приоритет
            </DropdownMenuCheckboxItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <p className="px-2 py-1.5 text-xs text-muted-foreground">
            Показать задачи, подходящие под любой фильтр
          </p>
        </DropdownMenuContent>
      </DropdownMenu>

      <Button
        variant={config.active && hasFilters ? "default" : "outline"}
        size="icon"
        className={`size-9 ${
          config.active && hasFilters
            ? "shadow-[0_0_12px_rgba(59,130,246,0.3)]"
            : ""
        }`}
        disabled={!hasFilters}
        onClick={() => updateConfig({ active: !config.active })}
      >
        <Sun className="size-4" />
      </Button>
    </div>
  );
}
