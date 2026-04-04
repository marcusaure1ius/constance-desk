import { Suspense } from "react";
import { AppShell } from "@/components/app-shell";
import { getActiveEnvironmentId } from "@/lib/environment";
import { getActiveEnvironment, getEnvironments } from "@/lib/services/environments";
import { getNickname } from "@/lib/services/auth";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const cookieValue = await getActiveEnvironmentId();
  const [activeEnv, allEnvs, nickname] = await Promise.all([
    getActiveEnvironment(cookieValue),
    getEnvironments(),
    getNickname(),
  ]);

  return (
    <Suspense>
      <AppShell activeEnvironment={activeEnv} environments={allEnvs} nickname={nickname}>
        {children}
      </AppShell>
    </Suspense>
  );
}
