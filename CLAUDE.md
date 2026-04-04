@AGENTS.md

# Constance — канбан-доска

## Стек
- Next.js 16, React 19, TypeScript
- UI: shadcn/ui на базе `@base-ui/react` (НЕ radix), Tailwind CSS 4, lucide-react
- DB: Drizzle ORM + Neon PostgreSQL
- Тесты: vitest
- DnD: @hello-pangea/dnd
- AI: Groq API (модель gpt-oss-20b) — парсинг задач через SmartInput
- Auth: PIN-код через jose JWT, без middleware — проверка в layout/API

## Структура маршрутов
- `app/(app)/(board)/page.tsx` — доска (route group для изоляции loading.tsx)
- `app/(app)/settings/page.tsx` — настройки
- `app/(auth)/login/page.tsx` — авторизация
- `app/api/{ai,auth,report,tasks}/` — API routes (защита через `lib/api-auth.ts` с X-API-Key)

## Архитектура
- **Server Actions** (`lib/actions/`) → **Services** (`lib/services/`) → **DB** (`lib/db/`)
- Actions: `"use server"`, вызывают сервисы, делают `revalidatePath`
- Services: чистая бизнес-логика и запросы Drizzle, без Next.js зависимостей
- Схема БД: `lib/db/schema.ts` — environments → columns → tasks, categories
- Активная среда хранится в cookie (`lib/environment.ts`)

## Тесты
- Расположение: `tests/` (не `__tests__/`)
- Unit-тесты сервисов: `tests/{tasks,columns,categories,...}.test.ts`
- Интеграционные тесты: `tests/groq.integration.test.ts` (реальные API-запросы)

## Команды
- `npm run dev` — dev-сервер
- `npm run build` — билд
- `npm test` — vitest run
- `npm run db:push` — применить схему к БД
- `npm run db:generate` — сгенерировать миграции Drizzle
- `npm run db:studio` — GUI Drizzle Studio
- `npm run db:seed` — заполнить БД тестовыми данными

## Соглашения
- Весь UI-текст и коммиты на русском
- `useSearchParams()` требует `<Suspense>` boundary (иначе CSR bailout в Next.js 16)
- `loading.tsx` в route group `(board)` — не класть в `(app)` напрямую, иначе skeleton покажется на всех страницах
