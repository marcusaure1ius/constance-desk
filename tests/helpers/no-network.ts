/**
 * setupFile основного прогона: сеть запрещена.
 *
 * Причина — T-0009: `tests/groq.integration.test.ts` ходил в живой Groq на
 * каждом `npm test` и валился по HTTP 429. Маска в `vitest.config.ts` убирает
 * известные сетевые файлы, а этот перехват ловит новые: тест, забывший
 * замокать fetch, падает ассертом со внятным текстом вместо похода наружу.
 *
 * `vi.spyOn(globalThis, "fetch")` в тестах по-прежнему работает: заглушка —
 * обычное записываемое свойство.
 */
function describeTarget(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

const blockedFetch = ((input: RequestInfo | URL) => {
  throw new Error(
    `Основной прогон тестов не ходит в сеть, но код запросил ${describeTarget(input)}. ` +
      'Замокайте fetch (vi.spyOn(globalThis, "fetch")) или перенесите тест в ' +
      "*.integration.test.ts и запускайте через npm run test:integration."
  );
}) as typeof fetch;

globalThis.fetch = blockedFetch;
