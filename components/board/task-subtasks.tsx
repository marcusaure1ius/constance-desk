"use client";

import { useOptimistic, useState, useTransition } from "react";
import { format, parseISO } from "date-fns";
import { ru } from "date-fns/locale";
import { CalendarIcon, ChevronDown, ListChecks, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { Calendar } from "@/components/ui/calendar";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  createSubtaskAction,
  deleteSubtaskAction,
  updateSubtaskAction,
} from "@/lib/actions/subtasks";
import { cn } from "@/lib/utils";

export type Subtask = {
  id: string;
  taskId: string;
  title: string;
  position: number;
  startDate: string;
  dueDate: string | null;
  completedAt: Date | null;
};

type OptimisticOp =
  | { type: "add"; subtask: Subtask }
  | { type: "update"; id: string; patch: Partial<Subtask> }
  | { type: "delete"; id: string };

function applyOp(list: Subtask[], op: OptimisticOp): Subtask[] {
  switch (op.type) {
    case "add":
      return [...list, op.subtask];
    case "update":
      return list.map((s) => (s.id === op.id ? { ...s, ...op.patch } : s));
    case "delete":
      return list.filter((s) => s.id !== op.id);
  }
}

const toDateString = (d: Date) => format(d, "yyyy-MM-dd");
const todayString = () => toDateString(new Date());

/** Цвет срока: просрочен — красный, сегодня — жёлтый. */
function dueTone(s: Subtask) {
  if (s.completedAt || !s.dueDate) return "text-muted-foreground";
  const today = todayString();
  if (s.dueDate < today) return "text-red-500";
  if (s.dueDate === today) return "text-amber-500";
  return "text-muted-foreground";
}

function DuePicker({
  value,
  onChange,
  className,
  children,
}: {
  value: string | null;
  onChange: (value: string | null) => void;
  className?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<button type="button" className={className} />}>
        {children}
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0">
        <Calendar
          mode="single"
          selected={value ? parseISO(value) : undefined}
          onSelect={(d) => {
            onChange(d ? toDateString(d) : null);
            setOpen(false);
          }}
          locale={ru}
        />
      </PopoverContent>
    </Popover>
  );
}

function AddSubtaskRow({ onAdd }: { onAdd: (title: string, dueDate: string | null) => void }) {
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState<string | null>(null);
  const submit = () => {
    if (!title.trim()) return;
    onAdd(title.trim(), dueDate);
    setTitle("");
    setDueDate(null);
  };
  return (
    <div className="flex items-center gap-1.5 px-1">
      <Plus className="size-3.5 shrink-0 text-muted-foreground" />
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          // Пробел и стрелки не должны доходить до перетаскивания карточки
          e.stopPropagation();
          if (e.key === "Enter") submit();
        }}
        placeholder="Подзадача…"
        className="h-6 min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground/70"
      />
      <DuePicker
        value={dueDate}
        onChange={setDueDate}
        className={cn(
          "inline-flex h-6 shrink-0 items-center gap-1 rounded-md border px-1.5 text-xs transition-colors hover:bg-muted",
          !dueDate && "text-muted-foreground"
        )}
      >
        <CalendarIcon className="size-3" />
        {dueDate ? format(parseISO(dueDate), "d MMM", { locale: ru }) : "срок"}
      </DuePicker>
    </div>
  );
}

interface TaskSubtasksProps {
  taskId: string;
  subtasks: Subtask[];
  /**
   * `edge` — язычок висит на нижней кромке карточки (доска на десктопе).
   * `inline` — внутри карточки справа: свайп-карточка на телефоне обрезает
   * всё, что выходит за её край.
   */
  placement: "edge" | "inline";
}

/**
 * Подзадачи на карточке: язычок и раскрывающийся список. Отдаёт два куска
 * отдельно — список встаёт в поток карточки, язычок карточка кладёт сама.
 */
export function useTaskSubtasks({ taskId, subtasks, placement }: TaskSubtasksProps) {
  const [open, setOpen] = useState(false);
  const [items, applyOptimistic] = useOptimistic(subtasks, applyOp);
  const [, startTransition] = useTransition();

  const run = (op: OptimisticOp, action: () => Promise<unknown>) =>
    startTransition(async () => {
      applyOptimistic(op);
      try {
        await action();
      } catch {
        toast.error("Не удалось сохранить подзадачу");
      }
    });

  const add = (title: string, dueDate: string | null) =>
    run(
      {
        type: "add",
        subtask: {
          id: `tmp-${crypto.randomUUID()}`,
          taskId,
          title,
          position: items.length,
          startDate: todayString(),
          dueDate,
          completedAt: null,
        },
      },
      () => createSubtaskAction({ taskId, title, dueDate })
    );

  const toggle = (s: Subtask) =>
    run(
      { type: "update", id: s.id, patch: { completedAt: s.completedAt ? null : new Date() } },
      () => updateSubtaskAction(s.id, { done: !s.completedAt })
    );

  const setDue = (s: Subtask, dueDate: string | null) =>
    run({ type: "update", id: s.id, patch: { dueDate } }, () =>
      updateSubtaskAction(s.id, { dueDate })
    );

  const remove = (s: Subtask) =>
    run({ type: "delete", id: s.id }, () => deleteSubtaskAction(s.id));

  const total = items.length;
  const done = items.filter((s) => s.completedAt).length;

  const list = open ? (
    <div
      // Клики внутри (и в календаре из портала) не открывают редактор задачи
      onClick={(e) => e.stopPropagation()}
      className="mt-2.5 flex cursor-default flex-col gap-0.5 border-t pt-2"
    >
      {items.map((s) => {
        const pending = s.id.startsWith("tmp-");
        return (
          <div
            key={s.id}
            className={cn(
              "group/sub flex items-center gap-2 rounded-md px-1 py-0.5 hover:bg-muted/60",
              pending && "opacity-60"
            )}
          >
            <Checkbox
              checked={!!s.completedAt}
              disabled={pending}
              onCheckedChange={() => toggle(s)}
              className="size-3.5"
            />
            <span
              className={cn(
                "min-w-0 flex-1 truncate text-xs",
                s.completedAt && "text-muted-foreground line-through"
              )}
              title={s.title}
            >
              {s.title}
            </span>
            {!pending && (
              <DuePicker
                value={s.dueDate}
                onChange={(d) => setDue(s, d)}
                className={cn(
                  "shrink-0 rounded px-0.5 text-[11px] tabular-nums hover:bg-muted",
                  s.dueDate ? dueTone(s) : "hidden text-muted-foreground group-hover/sub:inline-flex"
                )}
              >
                {s.dueDate ? (
                  format(parseISO(s.dueDate), "d MMM", { locale: ru })
                ) : (
                  <CalendarIcon className="size-3" />
                )}
              </DuePicker>
            )}
            {!pending && (
              <button
                type="button"
                onClick={() => remove(s)}
                className="hidden shrink-0 text-muted-foreground hover:text-foreground group-hover/sub:block"
                aria-label="Удалить подзадачу"
              >
                <X className="size-3" />
              </button>
            )}
          </div>
        );
      })}
      <AddSubtaskRow onAdd={add} />
    </div>
  ) : null;

  const tab = (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        setOpen((o) => !o);
      }}
      aria-expanded={open}
      aria-label={total ? `Подзадачи: ${done} из ${total}` : "Добавить подзадачу"}
      className={cn(
        "inline-flex h-5 items-center gap-1 rounded-full border bg-card px-2 text-[11px] text-muted-foreground transition-opacity hover:text-foreground",
        placement === "edge"
          ? "absolute bottom-0 left-1/2 z-10 -translate-x-1/2 translate-y-1/2 shadow-sm"
          : "ml-auto",
        // Пустой язычок — только на ховере; на тач-экранах ховера нет, там виден всегда
        total === 0 && !open && "opacity-0 group-hover/card:opacity-100 pointer-coarse:opacity-100"
      )}
    >
      {total === 0 ? (
        <>
          <Plus className="size-3" /> подзадача
          {open && <ChevronDown className="size-3 rotate-180" />}
        </>
      ) : (
        <>
          <ListChecks className="size-3" />
          {done}/{total}
          <ChevronDown className={cn("size-3 transition-transform", open && "rotate-180")} />
        </>
      )}
    </button>
  );

  return { list, tab, hasVisibleTab: total > 0 || open };
}
