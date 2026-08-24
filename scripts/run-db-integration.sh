#!/usr/bin/env bash
#
# Интеграционные тесты на настоящей базе — `npm run test:integration:db`.
# Тем же кодом гоняются локально и в CI.
#
# Зачем обёртка, а не голый vitest. `vitest run` выходит с кодом 0, когда тесты
# пропущены: «1 passed, 12 skipped» — зелёный шаг. Значит покрытие можно было
# потерять молча: отвалилась TEST_DATABASE_URL или файл выпал из набора — база
# не проверена, а джоба зелёная. Здесь два барьера. До прогона: переменная
# обязана быть непустой. После прогона: хотя бы один тест выполнен и ни один не
# пропущен — «зелёный» обязан значить «проверено на базе».
#
# Набор задаётся вычитанием (все *.integration.test.ts, кроме живого Groq с его
# квотой), поэтому новый тест на базе попадает сюда сам.
set -euo pipefail

if [ -z "${TEST_DATABASE_URL:-}" ]; then
  echo "::error::TEST_DATABASE_URL пуст — интеграционным тестам нужна настоящая локальная PostgreSQL." >&2
  echo "Запуск: TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:55455/constance_ci npm run test:integration:db" >&2
  echo "Переменная берётся из окружения: .env.local этот барьер не читает — он срабатывает до vitest." >&2
  exit 1
fi

# Шаблон с X'ами задан явно: `mktemp -t prefix` дописывает суффикс сам только
# в BSD-версии, а GNU (ubuntu в CI) на такой строке падает.
report="$(mktemp "${TMPDIR:-/tmp}/constance-db-integration.XXXXXX")"
trap 'rm -f "$report"' EXIT

status=0
npm run test:integration -- \
  --exclude tests/groq.integration.test.ts \
  --reporter=default \
  --reporter=json --outputFile.json="$report" || status=$?

if [ "$status" -ne 0 ]; then
  exit "$status"
fi

node -e '
const { readFileSync } = require("node:fs");

let report;
try {
  report = JSON.parse(readFileSync(process.argv[1], "utf8"));
} catch (error) {
  console.error(`::error::vitest не оставил отчёт о прогоне: ${error.message}`);
  process.exit(1);
}

const passed = report.numPassedTests ?? 0;
const skipped = (report.numPendingTests ?? 0) + (report.numTodoTests ?? 0);

if (passed === 0) {
  console.error("::error::на базе не выполнено ни одного теста — прогон пустой, а не успешный.");
  process.exit(1);
}
if (skipped > 0) {
  console.error(`::error::пропущено тестов: ${skipped}. Пропуск на этом шаге — молча потерянное покрытие базы.`);
  process.exit(1);
}

console.log(`Тестов на настоящей базе выполнено: ${passed}.`);
' "$report"
