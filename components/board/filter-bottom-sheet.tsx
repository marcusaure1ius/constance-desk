"use client";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet";
import { useBoardFilter } from "@/hooks/use-board-filter";

interface FilterBottomSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function FilterBottomSheet({ open, onOpenChange }: FilterBottomSheetProps) {
  const { config, updateConfig } = useBoardFilter();

  function handleDone() {
    const hasAny = config.today || config.highPriority;
    updateConfig({ active: hasAny });
    onOpenChange(false);
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" showCloseButton={false} className="rounded-t-2xl">
        <div className="flex justify-center pt-2 pb-1">
          <div className="w-9 h-1 rounded-full bg-muted-foreground/30" />
        </div>
        <SheetHeader>
          <SheetTitle>Настройка фильтра</SheetTitle>
          <SheetDescription>
            Показать задачи, подходящие под любой фильтр
          </SheetDescription>
        </SheetHeader>
        <div className="space-y-3 px-4">
          <label className="flex items-center gap-3 p-3 rounded-lg bg-muted/50 cursor-pointer">
            <Checkbox
              checked={config.today}
              onCheckedChange={(checked) => updateConfig({ today: !!checked })}
            />
            <div>
              <div className="text-sm font-medium">📅 Дата — сегодня</div>
              <div className="text-xs text-muted-foreground">
                Задачи с плановой датой на сегодня
              </div>
            </div>
          </label>
          <label className="flex items-center gap-3 p-3 rounded-lg bg-muted/50 cursor-pointer">
            <Checkbox
              checked={config.highPriority}
              onCheckedChange={(checked) => updateConfig({ highPriority: !!checked })}
            />
            <div>
              <div className="text-sm font-medium">🔴 Высокий приоритет</div>
              <div className="text-xs text-muted-foreground">
                Urgent и High
              </div>
            </div>
          </label>
        </div>
        <SheetFooter>
          <Button className="w-full" onClick={handleDone}>
            Готово
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
