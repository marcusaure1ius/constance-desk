import path from "path";
import { loadEnv } from "vite";

/**
 * Общая часть двух прогонов vitest: `vitest.config.ts` (основной, офлайн)
 * и `vitest.integration.config.ts` (интеграционный, с сетью и базой).
 */

/** Файлы, которым нужен внешний мир: живой Groq или настоящая PostgreSQL. */
export const INTEGRATION_TESTS = "tests/**/*.integration.test.ts";

/** Алиас "@" на корень репозитория: рядом с этим файлом, а не от cwd. */
export function rootAlias() {
  return { "@": path.resolve(__dirname) };
}

/** Настройки, одинаковые для обоих прогонов. */
export function sharedTestOptions(mode: string) {
  return {
    globals: true,
    environment: "node" as const,
    env: loadEnv(mode, process.cwd(), ""),
  };
}
