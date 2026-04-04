# Constance

Персональная канбан-доска для управления задачами.

## Стек

- **Next.js 16** + React 19 + TypeScript
- **UI:** shadcn/ui (base-ui), Tailwind CSS 4, lucide-react
- **БД:** Drizzle ORM + Neon PostgreSQL
- **DnD:** @hello-pangea/dnd
- **Тесты:** Vitest

## Запуск

```bash
npm install
cp .env.example .env.local   # настроить DATABASE_URL и SESSION_SECRET
npm run db:push               # применить схему к БД
npm run db:seed               # заполнить начальные данные
npm run dev                   # запустить dev-сервер
```

## Команды

| Команда | Описание |
|---|---|
| `npm run dev` | Dev-сервер |
| `npm run build` | Продакшн-билд |
| `npm test` | Запуск тестов |
| `npm run db:push` | Применить схему к БД |
| `npm run db:seed` | Заполнить начальные данные |
| `npm run db:studio` | Drizzle Studio |

## Деплой

Проект настроен для деплоя на [Vercel](https://vercel.com). Необходимые переменные окружения:

- `DATABASE_URL` — строка подключения к Neon PostgreSQL
- `SESSION_SECRET` — секрет для JWT-сессий
