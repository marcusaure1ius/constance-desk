import type { ReactNode } from "react";
import { getColumns } from "@/lib/services/columns";
import { getCategories } from "@/lib/services/categories";
import { getEnvironments, getActiveEnvironment } from "@/lib/services/environments";
import { getActiveEnvironmentId } from "@/lib/environment";
import { getNickname } from "@/lib/services/auth";
import { ColumnsManager } from "@/components/settings/columns-manager";
import { CategoriesManager } from "@/components/settings/categories-manager";
import { EnvironmentsManager } from "@/components/settings/environments-manager";
import { BoardSettings } from "@/components/settings/board-settings";
import { PinChangeForm } from "@/components/settings/pin-change-form";
import { NicknameForm } from "@/components/settings/nickname-form";
import { DangerZone } from "@/components/settings/danger-zone";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

function GroupLabel({
  children,
  className,
}: {
  children: string;
  className?: string;
}) {
  return (
    <h2
      className={cn(
        "text-xs font-medium uppercase tracking-wider text-muted-foreground",
        className
      )}
    >
      {children}
    </h2>
  );
}

/**
 * Ячейка сетки. Сама ячейка — grid, поэтому карточка внутри растягивается на
 * всю высоту строки и соседи по строке стоят вровень.
 */
function Cell({ className, children }: { className: string; children: ReactNode }) {
  return <div className={cn("grid", className)}>{children}</div>;
}

export default async function SettingsPage() {
  const cookieValue = await getActiveEnvironmentId();
  const activeEnv = await getActiveEnvironment(cookieValue);

  if (!activeEnv) return null;

  const [cols, cats, envs, nickname] = await Promise.all([
    getColumns(activeEnv.id),
    getCategories(activeEnv.id),
    getEnvironments(),
    getNickname(),
  ]);

  return (
    <div className="mx-auto w-full max-w-[1536px] px-4 py-6">
      <h1 className="mb-6 text-2xl font-bold">Настройки</h1>

      {/*
        Порядок в разметке — мобильный: сначала группа «Аккаунт», следом
        «Доска». На широком экране карточки расставлены по строкам явно, чтобы
        верхний ряд трёх колонок стоял одной линией.
      */}
      <div className="grid gap-4 xl:grid-cols-[22rem_minmax(0,1fr)_minmax(0,1fr)] xl:gap-x-6 xl:gap-y-6">
        <GroupLabel className="xl:col-start-1 xl:row-start-1 xl:self-end">
          Аккаунт
        </GroupLabel>

        <Cell className="xl:col-start-1 xl:row-start-2">
          <NicknameForm currentNickname={nickname ?? ""} />
        </Cell>
        <Cell className="xl:col-start-1 xl:row-start-3">
          <PinChangeForm />
        </Cell>
        <Cell className="xl:col-start-1 xl:row-start-4">
          <DangerZone />
        </Cell>

        <GroupLabel className="mt-4 xl:col-start-2 xl:row-start-1 xl:mt-0 xl:self-end">
          Доска
        </GroupLabel>

        <Cell className="xl:col-start-2 xl:row-start-2">
          <BoardSettings />
        </Cell>
        <Cell className="xl:col-start-3 xl:row-start-2">
          <EnvironmentsManager
            environments={envs}
            activeEnvironmentId={activeEnv.id}
          />
        </Cell>
        <Cell className="xl:col-start-2 xl:row-start-3">
          <ColumnsManager columns={cols} environmentId={activeEnv.id} />
        </Cell>
        <Cell className="xl:col-start-3 xl:row-start-3">
          <CategoriesManager categories={cats} environmentId={activeEnv.id} />
        </Cell>
      </div>
    </div>
  );
}
