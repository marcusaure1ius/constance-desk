import { defineConfig } from "vitest/config";
import { INTEGRATION_TESTS, rootAlias, sharedTestOptions } from "./vitest.shared";

/**
 * Интеграционный прогон (`npm run test:integration`) — только файлы
 * `*.integration.test.ts`. Здесь сеть разрешена, ключи и `TEST_DATABASE_URL`
 * берутся из окружения. Сами файлы падают, если нужного им ключа нет,
 * чтобы прогон не был «зелёным» из-за пропущенных тестов.
 */
export default defineConfig(({ mode }) => ({
  test: {
    ...sharedTestOptions(mode),
    include: [INTEGRATION_TESTS],
  },
  resolve: { alias: rootAlias() },
}));
