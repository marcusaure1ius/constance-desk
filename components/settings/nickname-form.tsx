"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@/components/ui/card";
import { updateNicknameAction } from "@/lib/actions/auth";

interface NicknameFormProps {
  currentNickname: string;
}

export function NicknameForm({ currentNickname }: NicknameFormProps) {
  const [nickname, setNickname] = useState(currentNickname);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleSubmit() {
    if (!nickname.trim()) {
      toast.error("Ник не может быть пустым");
      return;
    }

    startTransition(async () => {
      const result = await updateNicknameAction(nickname.trim());
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success("Ник обновлён");
        router.refresh();
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Профиль</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1">
          <label htmlFor="settings-nickname" className="text-sm text-muted-foreground">
            Ник
          </label>
          <Input
            id="settings-nickname"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            placeholder="Ваш ник"
            maxLength={50}
          />
        </div>
        <Button
          onClick={handleSubmit}
          disabled={!nickname.trim() || nickname.trim() === currentNickname || isPending}
        >
          {isPending ? "Сохранение..." : "Сохранить"}
        </Button>
      </CardContent>
    </Card>
  );
}
