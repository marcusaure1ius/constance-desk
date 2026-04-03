"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Trash2, Check, X } from "lucide-react";
import { toast } from "sonner";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ENVIRONMENT_COLORS } from "@/lib/db/schema";
import {
  updateEnvironmentAction,
  deleteEnvironmentAction,
  switchEnvironmentAction,
} from "@/lib/actions/environments";
import { cn } from "@/lib/utils";

type Environment = {
  id: string;
  name: string;
  color: string;
  position: number;
};

interface EnvironmentsManagerProps {
  environments: Environment[];
  activeEnvironmentId: string;
}

export function EnvironmentsManager({
  environments: initialEnvs,
  activeEnvironmentId,
}: EnvironmentsManagerProps) {
  const [envs, setEnvs] = useState(initialEnvs);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<Environment | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function startEdit(env: Environment) {
    setEditingId(env.id);
    setEditName(env.name);
    setEditColor(env.color);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditName("");
    setEditColor("");
  }

  function handleUpdate(id: string) {
    if (!editName.trim()) return;
    startTransition(async () => {
      const updated = await updateEnvironmentAction(id, {
        name: editName.trim(),
        color: editColor,
      });
      setEnvs((prev) =>
        prev.map((e) =>
          e.id === id ? { ...e, name: updated.name, color: updated.color } : e
        )
      );
      setEditingId(null);
      router.refresh();
    });
  }

  function handleDelete(env: Environment) {
    startTransition(async () => {
      const result = await deleteEnvironmentAction(env.id);
      if (result && "error" in result && result.error) {
        toast.error(result.error);
        return;
      }
      setEnvs((prev) => prev.filter((e) => e.id !== env.id));
      setDeleteTarget(null);

      // Если удалили активную среду — переключиться на первую оставшуюся
      if (env.id === activeEnvironmentId) {
        const remaining = envs.filter((e) => e.id !== env.id);
        if (remaining.length > 0) {
          await switchEnvironmentAction(remaining[0].id);
        }
      }
      router.refresh();
    });
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Среды</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {envs.map((env) => (
            <div key={env.id} className="flex items-center gap-2">
              {editingId === env.id ? (
                <>
                  <div className="flex gap-1.5 shrink-0">
                    {ENVIRONMENT_COLORS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        className={cn(
                          "size-5 rounded-full transition-all",
                          editColor === c
                            ? "ring-2 ring-offset-1 ring-current scale-110"
                            : "opacity-40 hover:opacity-70"
                        )}
                        style={{ backgroundColor: c, color: c }}
                        onClick={() => setEditColor(c)}
                      />
                    ))}
                  </div>
                  <Input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleUpdate(env.id);
                      if (e.key === "Escape") cancelEdit();
                    }}
                    className="flex-1"
                    autoFocus
                  />
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => handleUpdate(env.id)}
                    disabled={isPending}
                  >
                    <Check className="size-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={cancelEdit}
                    disabled={isPending}
                  >
                    <X className="size-4" />
                  </Button>
                </>
              ) : (
                <>
                  <span
                    className="size-3 rounded-full shrink-0"
                    style={{ backgroundColor: env.color }}
                  />
                  <span className="flex-1 text-sm">
                    {env.name}
                    {env.id === activeEnvironmentId && (
                      <span className="ml-2 text-xs text-muted-foreground">(активная)</span>
                    )}
                  </span>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => startEdit(env)}
                    disabled={isPending}
                  >
                    <Pencil className="size-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => setDeleteTarget(env)}
                    disabled={isPending || envs.length <= 1}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить среду «{deleteTarget?.name}»?</AlertDialogTitle>
            <AlertDialogDescription>
              Все колонки, категории и задачи этой среды будут безвозвратно удалены.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteTarget && handleDelete(deleteTarget)}
              disabled={isPending}
            >
              {isPending ? "Удаление..." : "Удалить"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
