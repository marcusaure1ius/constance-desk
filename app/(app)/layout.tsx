import { Suspense } from "react";
import { AppShell } from "@/components/app-shell";
import { getActiveEnvironmentId } from "@/lib/environment";
import { getActiveEnvironment, getEnvironments } from "@/lib/services/environments";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const cookieValue = await getActiveEnvironmentId();
  const [activeEnv, allEnvs] = await Promise.all([
    getActiveEnvironment(cookieValue),
    getEnvironments(),
  ]);

  return (
    <Suspense>
      <AppShell activeEnvironment={activeEnv} environments={allEnvs}>
        {children}
      </AppShell>
    </Suspense>
  );
}
