import { defineConfig, defaultExclude } from "vitest/config";
import { INTEGRATION_TESTS, rootAlias, sharedTestOptions } from "./vitest.shared";

/**
 * Основной прогон (`npm test`) — офлайн и детерминированный.
 *
 * Интеграционные тесты исключены по маске: они ходят в живой Groq и в
 * настоящую базу, то есть зависят от чужой квоты и от локального окружения.
 * Исключение зашито в конфиг, а не в переменную окружения, потому что
 * `loadEnv(..., "")` ниже подтягивает `.env.local` целиком — любой
 * переключатель оттуда снова включил бы сеть.
 */
export default defineConfig(({ mode }) => {
  const shared = sharedTestOptions(mode);

  return {
    test: {
      ...shared,
      exclude: [...defaultExclude, INTEGRATION_TESTS],
      // Страховка: если сетевой тест попадёт в основной прогон, он упадёт
      // с внятным сообщением, а не молча уйдёт в интернет.
      setupFiles: ["./tests/helpers/no-network.ts"],
      // Ключи провайдеров лежат в .env.local и попали бы сюда через loadEnv.
      // Основной прогон не должен зависеть от того, какие из них заведены:
      // появление OPENROUTER_API_KEY в файле однажды уже поменяло поведение
      // офлайн-теста — он увидел второго провайдера и стал падать иначе.
      // Новый провайдер — новая строка здесь и в tests/test-isolation.test.ts.
      env: { ...shared.env, GROQ_API_KEY: "", OPENROUTER_API_KEY: "" },
    },
    resolve: { alias: rootAlias() },
  };
});
