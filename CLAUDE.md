@AGENTS.md

# Constance — канбан-доска

## Стек
- Next.js 16, React 19, TypeScript
- UI: shadcn/ui на базе `@base-ui/react` (НЕ radix), Tailwind CSS 4, lucide-react
- DB: Drizzle ORM + Neon PostgreSQL
- Тесты: vitest
- DnD: @hello-pangea/dnd
- AI: `lib/llm/` — общий OpenAI-совместимый клиент (`client.ts`), Groq первым и OpenRouter вторым при 429. Захват из телеграма — `capture.ts` (gpt-oss-120b), веб-форма SmartInput — `parse-tasks.ts` (gpt-oss-20b), голос — `transcribe.ts` (whisper, только Groq)
- Auth: PIN-код через jose JWT, `proxy.ts` (Next.js 16) + проверка в API
- Отчёты: @react-pdf/renderer (PDF), pptxgenjs (PPTX), recharts (графики)
- Телеграм-бот: вебхук `app/api/telegram/webhook`, клиент Bot API `lib/telegram/client.ts` (разметка HTML, не MarkdownV2). Захват сообщения в задачи — `lib/telegram/capture.ts`
- `TELEGRAM_CAPTURE_DRY_RUN=1` — бот разбирает сообщения и показывает разбор, но задач на доске НЕ создаёт. Чтение доски, поиск и кнопки управления существующими задачами работают как обычно
- Модель OpenRouter — `deepseek/deepseek-v4-flash` (стабильный slug, без даты и без `~…-latest`)

## Структура маршрутов
- `app/(app)/(board)/page.tsx` — доска (route group для изоляции loading.tsx)
- `app/(app)/today/page.tsx` — план на день
- `app/(app)/report/page.tsx` — отчёт
- `app/(app)/settings/page.tsx` — настройки
- `app/(auth)/login/page.tsx` — авторизация
- `app/api/` — API routes: ai/{parse-tasks,transcribe}, auth, report, tasks/{,batch,[id]} (защита через `lib/api-auth.ts`)
- `app/api/telegram/webhook` — вебхук бота: секрет в заголовке, вся логика в `lib/telegram/handle-update.ts` (в тестах `after()` не исполняется, поэтому роут — шим)

## Архитектура
- **Server Actions** (`lib/actions/`) → **Services** (`lib/services/`) → **DB** (`lib/db/`)
- Actions: `"use server"`, вызывают сервисы, делают `revalidatePath`
- Services: чистая бизнес-логика и запросы Drizzle, без Next.js зависимостей
- Схема БД: `lib/db/schema.ts` — environments → columns → tasks, categories
- Активная среда хранится в cookie (`lib/environment.ts`)
- Управление задачами из бота: `lib/telegram/task-card.ts` — коды кнопок и рендер карточек (`callback_data` ≤ 64 байт, UUID пакуется в base64url на 22 символа), `lib/telegram/manage.ts` — выполнение нажатий. Бот НИКОГДА не закрывает и не правит задачу по фразе: только найти → показать → нажать кнопку. Подменю раскрываются в том же сообщении через `editMessageText`
- Состояния за кнопками (поисковый запрос, ожидание ввода) — таблица `tg_handles`, TTL 7 дней; столько же живут сами инлайн-кнопки, дальше карточка отвечает «устарели» и снимает клавиатуру
- `APP_BASE_URL` (или `VERCEL_PROJECT_PRODUCTION_URL`) — корень приложения для кнопки «Открыть на доске». Не задан — кнопки просто нет
- Инструменты агентов: единый реестр `lib/agent/tools.ts` (`defineTool` из `lib/agent/tool-registry.ts`, флаги `surfaces` и `mutation`). MCP-роут и бот перебирают реестр — инлайн-определений инструментов в роутах быть не должно
- Захват из телеграма: сообщение → `lib/llm/capture.ts` (один вызов модели, список типизированных элементов) → `lib/telegram/capture.ts` (элементы `task` в первую колонку активной среды, карточка ответа). Формулировка автора не переписывается: снимаются только «Надо/Нужно» в начале и `@упоминания`, перевод на английский откатывается к словам автора

## Тесты
- Расположение: `tests/` (не `__tests__/`)
- Unit-тесты сервисов: `tests/{tasks,columns,categories,...}.test.ts`
- **`npm test` — основной прогон: офлайн.** Файлы `*.integration.test.ts` исключены маской в `vitest.config.ts`, `fetch` заглушен через `tests/helpers/no-network.ts`, `GROQ_API_KEY` подменён пустым. Сетевой тест здесь падает с подсказкой: либо мокайте `fetch`, либо переносите файл в `*.integration.test.ts`. В CI — джоба `test`
- **`npm run test:integration` — всё, что ходит наружу** (конфиг `vitest.integration.config.ts`, только `*.integration.test.ts`). Пропусков (`describe.skipIf`) там нет намеренно: без ключа или без базы прогон падает, а не зеленеет с нулём проверок
  - `npm run test:integration:db` — тесты на настоящей БД, обёртка `scripts/run-db-integration.sh`. Набор задан **вычитанием** (`--exclude` живого Groq лежит в обёртке), а не списком файлов: новый `*.integration.test.ts` попадает в CI сам, а переименование файла не сужает прогон молча. Берут `TEST_DATABASE_URL` (и только его, никогда `DATABASE_URL`), хост обязан быть локальным. Обёртка сторожит прогон с двух сторон: переменная обязана быть непустой до старта, а после прогона обязан быть хотя бы один выполненный тест и ни одного пропущенного — сам `vitest` выходит с кодом 0 и на строке «16 passed, 8 skipped». В CI — шаг джобы `migrations`
  - `npm run test:integration:groq` — реальные запросы к Groq (`tests/groq.integration.test.ts`), нужен `GROQ_API_KEY`. В CI только вручную (джоба `groq-integration`, `workflow_dispatch`): у ключа квота, из-за неё `npm test` и падал по HTTP 429. Появится ещё один тест с живой сетью — допишите его в `--exclude` скрипта `:db`, иначе он уедет в джобу с базой
- `tests/test-isolation.test.ts` сторожит эту схему: сломается, если из конфига убрать заглушку сети или подмену ключа

## Команды
- `npm run dev` — dev-сервер
- `npm run build` — билд
- `npm test` — vitest run (офлайн, без интеграционных)
- `npm run test:integration` — интеграционные (`:db` — на настоящей БД, `:groq` — живой Groq)
- `npm run db:push` / `db:migrate` — применить схему / миграции к БД
- `npm run db:generate` — сгенерировать миграции Drizzle
- `npm run db:drift` — проверить, что схема покрыта миграциями (тот же шаг, что в CI)
- `npm run db:studio` — GUI Drizzle Studio
- `npm run db:seed` — заполнить БД тестовыми данными
- `npm run tg:inspect -- 20` — показать последние апдейты бота и что он из них понял (нужен `DATABASE_URL`)
- `npm run tg:webhook -- set <URL>` — поставить вебхук бота и команды меню; `info`, `commands`, `delete`

## Команды по базе целятся в прод по умолчанию
`drizzle.config.ts` подтягивает `.env.local`, где боевой Neon-URL. Поэтому
`db:migrate`, `db:push` и `db:baseline --apply` проходят через барьер
`lib/db/db-host.ts`: нелокальный хост требует флага `--i-know-its-production`
и печатается перед запуском. Локальность считается там же — не пишите вторую
копию проверки (её уже приходилось чинить из-за `LOCALHOST` в верхнем регистре:
для схемы `postgresql:` `new URL()` регистр хоста не понижает).

## Соглашения
- Весь UI-текст и коммиты на русском
- `useSearchParams()` требует `<Suspense>` boundary (иначе CSR bailout в Next.js 16)
- `loading.tsx` в route group `(board)` — не класть в `(app)` напрямую, иначе skeleton покажется на всех страницах
