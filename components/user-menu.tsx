"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LogOut, Plus, Check, Moon, Sun } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { logoutAction } from "@/lib/actions/auth";
import { switchEnvironmentAction } from "@/lib/actions/environments";
import { CreateEnvironmentDialog } from "@/components/create-environment-dialog";
import { useThemeTransition } from "@/hooks/use-theme-transition";

type Environment = {
  id: string;
  name: string;
  color: string;
  position: number;
};

interface UserMenuProps {
  activeEnvironment: Environment | null;
  environments: Environment[];
}

export function UserMenu({ activeEnvironment, environments }: UserMenuProps) {
  const [isPending, startTransition] = useTransition();
  const [createOpen, setCreateOpen] = useState(false);
  const router = useRouter();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const { isDark, toggleTheme } = useThemeTransition();

  async function handleLogout() {
    await logoutAction();
    router.push("/login");
  }

  function handleSwitch(envId: string) {
    if (envId === activeEnvironment?.id) return;
    startTransition(async () => {
      await switchEnvironmentAction(envId);
      router.refresh();
    });
  }

  const ringColor = activeEnvironment?.color ?? "#3b82f6";

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          ref={triggerRef}
          className="cursor-pointer rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <Avatar
            className="border-[3px]"
            style={{ borderColor: ringColor }}
          >
            <AvatarFallback>C</AvatarFallback>
          </Avatar>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" sideOffset={8} className="min-w-48">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Среды</DropdownMenuLabel>
            {environments.map((env) => (
              <DropdownMenuItem
                key={env.id}
                onClick={() => handleSwitch(env.id)}
                disabled={isPending}
              >
                <span
                  className="size-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: env.color }}
                />
                <span className="flex-1">{env.name}</span>
                {env.id === activeEnvironment?.id && (
                  <Check className="size-4 text-primary" />
                )}
              </DropdownMenuItem>
            ))}
            <DropdownMenuItem
              onClick={() => setTimeout(() => setCreateOpen(true), 100)}
              disabled={isPending}
            >
              <Plus className="size-4 text-muted-foreground" />
              <span className="text-muted-foreground">Создать</span>
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            closeOnClick={false}
            onClick={() => toggleTheme(triggerRef)}
          >
            {isDark ? <Moon className="size-4" /> : <Sun className="size-4" />}
            <span className="flex-1">Тёмная тема</span>
            <Switch
              size="sm"
              checked={isDark}
              tabIndex={-1}
              onClick={(e) => e.stopPropagation()}
            />
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={handleLogout} disabled={isPending}>
            <LogOut />
            Выйти
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <CreateEnvironmentDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        existingColors={environments.map((e) => e.color)}
      />
    </>
  );
}
