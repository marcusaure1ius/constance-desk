"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@/components/ui/card";
import { changePinAction } from "@/lib/actions/auth";

export function PinChangeForm() {
  const [currentPin, setCurrentPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [isPending, startTransition] = useTransition();

  function handleSubmit() {
    if (currentPin.length < 6 || newPin.length < 6 || confirmPin.length < 6) {
      toast.error("Заполните все поля");
      return;
    }

    if (newPin !== confirmPin) {
      toast.error("Новый PIN и подтверждение не совпадают");
      setNewPin("");
      setConfirmPin("");
      return;
    }

    startTransition(async () => {
      const result = await changePinAction(currentPin, newPin);
      if (result.error) {
        toast.error(result.error);
        setCurrentPin("");
        setNewPin("");
        setConfirmPin("");
      } else {
        toast.success("PIN успешно изменён");
        setCurrentPin("");
        setNewPin("");
        setConfirmPin("");
      }
    });
  }

  const isReady =
    currentPin.length === 6 && newPin.length === 6 && confirmPin.length === 6;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Изменить PIN</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1">
          <p className="text-sm text-muted-foreground">Текущий PIN</p>
          <InputOTP maxLength={6} value={currentPin} onChange={setCurrentPin}>
            <InputOTPGroup>
              {Array.from({ length: 6 }).map((_, i) => (
                <InputOTPSlot key={i} index={i} />
              ))}
            </InputOTPGroup>
          </InputOTP>
        </div>

        <div className="space-y-1">
          <p className="text-sm text-muted-foreground">Новый PIN</p>
          <InputOTP maxLength={6} value={newPin} onChange={setNewPin}>
            <InputOTPGroup>
              {Array.from({ length: 6 }).map((_, i) => (
                <InputOTPSlot key={i} index={i} />
              ))}
            </InputOTPGroup>
          </InputOTP>
        </div>

        <div className="space-y-1">
          <p className="text-sm text-muted-foreground">Подтвердите новый PIN</p>
          <InputOTP maxLength={6} value={confirmPin} onChange={setConfirmPin}>
            <InputOTPGroup>
              {Array.from({ length: 6 }).map((_, i) => (
                <InputOTPSlot key={i} index={i} />
              ))}
            </InputOTPGroup>
          </InputOTP>
        </div>

        <Button onClick={handleSubmit} disabled={!isReady || isPending}>
          {isPending ? "Сохранение..." : "Изменить PIN"}
        </Button>
      </CardContent>
    </Card>
  );
}
