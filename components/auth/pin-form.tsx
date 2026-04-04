"use client";

import { useState, useTransition } from "react";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { loginAction, setupPinAction } from "@/lib/actions/auth";
import { useRouter } from "next/navigation";

interface PinFormProps {
  mode: "login" | "setup";
}

export function PinForm({ mode }: PinFormProps) {
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [nickname, setNickname] = useState("");
  const [error, setError] = useState("");
  const [step, setStep] = useState<"enter" | "confirm">("enter");
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleSubmit() {
    if (mode === "setup" && step === "enter") {
      setStep("confirm");
      setConfirmPin("");
      return;
    }

    if (mode === "setup" && step === "confirm") {
      if (pin !== confirmPin) {
        setError("PIN-коды не совпадают");
        setStep("enter");
        setPin("");
        setConfirmPin("");
        return;
      }
    }

    startTransition(async () => {
      const result =
        mode === "setup"
          ? await setupPinAction(pin, nickname.trim())
          : await loginAction(pin);
      if (result.error) {
        setError(result.error);
        setPin("");
        setConfirmPin("");
        setStep("enter");
      } else {
        router.push("/");
        router.refresh();
      }
    });
  }

  const currentValue = step === "confirm" ? confirmPin : pin;
  const setCurrentValue = step === "confirm" ? setConfirmPin : setPin;

  return (
    <div className="flex flex-col items-center gap-6">
      <h1 className="text-2xl font-bold">
        {mode === "setup"
          ? step === "confirm"
            ? "Подтвердите PIN"
            : "Придумайте PIN"
          : "Введите PIN"}
      </h1>
      {mode === "setup" && step === "enter" && (
        <div className="w-full space-y-1">
          <label htmlFor="nickname" className="text-sm text-muted-foreground">
            Ваш ник
          </label>
          <Input
            id="nickname"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            placeholder="Например, Алексей"
            maxLength={50}
            autoFocus
          />
        </div>
      )}
      <InputOTP
        maxLength={6}
        value={currentValue}
        onChange={setCurrentValue}
        onComplete={handleSubmit}
      >
        <InputOTPGroup>
          {Array.from({ length: 6 }).map((_, i) => (
            <InputOTPSlot key={i} index={i} />
          ))}
        </InputOTPGroup>
      </InputOTP>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button
        onClick={handleSubmit}
        disabled={
          currentValue.length < 6 ||
          isPending ||
          (mode === "setup" && step === "enter" && !nickname.trim())
        }
      >
        {isPending
          ? "Проверка..."
          : mode === "setup" && step === "enter"
            ? "Далее"
            : "Войти"}
      </Button>
    </div>
  );
}
