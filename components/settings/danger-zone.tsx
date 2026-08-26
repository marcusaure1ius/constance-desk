"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import { deleteAllDataAction } from "@/lib/actions/auth";

export function DangerZone() {
  const [open, setOpen] = useState(false);
  const [pin, setPin] = useState("");
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleDelete() {
    if (pin.length < 6) return;

    startTransition(async () => {
      const result = await deleteAllDataAction(pin);
      if (result.error) {
        toast.error(result.error);
        setPin("");
      } else {
        setOpen(false);
        router.push("/login");
      }
    });
  }

  return (
    <Card className="ring-destructive/30">
      <CardContent>
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <p className="flex items-center gap-2 text-sm font-medium text-destructive">
              <AlertTriangle className="size-4" />
              Удалить все данные
            </p>
            <p className="text-sm text-muted-foreground">
              Задачи, среды, колонки, эпики и настройки исчезнут без возможности вернуть.
            </p>
          </div>
          <Button
            variant="destructive"
            className="shrink-0"
            onClick={() => setOpen(true)}
          >
            Удалить
          </Button>
        </div>

        <Dialog open={open} onOpenChange={(v) => { setOpen(v); setPin(""); }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Подтверждение удаления</DialogTitle>
              <DialogDescription>
                Это действие необратимо. Введите PIN для подтверждения.
              </DialogDescription>
            </DialogHeader>
            <div className="flex justify-center py-4">
              <InputOTP maxLength={6} value={pin} onChange={setPin}>
                <InputOTPGroup>
                  {Array.from({ length: 6 }).map((_, i) => (
                    <InputOTPSlot key={i} index={i} />
                  ))}
                </InputOTPGroup>
              </InputOTP>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => { setOpen(false); setPin(""); }}>
                Отмена
              </Button>
              <Button
                variant="destructive"
                onClick={handleDelete}
                disabled={pin.length < 6 || isPending}
              >
                {isPending ? "Удаление..." : "Удалить всё"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
