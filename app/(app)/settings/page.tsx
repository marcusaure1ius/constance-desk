import { getColumns } from "@/lib/services/columns";
import { getCategories } from "@/lib/services/categories";
import { getEnvironments, getActiveEnvironment } from "@/lib/services/environments";
import { getActiveEnvironmentId } from "@/lib/environment";
import { ColumnsManager } from "@/components/settings/columns-manager";
import { CategoriesManager } from "@/components/settings/categories-manager";
import { EnvironmentsManager } from "@/components/settings/environments-manager";
import { PinChangeForm } from "@/components/settings/pin-change-form";
import { getNickname } from "@/lib/services/auth";
import { NicknameForm } from "@/components/settings/nickname-form";

export const dynamic = "force-dynamic";

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
    <div className="container mx-auto max-w-2xl px-4 py-6 space-y-6">
      <h1 className="text-2xl font-bold">Настройки</h1>
      <NicknameForm currentNickname={nickname ?? ""} />
      <EnvironmentsManager environments={envs} activeEnvironmentId={activeEnv.id} />
      <ColumnsManager columns={cols} environmentId={activeEnv.id} />
      <CategoriesManager categories={cats} environmentId={activeEnv.id} />
      <PinChangeForm />
    </div>
  );
}
