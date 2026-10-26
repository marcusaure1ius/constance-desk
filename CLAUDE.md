@AGENTS.md

# Constance — канбан-доска

## Стек
- Next.js 16, React 19, TypeScript
- UI: shadcn/ui на базе `@base-ui/react` (НЕ radix), Tailwind CSS 4, lucide-react
- DB: Drizzle ORM + Neon PostgreSQL
- Тесты: vitest
- DnD: @hello-pangea/dnd
- AI: `lib/llm/` — клиент OpenRouter (`client.ts`, единственный провайдер, Groq убран; ключ `OPENROUTER_API_KEY`). Все чат-задачи — одна базовая модель `MODELS` (DeepSeek Flash): агент захвата из телеграма (`capture-prompt.ts`), веб-форма SmartInput — `parse-tasks.ts`, агент, ИИ-разбор PDF-отчёта. Голос — `transcribe.ts` (`openai/whisper-large-v3` через `/audio/transcriptions` OpenRouter, ogg/opus из телеграма принимает как есть)
- Auth: PIN-код через jose JWT, `proxy.ts` (Next.js 16) + проверка в API
- Отчёты: @react-pdf/renderer (PDF), recharts (графики). Недельный слайд — Google Slides API: клиент `lib/google/` (JWT сервисного аккаунта через `jose`, без `googleapis`), шаблон слайда — чистая функция `lib/slides-report/build-slide.ts`, выгрузка — `lib/services/slides-export.ts`, модалка — `components/report/slides-export-dialog.tsx`
- `GOOGLE_SERVICE_ACCOUNT_KEY` (JSON ключа или base64 от него) и `GOOGLE_SLIDES_PRESENTATION_ID` — выгрузка слайда; презентацией нужно поделиться с `client_email` ключа как с редактором. Слайд недели ищется по ID `cw_YYYYMMDD` (понедельник): повторная выгрузка перерисовывает его, новая неделя встаёт первым слайдом. Кегль таблицы подбирает `lib/slides-report/layout.ts` по оценке высоты (11 → 7 pt, коэффициенты сняты с живого слайда); не влезает и на 7 pt — эпики уходят на продолжения `cw_YYYYMMDD_pN_<суффикс>` сразу за основным, при повторной выгрузке продолжения пересоздаются. Неделя отчёта: пт–вс — текущая, пн–чт — прошлая
- Телеграм-бот: вебхук `app/api/telegram/webhook`, клиент Bot API `lib/telegram/client.ts` (разметка HTML, не MarkdownV2). Проход сообщения — `lib/telegram/handle-update.ts`, поток черновика — `lib/telegram/draft-flow.ts`
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
- Состояния за кнопками (поисковый запрос, черновик, ожидание ввода) — таблица `tg_handles`, TTL 7 дней; столько же живут сами инлайн-кнопки, дальше карточка отвечает «устарели» и снимает клавиатуру
- `APP_BASE_URL` (или `VERCEL_PROJECT_PRODUCTION_URL`) — корень приложения для кнопки «Открыть на доске». Не задан — кнопки просто нет
- Инструменты агентов: единый реестр `lib/agent/tools.ts` (`defineTool` из `lib/agent/tool-registry.ts`, флаги `surfaces` и `mutation`). MCP-роут и бот перебирают реестр — инлайн-определений инструментов в роутах быть не должно
- Сообщение в бот: заглушка «⏳ Разбираю…» → вход `lib/telegram/inbound.ts` (текст, расшифровка голоса, пересылка, ссылки с превью) → маршрут Jev `lib/telegram/route.ts` (`capture`/`forward`/`ask_board`/`find_task`/`smalltalk` + «это поправка?» и «это „отправляй“?», пересылки — правилом, сбой Jev — `capture`) → заглушка правится в ответ
- Захват: агент `lib/telegram/capture-agent.ts` (цикл `runAgent` с `deferAll`, только разрешённые мутации `CAPTURE_MUTATIONS`) собирает черновик — ничего не пишет. Черновик — хендл `draft` в `tg_handles`, карточка и кнопки — `lib/telegram/draft.ts`: «✅ Отправить» применяет вызовы тем же набором инструментов (`claimHandle` — ровно один раз), «✏️ Исправить» ждёт поправку текстом или голосом, «✖️ Отмена» закрывает. До «Отправить» в базу пишутся только журнал апдейтов и `tg_handles`
- Агенты бота (захват и `ask_board`) получают доску всех сред прямо в системном промпте (`lib/telegram/board-snapshot.ts`, строка на задачу, ≤150 задач, активная среда первой) — get_board первым шагом не нужен. Захват идёт с `stopAfterDeferred`: шаг из одних отложенных вызовов — последний, заключительной фразы отдельным кругом нет. Сбой снимка не мешает: агент читает доску инструментами
- «Отправляй / да, записывай» при черновике моложе часа (`confirm` в Jev, важнее поправки) НЕ применяет черновик: та же карточка заново в заглушке внизу чата, у старой клавиатура снята («Черновик ниже ↓»), хендл переводится `updateHandle(messageId)`. На доску — только по нажатию
- Поправка (по Jev — только к черновику моложе часа и при маршруте `capture`/`forward`; или после «Исправить») пересобирает черновик целиком и правит ту же карточку. Критерии маршрутов — `ROUTE_CRITERIA`, после правки перепрогнать `tests/jev.integration.test.ts`. `ask_board` — агент только на чтение (`ask-board.ts`), `find_task` — ключевые слова (`lib/llm/search-query.ts`) → поиск с карточками `manage.ts`. Формулировка автора не переписывается: снимаются только «Надо/Нужно» в начале и `@упоминания`, латиница не из входа — предупреждение в карточке. Намерение без содержания («хочу создать задачу в блоке ML») — noul `intent` в том же запросе Jev (`intentOnly`): агент не зовётся, заглушка спрашивает «что записать?» (эпик — по совпадению названия), ожидание `await_input` `{ captureContext }` на 15 минут, и следующий текст или голос уходит агенту захвата с этой фразой контекстом; на случай промаха Jev то же правило есть в промпте захвата

## Тесты
- Расположение: `tests/` (не `__tests__/`)
- Unit-тесты сервисов: `tests/{tasks,columns,categories,...}.test.ts`
- **`npm test` — основной прогон: офлайн.** Файлы `*.integration.test.ts` исключены маской в `vitest.config.ts`, `fetch` заглушен через `tests/helpers/no-network.ts`, `OPENROUTER_API_KEY`, `GOOGLE_SERVICE_ACCOUNT_KEY` и `GOOGLE_SLIDES_PRESENTATION_ID` подменены пустыми. Сетевой тест здесь падает с подсказкой: либо мокайте `fetch`, либо переносите файл в `*.integration.test.ts`. В CI — джоба `test`
- **`npm run test:integration` — всё, что ходит наружу** (конфиг `vitest.integration.config.ts`, только `*.integration.test.ts`). Пропусков (`describe.skipIf`) там нет намеренно: без ключа или без базы прогон падает, а не зеленеет с нулём проверок
  - `npm run test:integration:db` — тесты на настоящей БД, обёртка `scripts/run-db-integration.sh`. Набор задан **вычитанием** (`--exclude` живой модели лежит в обёртке), а не списком файлов: новый `*.integration.test.ts` попадает в CI сам, а переименование файла не сужает прогон молча. Берут `TEST_DATABASE_URL` (и только его, никогда `DATABASE_URL`), хост обязан быть локальным. Обёртка сторожит прогон с двух сторон: переменная обязана быть непустой до старта, а после прогона обязан быть хотя бы один выполненный тест и ни одного пропущенного — сам `vitest` выходит с кодом 0 и на строке «16 passed, 8 skipped». В CI — шаг джобы `migrations`
  - `npm run test:integration:llm` — реальные запросы к модели через OpenRouter (`tests/llm.integration.test.ts`), нужен `OPENROUTER_API_KEY`. В CI только вручную (джоба `llm-integration`, `workflow_dispatch`): запросы платные, ответ недетерминирован; раньше живой Groq в `npm test` ронял прогон по HTTP 429. Появится ещё один тест с живой сетью — допишите его в `--exclude` скрипта `:db`, иначе он уедет в джобу с базой
- `tests/test-isolation.test.ts` сторожит эту схему: сломается, если из конфига убрать заглушку сети или подмену ключа

## Команды
- `npm run dev` — dev-сервер
- `npm run build` — билд
- `npm test` — vitest run (офлайн, без интеграционных)
- `npm run test:integration` — интеграционные (`:db` — на настоящей БД, `:llm` — живая модель)
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
