"use client";

import { Switch } from "@/components/ui/switch";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@/components/ui/card";
import { useBoardView } from "@/hooks/use-board-view";

/**
 * Настройки вида доски. Живут в localStorage рядом с режимом доски и
 * свёрнутыми дорожками, поэтому сохраняются сразу и без обращения к серверу.
 */
export function BoardSettings() {
  const { showEmptyEpics, setShowEmptyEpics } = useBoardView();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Отображение</CardTitle>
      </CardHeader>
      <CardContent>
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
      </CardContent>
    </Card>
  );
}
