"use client";

import * as React from "react";
import { Copy, FileDown, Sparkles } from "lucide-react";
import { format, startOfWeek } from "date-fns";
import { ru } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import { generatePptxAction, generateAiPdfAction } from "@/lib/actions/tasks";
import type { ExtendedWeeklyReport } from "@/lib/services/reports";

interface ReportActionsProps {
  report: ExtendedWeeklyReport;
  environmentId: string;
}

function buildHtmlTable(report: ExtendedWeeklyReport): string {
  const weekLabel = `${format(new Date(report.weekStart), "d MMMM", { locale: ru })} — ${format(new Date(report.weekEnd), "d MMMM yyyy", { locale: ru })}`;

  const badgeStyle = (done: boolean) =>
    done
      ? "display:inline-block;padding:2px 8px;border-radius:12px;font-size:12px;background:#dcfce7;color:#16a34a;"
      : "display:inline-block;padding:2px 8px;border-radius:12px;font-size:12px;background:#fef9c3;color:#ca8a04;";

  const taskRow = (task: { title: string; categoryName: string | null; completedAt: Date | null }) => {
    const status = task.completedAt ? "Готово" : "В работе";
    const cat = task.categoryName ? ` <span style="color:#888;font-size:12px;">(${task.categoryName})</span>` : "";
    return `<tr><td style="padding:4px 8px;border-bottom:1px solid #eee;">${task.title}${cat}</td><td style="padding:4px 8px;border-bottom:1px solid #eee;text-align:center;"><span style="${badgeStyle(!!task.completedAt)}">${status}</span></td></tr>`;
  };

  const section = (title: string, tasks: typeof report.carryoverTasks) => {
    if (tasks.length === 0) return "";
    return `<h3 style="margin:12px 0 4px;font-size:14px;">${title}</h3><table style="width:100%;border-collapse:collapse;">${tasks.map(taskRow).join("")}</table>`;
  };

  return `<div style="font-family:system-ui,sans-serif;font-size:14px;">
<h2 style="margin-bottom:8px;">Отчёт за неделю: ${weekLabel}</h2>
<p>Выполнено: ${report.completedTasks.length} задач</p>
${section("Переходящие задачи", report.carryoverTasks)}
${section("Новые задачи", report.newTasks)}
${section("Выполненные задачи", report.completedTasks)}
</div>`;
}

export function ReportActions({ report, environmentId }: ReportActionsProps) {
  const [copying, setCopying] = React.useState(false);
  const [generatingPptx, setGeneratingPptx] = React.useState(false);
  const [generatingPdf, setGeneratingPdf] = React.useState(false);

  async function handleCopy() {
    setCopying(true);
    try {
      const html = buildHtmlTable(report);
      const blob = new Blob([html], { type: "text/html" });
      await navigator.clipboard.write([
        new ClipboardItem({ "text/html": blob }),
      ]);
    } finally {
      setCopying(false);
    }
  }

  async function handleDownloadPptx() {
    setGeneratingPptx(true);
    try {
      const weekStart = startOfWeek(new Date(report.weekStart), { weekStartsOn: 1 });
      const base64 = await generatePptxAction(weekStart.toISOString(), environmentId);

      const byteCharacters = atob(base64);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], {
        type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      });

      const dateLabel = format(new Date(report.weekStart), "dd.MM.yyyy", { locale: ru });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `AI_PO_${dateLabel}.pptx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } finally {
      setGeneratingPptx(false);
    }
  }

  async function handleDownloadAiPdf() {
    setGeneratingPdf(true);
    try {
      const weekStart = startOfWeek(new Date(report.weekStart), { weekStartsOn: 1 });
      const base64 = await generateAiPdfAction(weekStart.toISOString(), environmentId);

      const byteCharacters = atob(base64);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: "application/pdf" });

      const dateLabel = format(new Date(report.weekStart), "dd.MM.yyyy", { locale: ru });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Constance_AI_${dateLabel}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } finally {
      setGeneratingPdf(false);
    }
  }

  return (
    <div className="flex gap-2">
      <Button variant="outline" size="sm" onClick={handleCopy} disabled={copying}>
        <Copy className="h-4 w-4" />
        <span className="hidden sm:inline ml-1.5">
          {copying ? "Копирование…" : "Копировать"}
        </span>
      </Button>
      <Button variant="outline" size="sm" onClick={handleDownloadPptx} disabled={generatingPptx}>
        <FileDown className="h-4 w-4" />
        <span className="hidden sm:inline ml-1.5">
          {generatingPptx ? "Генерация…" : "PPTX"}
        </span>
      </Button>
      <Button variant="outline" size="sm" onClick={handleDownloadAiPdf} disabled={generatingPdf}>
        <Sparkles className="h-4 w-4" />
        <span className="hidden sm:inline ml-1.5">
          {generatingPdf ? "Генерация..." : "AI PDF"}
        </span>
      </Button>
    </div>
  );
}
