"use client";

import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ArchiveRestore } from "lucide-react";
import { TaskCard } from "@/components/board/task-card";
import { getArchivedTasksAction, restoreTaskAction } from "@/lib/actions/tasks";
import { toast } from "sonner";

type Task = {
  id: string;
  title: string;
  description: string | null;
  priority: "urgent" | "high" | "normal";
  categoryId: string | null;
  plannedDate: string | null;
  completedAt: Date | null;
};
type Category = { id: string; name: string; color: string | null };

interface ArchiveModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  environmentId: string;
  categories: Category[];
}

export function ArchiveModal({
  open,
  onOpenChange,
  environmentId,
  categories,
}: ArchiveModalProps) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    getArchivedTasksAction(environmentId)
      .then((data) => setTasks(data as Task[]))
      .catch(() => toast.error("Не удалось загрузить архив"))
      .finally(() => setLoading(false));
  }, [open, environmentId]);

  async function handleRestore(id: string) {
    setRestoringId(id);
    try {
      await restoreTaskAction(id);
      setTasks((prev) => prev.filter((t) => t.id !== id));
      toast.success("Задача возвращена на доску");
    } catch {
      toast.error("Не удалось вернуть задачу");
    } finally {
      setRestoringId(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Архив</DialogTitle>
        </DialogHeader>
        {loading ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Загрузка…
          </p>
        ) : tasks.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            В архиве пока нет задач
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {tasks.map((task) => (
              <div key={task.id} className="flex items-stretch gap-2">
                <div className="min-w-0 flex-1">
                  <TaskCard task={task} categories={categories} />
                </div>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-auto w-11 self-stretch"
                  title="Вернуть на доску"
                  aria-label="Вернуть на доску"
                  disabled={restoringId === task.id}
                  onClick={() => handleRestore(task.id)}
                >
                  <ArchiveRestore className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
