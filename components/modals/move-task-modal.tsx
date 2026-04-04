"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

type Column = { id: string; title: string; position: number };

interface MoveTaskModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  columns: Column[];
  currentColumnId: string;
  onSelect: (columnId: string) => void;
}

export function MoveTaskModal({
  open,
  onOpenChange,
  columns,
  currentColumnId,
  onSelect,
}: MoveTaskModalProps) {
  const otherColumns = columns
    .filter((c) => c.id !== currentColumnId)
    .sort((a, b) => a.position - b.position);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xs">
        <DialogHeader>
          <DialogTitle>Переместить в</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          {otherColumns.map((col) => (
            <Button
              key={col.id}
              variant="outline"
              className="w-full justify-start"
              onClick={() => {
                onSelect(col.id);
                onOpenChange(false);
              }}
            >
              {col.title}
            </Button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
