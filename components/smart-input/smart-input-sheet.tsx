"use client";

import {
  Sheet,
  SheetContent,
  SheetTitle,
} from "@/components/ui/sheet";
import { SmartInput } from "./smart-input";

interface SmartInputSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultColumnId: string;
}

export function SmartInputSheet({ open, onOpenChange, defaultColumnId }: SmartInputSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="rounded-t-2xl px-0 pb-6">
        <SheetTitle className="sr-only">AI Smart Input</SheetTitle>
        <SmartInput defaultColumnId={defaultColumnId} />
      </SheetContent>
    </Sheet>
  );
}
