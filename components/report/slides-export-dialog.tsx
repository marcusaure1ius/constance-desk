"use client";

import * as React from "react";
import { format } from "date-fns";
import { RotateCcw, TriangleAlert, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { exportWeekSlideAction, getSlidesDraftAction } from "@/lib/actions/slides";
import { formatDm } from "@/lib/slides-report/dates";
import { exportDoneMessage, oversizedMessage } from "@/lib/slides-report/messages";
import {
  cycleStatus,
  initEpicStates,
  toggleTask,
  toSlideRows,
  viewEpic,
  type EpicDraftState,
} from "@/lib/slides-report/dialog-state";
import { isOverdue, STATUS_COLORS, STATUS_LABELS } from "@/lib/slides-report/status";
import type { DraftTask, EpicStatus, SlidesDraft } from "@/lib/slides-report/types";
import { validateExportPayload } from "@/lib/slides-report/validate";
import { cn } from "@/lib/utils";

type EpicChange = (epic: EpicDraftState) => EpicDraftState;

interface SlidesExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  environmentId: string;
}

/**
 * Модалка выгрузки недельного слайда. Черновик грузится при каждом открытии:
 * задачи на доске могли поменяться с прошлого раза, а выбор галочек между
 * неделями намеренно не запоминается.
 */
export function SlidesExportDialog({ open, onOpenChange, environmentId }: SlidesExportDialogProps) {
  const [draft, setDraft] = React.useState<SlidesDraft | null>(null);
  const [epics, setEpics] = React.useState<EpicDraftState[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [loadError, setLoadError] = React.useState(false);
  const [reloadKey, setReloadKey] = React.useState(0);
  const [exporting, setExporting] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(false);
    setDraft(null);
    setEpics([]);
    getSlidesDraftAction(environmentId, format(new Date(), "yyyy-MM-dd"))
      .then((next) => {
        if (cancelled) return;
        setDraft(next);
        setEpics(initEpicStates(next));
      })
      .catch(() => {
        if (cancelled) return;
        setLoadError(true);
        toast.error("Не удалось загрузить задачи недели");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, environmentId, reloadKey]);

  function updateEpic(categoryId: string, change: EpicChange) {
    setEpics((prev) => prev.map((epic) => (epic.categoryId === categoryId ? change(epic) : epic)));
  }

  const includedCount = epics.filter((epic) => epic.included).length;

  async function handleExport() {
    if (!draft) return;
    const payload = { weekMonday: draft.week.monday, rows: toSlideRows(epics, draft.today) };
    const validated = validateExportPayload(payload);
    if (!validated.ok) {
      toast.error(validated.error);
      return;
    }
    setExporting(true);
    try {
      const result = await exportWeekSlideAction(validated.data);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      onOpenChange(false);
      toast.success(exportDoneMessage(draft.week.shortLabel, result.slideCount), {
        duration: 15000,
        action: { label: "Открыть", onClick: () => window.open(result.url, "_blank", "noopener,noreferrer") },
      });
      if (result.oversized.length > 0) toast.warning(oversizedMessage(result.oversized), { duration: 15000 });
    } catch {
      toast.error("Не удалось выгрузить слайд");
    } finally {
      setExporting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Выгрузка в Google Slides</DialogTitle>
          <DialogDescription>{draft ? draft.week.label : "Неделя считается…"}</DialogDescription>
        </DialogHeader>

        <div className="-mx-4 min-h-0 flex-1 overflow-y-auto px-4">
          {loading && <DraftSkeleton />}
          {!loading && loadError && (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <p className="text-muted-foreground">Не удалось загрузить задачи недели</p>
              <Button variant="outline" onClick={() => setReloadKey((key) => key + 1)}>
                <RotateCcw className="size-4" /> Повторить
              </Button>
            </div>
          )}
          {!loading && !loadError && draft && epics.length === 0 && (
            <p className="py-8 text-center text-muted-foreground">
              За неделю нет задач с категориями — выгружать нечего
            </p>
          )}
          {!loading && !loadError && draft && epics.length > 0 && (
            <div className="divide-y">
              {epics.map((epic) => (
                <EpicSection
                  key={epic.categoryId}
                  epic={epic}
                  today={draft.today}
                  onChange={(change) => updateEpic(epic.categoryId, change)}
                />
              ))}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button onClick={handleExport} disabled={!draft || includedCount === 0 || exporting}>
            {exporting ? "Выгрузка…" : "Выгрузить в Slides"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EpicSection({
  epic,
  today,
  onChange,
}: {
  epic: EpicDraftState;
  today: string;
  onChange: (change: EpicChange) => void;
}) {
  const view = viewEpic(epic, today);

  return (
    <section className="space-y-3 py-4">
      <div className="flex items-center gap-3">
        <Checkbox
          checked={epic.included}
          onCheckedChange={(checked) => onChange((e) => ({ ...e, included: checked }))}
          aria-label={`Включить эпик «${epic.name}» в слайд`}
        />
        <span className={cn("flex-1 font-medium", !epic.included && "text-muted-foreground")}>{epic.name}</span>
        {epic.included && (
          <StatusControl
            status={view.status}
            isAuto={view.statusIsAuto}
            onCycle={() => onChange((e) => cycleStatus(e, today))}
            onReset={() => onChange((e) => ({ ...e, statusOverride: null }))}
          />
        )}
      </div>

      {epic.included && (
        <>
          <ul className="space-y-1.5 pl-7">
            {epic.tasks.map((task) => (
              <li key={task.id} className="flex items-center gap-3">
                <Checkbox
                  checked={epic.checkedIds.includes(task.id)}
                  onCheckedChange={() => onChange((e) => toggleTask(e, task.id))}
                  aria-label={task.title}
                />
                <span className="flex-1">{task.title}</span>
                <TaskHint task={task} today={today} />
              </li>
            ))}
          </ul>
          <div className="grid gap-3 pl-7 sm:grid-cols-2">
            <WeekField
              label="Текущая неделя"
              value={view.thisWeek}
              isAuto={view.thisWeekIsAuto}
              onEdit={(value) => onChange((e) => ({ ...e, thisWeekOverride: value }))}
              onReset={() => onChange((e) => ({ ...e, thisWeekOverride: null }))}
            />
            <WeekField
              label="Следующая неделя"
              value={view.nextWeek}
              isAuto={view.nextWeekIsAuto}
              onEdit={(value) => onChange((e) => ({ ...e, nextWeekOverride: value }))}
              onReset={() => onChange((e) => ({ ...e, nextWeekOverride: null }))}
            />
          </div>
        </>
      )}
    </section>
  );
}

function StatusControl({
  status,
  isAuto,
  onCycle,
  onReset,
}: {
  status: EpicStatus;
  isAuto: boolean;
  onCycle: () => void;
  onReset: () => void;
}) {
  return (
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <button
        type="button"
        onClick={onCycle}
        className="size-5 rounded-full outline-none ring-offset-2 ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
        style={{ backgroundColor: STATUS_COLORS[status] }}
        title={STATUS_LABELS[status]}
        aria-label={`Статус: ${STATUS_LABELS[status]}. Нажмите, чтобы сменить`}
      />
      {isAuto ? (
        <span>авто</span>
      ) : (
        <button
          type="button"
          onClick={onReset}
          className="inline-flex items-center gap-0.5 hover:text-foreground"
          aria-label="Вернуть автоматический статус"
        >
          вручную <X className="size-3" />
        </button>
      )}
    </div>
  );
}

function TaskHint({ task, today }: { task: DraftTask; today: string }) {
  if (task.completedAt) {
    return <span className="text-xs text-muted-foreground">✓ закрыта {format(new Date(task.completedAt), "dd.MM")}</span>;
  }
  if (!task.plannedDate) return <span className="text-xs text-muted-foreground">без срока</span>;
  const overdue = isOverdue(task, today);
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs", overdue ? "text-destructive" : "text-muted-foreground")}>
      срок {formatDm(task.plannedDate)}
      {overdue && <TriangleAlert className="size-3" aria-label="просрочена" />}
    </span>
  );
}

function WeekField({
  label,
  value,
  isAuto,
  onEdit,
  onReset,
}: {
  label: string;
  value: string;
  isAuto: boolean;
  onEdit: (value: string) => void;
  onReset: () => void;
}) {
  const id = React.useId();
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <label htmlFor={id} className="text-xs font-medium text-muted-foreground">
          {label}
        </label>
        {!isAuto && (
          <button
            type="button"
            onClick={onReset}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <RotateCcw className="size-3" /> собрать заново
          </button>
        )}
      </div>
      <Textarea id={id} value={value} onChange={(e) => onEdit(e.target.value)} className="min-h-20 text-sm" />
    </div>
  );
}

function DraftSkeleton() {
  return (
    <div className="space-y-4 py-4">
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="h-24 w-full" />
      ))}
    </div>
  );
}
