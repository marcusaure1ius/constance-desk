"use client";

import { Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useBoardView } from "@/hooks/use-board-view";

export function BoardViewToggle() {
  const { mode, setMode } = useBoardView();
  const active = mode === "epics";

  return (
    <Button
      variant={active ? "default" : "outline"}
      size="icon"
      className="size-9"
      aria-pressed={active}
      title="Вид по эпикам"
      onClick={() => setMode(active ? "columns" : "epics")}
    >
      <Layers className="size-4" />
    </Button>
  );
}
