import { jwtVerify } from "jose";

/**
 * Проверка сессионной куки. Вынесена из `proxy.ts`, потому что понадобилась
 * второму месту: роуты под `/api/` проходят мимо proxy (он пропускает их,
 * рассчитывая на X-API-Key), а агентский роут зовёт браузер — у него не ключ
 * агента, а сессия.
 */

const secret = process.env.SESSION_SECRET;
if (!secret && process.env.NODE_ENV === "production") {
  throw new Error("SESSION_SECRET is required in production");
}

export const SESSION_COOKIE = "constance-session";

const SESSION_SECRET = new TextEncoder().encode(
  secret || "constance-default-secret-change-me"
);

export async function isSessionValid(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  try {
    await jwtVerify(token, SESSION_SECRET);
    return true;
  } catch {
    return false;
  }
}
