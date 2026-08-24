#!/usr/bin/env bash
#
# Страж дрейфа: схема в lib/db/schema.ts обязана быть покрыта миграциями.
#
#   npm run db:drift
#
# Почему не просто `db:generate < /dev/null` с проверкой git-статуса.
# Перенаправление снимает зависание на интерактивном вопросе, но drizzle-kit в
# этом случае печатает «Interactive prompts require a TTY terminal» и **выходит
# с кодом 0**, ничего не сгенерировав. Переименование колонки (drizzle-kit
# спрашивает «переименована или удалена+добавлена») проходило шаг зелёным, а
# миграция не появлялась.
#
# Поэтому шаг устроен на положительном признаке успеха, а не на отсутствии
# признаков беды: drizzle-kit обязан сказать, что менять нечего. Любой другой
# исход — интерактивный вопрос, падение, новый файл миграции — роняет шаг.
set -euo pipefail

cd "$(dirname "$0")/.."

# Маркер успеха drizzle-kit generate: изменений нет, генерировать нечего.
SUCCESS_MARKER='No schema changes, nothing to migrate'

fail() {
  echo "::error::$1"
  exit 1
}

# Грязный drizzle/ до старта сделал бы вывод шага бессмысленным: непонятно,
# чьи это файлы — наши или сгенерированные сейчас.
if [ -n "$(git status --porcelain drizzle/)" ]; then
  git status --porcelain drizzle/
  fail "каталог drizzle/ изменён ещё до проверки — зафиксируйте или уберите изменения"
fi

# stdin закрыт намеренно: без этого drizzle-kit ждал бы ответа вечно.
# Вывод перехватывается целиком (и stdout, и stderr) — по нему и судим.
set +e
output=$(npm run --silent db:generate < /dev/null 2>&1)
status=$?
set -e

echo "$output"

if [ "$status" -ne 0 ]; then
  fail "npm run db:generate завершился с кодом $status"
fi

# Тот самый случай: код 0, а на деле drizzle-kit упёрся в вопрос к человеку.
if printf '%s' "$output" | grep -qiE 'require a TTY|Interactive prompts'; then
  fail "drizzle-kit требует интерактивного ответа (похоже на переименование колонки). Запустите npm run db:generate локально, ответьте на вопрос и закоммитьте drizzle/"
fi

# Обычный дрейф: schema.ts правили, а db:generate не запускали — миграция
# появилась только что. Проверяется раньше маркера успеха, потому что
# сообщение здесь конкретнее.
if [ -n "$(git status --porcelain drizzle/)" ] || ! git diff --quiet --exit-code drizzle/; then
  git --no-pager diff --stat drizzle/
  git status --porcelain drizzle/
  fail "schema.ts изменён без миграции. Запустите npm run db:generate и закоммитьте drizzle/"
fi

# Ловушка на всё остальное: drizzle-kit обязан сказать, что менять нечего.
# Любой другой исход, даже с кодом 0 и чистым drizzle/, — повод разбираться,
# а не проходить дальше.
if ! printf '%s' "$output" | grep -qF "${SUCCESS_MARKER}"; then
  fail "db:generate не сказал: ${SUCCESS_MARKER}. Схема разошлась с миграциями либо drizzle-kit отработал не так, как ждёт этот шаг"
fi

echo "Схема покрыта миграциями."
