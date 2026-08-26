"use client";

import { Checkbox } from "@/components/ui/checkbox";
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
        <CardTitle>Доска</CardTitle>
      </CardHeader>
      <CardContent>
        <label className="flex items-start gap-3 cursor-pointer">
          <Checkbox
            className="mt-0.5"
            checked={showEmptyEpics}
            onCheckedChange={setShowEmptyEpics}
          />
          <div className="space-y-1">
            <div className="text-sm font-medium">
              Отображать пустые группировки эпиков
            </div>
            <p className="text-sm text-muted-foreground">
              Выключено — в виде эпиков остаются только дорожки с задачами.
              При поиске и фильтрах пустые дорожки тоже скрываются.
            </p>
          </div>
        </label>
      </CardContent>
    </Card>
  );
}
