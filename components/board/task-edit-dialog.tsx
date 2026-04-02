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
                  <SelectValue placeholder="Без категории" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Без категории</SelectItem>
                  {categories.map((cat) => (
                    <SelectItem key={cat.id} value={cat.id}>
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
            <div className="flex items-center gap-3">
              {/* Urgent - red */}
              <button
                type="button"
                title="Срочный"
                onClick={() => setPriority("urgent")}
                className={cn(
                  "size-7 rounded-full bg-red-500 transition-transform",
                  priority === "urgent"
                    ? "scale-125 ring-2 ring-red-500 ring-offset-2"
                    : "opacity-60 hover:opacity-100"
                )}
              />
              {/* High - yellow */}
              <button
                type="button"
                title="Высокий"
                onClick={() => setPriority("high")}
                className={cn(
                  "size-7 rounded-full bg-yellow-400 transition-transform",
                  priority === "high"
                    ? "scale-125 ring-2 ring-yellow-400 ring-offset-2"
                    : "opacity-60 hover:opacity-100"
                )}
              />
              {/* Normal - gray */}
              <button
                type="button"
                title="Обычный"
                onClick={() => setPriority("normal")}
                className={cn(
                  "size-7 rounded-full bg-gray-400 transition-transform",
                  priority === "normal"
                    ? "scale-125 ring-2 ring-gray-400 ring-offset-2"
                    : "opacity-60 hover:opacity-100"
                )}
              />
              <span className="text-sm text-muted-foreground">
                {priority === "urgent"
                  ? "Срочный"
                  : priority === "high"
                    ? "Высокий"
                    : "Обычный"}
              </span>
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between pt-2">
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={handleDelete}
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
    </Dialog>
  );
}
