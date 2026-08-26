"use client";

import { PanelBottom, PanelRight } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@/components/ui/card";
import { useBoardView, type AgentLayout } from "@/hooks/use-board-view";

const AGENT_LAYOUTS: { value: AgentLayout; label: string; icon: typeof PanelBottom }[] = [
  { value: "dock", label: "Снизу", icon: PanelBottom },
  { value: "panel", label: "Справа", icon: PanelRight },
];

/**
 * Настройки вида доски. Живут в localStorage рядом с режимом доски и
 * свёрнутыми дорожками, поэтому сохраняются сразу и без обращения к серверу.
 */
export function BoardSettings() {
  const { showEmptyEpics, setShowEmptyEpics, agentLayout, setAgentLayout } =
    useBoardView();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Отображение</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <label className="flex items-start justify-between gap-4 cursor-pointer">
          <div className="space-y-1">
            <div className="text-sm font-medium">
              Отображать пустые группировки эпиков
            </div>
            <p className="text-sm text-muted-foreground">
              Выключено — в виде эпиков остаются только дорожки с задачами.
              При поиске и фильтрах пустые дорожки тоже скрываются.
            </p>
          </div>
          <Switch
            className="mt-0.5 shrink-0"
            checked={showEmptyEpics}
            onCheckedChange={setShowEmptyEpics}
          />
        </label>

        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="text-sm font-medium">Панель агента</div>
            <p className="text-sm text-muted-foreground">
              Снизу — лента разворачивается над полем ввода и сворачивается,
              когда уводишь курсор. Справа — колонка во всю высоту рядом с доской.
            </p>
          </div>
          <div className="mt-0.5 flex shrink-0 items-center gap-0.5 rounded-full bg-muted p-0.5">
            {AGENT_LAYOUTS.map(({ value, label, icon: Icon }) => (
              <button
                key={value}
                type="button"
                onClick={() => setAgentLayout(value)}
                className={cn(
                  "flex items-center gap-1 rounded-full px-2.5 py-1 text-xs transition-colors",
                  agentLayout === value
                    ? "bg-background shadow-sm"
                    : "text-muted-foreground"
                )}
              >
                <Icon className="size-3" />
                {label}
              </button>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
