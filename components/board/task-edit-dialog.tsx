"use client";

import { useState, useTransition } from "react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { CalendarIcon, Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle as AlertDialogTitleComponent,
} from "@/components/ui/alert-dialog";
import { updateTaskAction, deleteTaskAction } from "@/lib/actions/tasks";
import { cn } from "@/lib/utils";

type Task = {
  id: string;
  title: string;
  description: string | null;
  columnId: string;
  categoryId: string | null;
  priority: "urgent" | "high" | "normal";
  position: number;
  startDate: string;
  plannedDate: string | null;
  completedAt: Date | null;
};

type Category = { id: string; name: string; color: string | null };
type Priority = "urgent" | "high" | "normal";

interface TaskEditDialogProps {
  task: Task;
  categories: Category[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function TaskEditDialog({
  task,
  categories,
  open,
  onOpenChange,
}: TaskEditDialogProps) {
  const [isPending, startTransition] = useTransition();

  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? "");
  const [categoryId, setCategoryId] = useState<string>(task.categoryId ?? "");
  const [priority, setPriority] = useState<Priority>(task.priority);
  const [plannedDate, setPlannedDate] = useState<Date | undefined>(
    task.plannedDate ? new Date(task.plannedDate) : undefined
  );
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;

    startTransition(async () => {
      try {
        await updateTaskAction(task.id, {
          title: title.trim(),
          description: description.trim() || null,
          categoryId: categoryId || null,
          priority,
          plannedDate: plannedDate
            ? plannedDate.toISOString().split("T")[0]
            : null,
        });
        toast.success("Задача обновлена");
        onOpenChange(false);
      } catch {
        toast.error("Не удалось обновить задачу");
      }
    });
  }

  function handleDelete() {
    startTransition(async () => {
      try {
        await deleteTaskAction(task.id);
        toast.success("Задача удалена");
        onOpenChange(false);
      } catch {
        toast.error("Не удалось удалить задачу");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Редактировать задачу</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSave} className="flex flex-col gap-4">
          {/* Title */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edit-task-title">Название *</Label>
            <Input
              id="edit-task-title"
              placeholder="Введите название задачи"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
          </div>

          {/* Description */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edit-task-description">Описание</Label>
            <Textarea
              id="edit-task-description"
              placeholder="Описание задачи (необязательно)"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="resize-none"
              rows={3}
            />
          </div>

          {/* Planned Date */}
          <div className="flex flex-col gap-1.5">
            <Label>Плановая дата</Label>
            <Popover>
              <PopoverTrigger
                render={
                  <button
                    type="button"
                    className={cn(
                      "flex h-8 w-full items-center justify-start gap-2 rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
                      !plannedDate && "text-muted-foreground"
                    )}
                  />
                }
              >
                <CalendarIcon className="size-4 text-muted-foreground" />
                {plannedDate
                  ? format(plannedDate, "d MMMM yyyy", { locale: ru })
                  : "Выберите дату (необязательно)"}
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0">
                <Calendar
                  mode="single"
                  selected={plannedDate}
                  onSelect={setPlannedDate}
                  locale={ru}
                />
              </PopoverContent>
            </Popover>
          </div>

          {/* Category */}
          {categories.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <Label>Категория</Label>
              <Select
                value={categoryId}
                onValueChange={(val) =>
                  setCategoryId(val === null || val === "__none__" ? "" : val)
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Без категории">
                    {(value: string) => {
                      if (!value || value === "__none__") return "Без категории";
                      return categories.find((c) => c.id === value)?.name ?? value;
                    }}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__" label="Без категории">Без категории</SelectItem>
                  {categories.map((cat) => (
                    <SelectItem key={cat.id} value={cat.id} label={cat.name}>
                      {cat.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Priority */}
          <div className="flex flex-col gap-1.5">
            <Label>Приоритет</Label>
            <Select value={priority} onValueChange={(val) => { if (val) setPriority(val as Priority); }}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Выберите приоритет">
                  {(value: string) => {
                    const labels: Record<string, { label: string; color: string }> = {
                      urgent: { label: "Срочный", color: "bg-red-500" },
                      high: { label: "Высокий", color: "bg-yellow-400" },
                      normal: { label: "Обычный", color: "bg-gray-400" },
                    };
                    const item = labels[value];
                    if (!item) return value;
                    return (
                      <span className="flex items-center gap-2">
                        <span className={cn("size-2.5 rounded-full", item.color)} />
                        {item.label}
                      </span>
                    );
                  }}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="urgent" label="Срочный">
                  <span className="flex items-center gap-2">
                    <span className="size-2.5 rounded-full bg-red-500" />
                    Срочный
                  </span>
                </SelectItem>
                <SelectItem value="high" label="Высокий">
                  <span className="flex items-center gap-2">
                    <span className="size-2.5 rounded-full bg-yellow-400" />
                    Высокий
                  </span>
                </SelectItem>
                <SelectItem value="normal" label="Обычный">
                  <span className="flex items-center gap-2">
                    <span className="size-2.5 rounded-full bg-gray-400" />
                    Обычный
                  </span>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between pt-2">
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={() => setShowDeleteConfirm(true)}
              disabled={isPending}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Удалить
            </Button>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={isPending}
              >
                Отмена
              </Button>
              <Button type="submit" disabled={isPending || !title.trim()}>
                {isPending ? "Сохранение..." : "Сохранить"}
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>

      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitleComponent>Удалить задачу?</AlertDialogTitleComponent>
            <AlertDialogDescription>
              Это действие нельзя отменить. Задача будет удалена безвозвратно.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
