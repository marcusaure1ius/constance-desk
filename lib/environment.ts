import { cookies } from "next/headers";

const COOKIE_NAME = "activeEnvironmentId";

export async function getActiveEnvironmentId(): Promise<string | undefined> {
  const cookieStore = await cookies();
  return cookieStore.get(COOKIE_NAME)?.value;
}

export async function setActiveEnvironmentId(envId: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, envId, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 365, // 1 год
  });
}
