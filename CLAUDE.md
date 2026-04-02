@AGENTS.md

# Constance — канбан-доска

## Стек
- Next.js 16, React 19, TypeScript
- UI: shadcn/ui на базе `@base-ui/react` (НЕ radix), Tailwind CSS 4, lucide-react
- DB: Drizzle ORM + Neon PostgreSQL
- Тесты: vitest
- DnD: @hello-pangea/dnd

## Структура маршрутов
- `app/(app)/(board)/page.tsx` — доска (route group для изоляции loading.tsx)
- `app/(app)/settings/page.tsx` — настройки
- `app/(auth)/login/page.tsx` — авторизация

## Команды
- `npm run dev` — dev-сервер
- `npm run build` — билд
- `npm test` — vitest run
- `npm run db:push` — применить схему к БД

## Соглашения
- Весь UI-текст и коммиты на русском
- `useSearchParams()` требует `<Suspense>` boundary (иначе CSR bailout в Next.js 16)
- `loading.tsx` в route group `(board)` — не класть в `(app)` напрямую, иначе skeleton покажется на всех страницах
