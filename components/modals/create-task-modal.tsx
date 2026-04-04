"use client";

import { useState, useTransition } from "react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { CalendarIcon } from "lucide-react";
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
import { Switch } from "@/components/ui/switch";
import { createTaskAction } from "@/lib/actions/tasks";
import { cn } from "@/lib/utils";

type Column = { id: string; title: string; position: number };
type Category = { id: string; name: string; color: string | null };
type Priority = "urgent" | "high" | "normal";

interface CreateTaskModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  columns: Column[];
  categories: Category[];
  defaultColumnId?: string;
}

function getToday() {
  return format(new Date(), "yyyy-MM-dd");
}

export function CreateTaskModal({
  open,
  onOpenChange,
  columns,
  categories,
  defaultColumnId,
}: CreateTaskModalProps) {
  const [isPending, startTransition] = useTransition();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [columnId, setColumnId] = useState(
    defaultColumnId ?? columns[0]?.id ?? ""
  );
  const [categoryId, setCategoryId] = useState<string>("");
  const [priority, setPriority] = useState<Priority>("normal");
  const [startDate, setStartDate] = useState<Date | undefined>(new Date());
  const [plannedDate, setPlannedDate] = useState<Date | undefined>(undefined);
  const [createAnother, setCreateAnother] = useState(false);

  function resetForm() {
    setTitle("");
    setDescription("");
    setColumnId(defaultColumnId ?? columns[0]?.id ?? "");
    setCategoryId("");
    setPriority("normal");
    setStartDate(new Date());
    setPlannedDate(undefined);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;

    startTransition(async () => {
      try {
        await createTaskAction({
          title: title.trim(),
          description: description.trim() || undefined,
          columnId,
          categoryId: categoryId || undefined,
          priority,
          startDate: startDate
            ? format(startDate, "yyyy-MM-dd")
            : getToday(),
          plannedDate: plannedDate
            ? format(plannedDate, "yyyy-MM-dd")
            : undefined,
        });

        toast.success("Задача создана");
        resetForm();

        if (!createAnother) {
          onOpenChange(false);
        }
      } catch {
        toast.error("Не удалось создать задачу");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Новая задача</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {/* Title */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="task-title">Название *</Label>
            <Input
              id="task-title"
              placeholder="Введите название задачи"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
          </div>

          {/* Description */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="task-description">Описание</Label>
            <Textarea
              id="task-description"
              placeholder="Описание задачи (необязательно)"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="resize-none"
              rows={3}
            />
          </div>

          {/* Column */}
          <div className="flex flex-col gap-1.5">
            <Label>Колонка</Label>
            <Select value={columnId} onValueChange={(val) => { if (val !== null) setColumnId(val); }}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Выберите колонку">
                  {(value: string) => columns.find((c) => c.id === value)?.title ?? value}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {columns.map((col) => (
                  <SelectItem key={col.id} value={col.id} label={col.title}>
                    {col.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Start Date */}
          <div className="flex flex-col gap-1.5">
            <Label>Дата начала</Label>
            <Popover>
              <PopoverTrigger
                render={
                  <button
                    type="button"
                    className={cn(
                      "flex h-8 w-full items-center justify-start gap-2 rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
                      !startDate && "text-muted-foreground"
                    )}
                  />
                }
              >
                <CalendarIcon className="size-4 text-muted-foreground" />
                {startDate
                  ? format(startDate, "d MMMM yyyy", { locale: ru })
                  : "Выберите дату"}
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0">
                <Calendar
                  mode="single"
                  selected={startDate}
                  onSelect={setStartDate}
                  locale={ru}
                />
              </PopoverContent>
            </Popover>
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

          {/* Create Another */}
          <div className="flex items-center justify-between border-t pt-4">
            <div className="flex flex-col gap-0.5">
              <Label htmlFor="create-another" className="font-semibold">
                Создать ещё одну
              </Label>
              <span className="text-xs text-muted-foreground">
                Форма останется открытой после создания
              </span>
            </div>
            <Switch
              id="create-another"
              checked={createAnother}
              onCheckedChange={(checked) =>
                setCreateAnother(checked === true)
              }
            />
          </div>

          {/* Footer */}
          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isPending}
            >
              Отмена
            </Button>
            <Button type="submit" disabled={isPending || !title.trim()}>
              {isPending ? "Создание..." : "Создать"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
