"use client";

/**
 * ПРОТОТИП. След работы агента в духе ChatGPT и Codex.
 *
 * Строка одна, серая, с тонким значком рода действия — и всё. Аргументы и
 * ответ инструмента прячутся под неё и открываются по клику: обычно они не
 * нужны, а когда агент ошибся — нужны целиком, а не пересказом. Никаких
 * галочек, кружков и цветных плашек: чем тише след, тем заметнее сам ответ.
 */

import { useState } from "react";
import {
  ArrowRight,
  ChevronRight,
  LayoutGrid,
  ListFilter,
  PenLine,
  Plus,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type TraceStep = {
  tool: string;
  /** Аргументы вызова — показываются развёрнутыми, как в консоли. */
  args?: string;
  result?: string;
};

type Meta = { icon: typeof LayoutGrid; run: string; done: string };

const TOOLS: Record<string, Meta> = {
  get_board: { icon: LayoutGrid, run: "Читаю доску", done: "Прочитал доску" },
  list_tasks: { icon: ListFilter, run: "Читаю задачи", done: "Прочитал задачи" },
  list_environments: { icon: LayoutGrid, run: "Читаю среды", done: "Прочитал среды" },
  create_task: { icon: Plus, run: "Создаю задачи", done: "Создал задачи" },
  create_epic: { icon: Plus, run: "Создаю эпик", done: "Создал эпик" },
  create_epic_task: { icon: Plus, run: "Создаю задачи", done: "Создал задачи" },
  update_task: { icon: PenLine, run: "Правлю задачи", done: "Поправил задачи" },
  move_task: { icon: ArrowRight, run: "Переношу задачу", done: "Перенёс задачу" },
  delete_task: { icon: Trash2, run: "Удаляю задачу", done: "Удалил задачу" },
};

const FALLBACK: Meta = { icon: LayoutGrid, run: "Работаю", done: "Готово" };

export function ThinkingLine() {
  return <div className="agent-shimmer flex h-5 items-center text-xs">Думаю</div>;
}

/** Сколько думал — строка остаётся в переписке, как «Thought for 4s». */
export function ThoughtFor({ ms }: { ms: number }) {
  return (
    <div className="flex h-5 items-center text-xs text-muted-foreground/60">
      Думал {(ms / 1000).toFixed(0)} с
    </div>
  );
}

function Step({ step, running }: { step: TraceStep; running: boolean }) {
  const [open, setOpen] = useState(false);
  const meta = TOOLS[step.tool] ?? FALLBACK;
  const Icon = meta.icon;

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="group -mx-1 flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left transition-colors hover:bg-muted/40"
      >
        <Icon className="size-3.5 shrink-0 text-muted-foreground/60" />
        <span className={cn("text-xs", running ? "agent-shimmer" : "text-muted-foreground")}>
          {running ? meta.run : meta.done}
          {!running && step.result && (
            <span className="text-muted-foreground/60"> · {step.result}</span>
          )}
        </span>
        <ChevronRight
          className={cn(
            "size-3 shrink-0 text-muted-foreground/40 transition-all",
            open ? "rotate-90 opacity-100" : "opacity-0 group-hover:opacity-100"
          )}
        />
      </button>

      {open && (
        <div className="ml-[6px] mt-0.5 border-l border-border/60 py-0.5 pl-3 font-mono text-[11px] leading-relaxed text-muted-foreground/70">
          <div>
            {step.tool}({step.args ?? ""})
          </div>
          {step.result && (
            <div className="text-muted-foreground/50">→ {step.result}</div>
          )}
        </div>
      )}
    </div>
  );
}

export function ToolTrace({
  steps,
  running,
}: {
  steps: TraceStep[];
  running: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      {steps.map((step, i) => (
        <Step key={`${step.tool}-${i}`} step={step} running={running && i === steps.length - 1} />
      ))}
    </div>
  );
}
