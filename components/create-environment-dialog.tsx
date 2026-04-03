"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ENVIRONMENT_COLORS } from "@/lib/db/schema";
import {
  createEnvironmentAction,
  switchEnvironmentAction,
} from "@/lib/actions/environments";
import { cn } from "@/lib/utils";

interface CreateEnvironmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  existingColors: string[];
}

export function CreateEnvironmentDialog({
  open,
  onOpenChange,
  existingColors,
}: CreateEnvironmentDialogProps) {
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(() => {
    return (
      ENVIRONMENT_COLORS.find((c) => !existingColors.includes(c)) ??
      ENVIRONMENT_COLORS[0]
    );
  });
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;

    startTransition(async () => {
      try {
        const env = await createEnvironmentAction(name.trim(), color);
        await switchEnvironmentAction(env.id);
        toast.success(`Среда «${env.name}» создана`);
        setName("");
        onOpenChange(false);
        router.refresh();
      } catch {
        toast.error("Не удалось создать среду");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Создать среду</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="env-name">Название</Label>
            <Input
              id="env-name"
              placeholder="Например: Работа"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoFocus
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Цвет</Label>
            <div className="flex gap-2.5 flex-wrap">
              {ENVIRONMENT_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={cn(
                    "size-8 rounded-full flex items-center justify-center transition-all",
                    color === c
                      ? "ring-2 ring-offset-2 ring-current scale-110"
                      : "opacity-50 hover:opacity-80"
                  )}
                  style={{ backgroundColor: c, color: c }}
                  onClick={() => setColor(c)}
                >
                  {color === c && <Check className="size-4 text-white" />}
                </button>
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isPending}
            >
              Отмена
            </Button>
            <Button type="submit" disabled={isPending || !name.trim()}>
              {isPending ? "Создание..." : "Создать"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
