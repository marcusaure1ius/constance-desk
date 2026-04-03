"use client";

import { useEffect, useState } from "react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { getTodayPlanAction } from "@/lib/actions/today";
import { cn } from "@/lib/utils";

type Priority = "urgent" | "high" | "normal";

const priorityColors: Record<Priority, string> = {
  urgent: "border-l-red-500",
  high: "border-l-yellow-500",
  normal: "border-l-gray-300",
};

type TodayPlanData = Awaited<ReturnType<typeof getTodayPlanAction>>;

interface TodayPlanModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  environmentId: string;
}

export function TodayPlanModal({ open, onOpenChange, environmentId }: TodayPlanModalProps) {
  const [data, setData] = useState<TodayPlanData | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;

    setLoading(true);
    setData(null);

    getTodayPlanAction(environmentId)
      .then((result) => {
        setData(result);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [open, environmentId]);

  const todayLabel = format(new Date(), "dd.MM.yyyy", { locale: ru });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>План на сегодня ({todayLabel})</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {loading && (
            <p className="text-sm text-muted-foreground text-center py-6">
              Загрузка...
            </p>
          )}

          {!loading && data && data.totalCount === 0 && (
            <p className="text-sm text-muted-foreground text-center py-6">
              Нет задач с плановой датой на сегодня
            </p>
          )}

          {!loading && data && data.grouped.map((group) => (
            <div key={group.column.id}>
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                {group.column.title}
              </h3>
              <div className="flex flex-col gap-2">
                {group.tasks.map((task) => (
                  <div
                    key={task.id}
                    className={cn(
                      "border-l-4 pl-3 py-2 rounded-r-md bg-muted/50",
                      priorityColors[(task.priority as Priority) ?? "normal"]
                    )}
                  >
                    <p className="text-sm font-medium">{task.title}</p>
                    {task.description && (
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                        {task.description}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {!loading && data && data.totalCount > 0 && (
          <div className="border-t pt-3 mt-2">
            <p className="text-sm text-muted-foreground">
              Задач на сегодня: {data.totalCount}
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
