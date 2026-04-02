# Constance — План реализации

> **Для агентов:** ОБЯЗАТЕЛЬНЫЙ СКИЛЛ: Используйте superpowers:subagent-driven-development (рекомендуется) или superpowers:executing-plans для реализации задач по шагам. Шаги используют чекбоксы (`- [ ]`) для отслеживания.

**Цель:** Персональная канбан-доска для трекинга задач с еженедельными отчётами, развёрнутая на Vercel.

**Архитектура:** Next.js 16 App Router с серверными компонентами для начальной загрузки, клиентскими компонентами для интерактивности (drag-and-drop, модалки). Server Actions для мутаций из веб-интерфейса, API Routes для будущего Telegram-бота. Общий сервисный слой в `lib/services/`.

**Стек:** Next.js 16, shadcn/ui, Tailwind CSS 4, Drizzle ORM, Neon Postgres, `@hello-pangea/dnd`, bcrypt.

---

## Файловая структура

```
constance/
├── app/
│   ├── (auth)/
│   │   └── login/
│   │       └── page.tsx              — Экран ввода/создания PIN
│   ├── (app)/
│   │   ├── layout.tsx                — Шапка, навигация, провайдеры
│   │   ├── page.tsx                  — Канбан-доска (главная)
│   │   └── settings/
│   │       └── page.tsx              — Управление колонками, категориями, PIN
│   ├── api/
│   │   ├── auth/
│   │   │   └── route.ts             — POST: проверка PIN
│   │   ├── tasks/
│   │   │   ├── route.ts             — GET, POST задач
│   │   │   └── [id]/
│   │   │       └── route.ts         — PATCH, DELETE задачи
│   │   └── report/
│   │       └── route.ts             — GET: отчёт за неделю
│   ├── layout.tsx                    — Корневой layout (шрифты, metadata)
│   └── globals.css                   — Tailwind + shadcn стили
├── components/
│   ├── board/
│   │   ├── kanban-board.tsx          — Клиентский компонент доски с DnD
│   │   ├── board-column.tsx          — Колонка с заголовком и списком задач
│   │   └── task-card.tsx             — Карточка задачи
│   ├── modals/
│   │   ├── create-task-modal.tsx     — Модалка создания задачи
│   │   └── today-plan-modal.tsx      — Модалка «План на сегодня»
│   ├── report/
│   │   └── report-sidebar.tsx        — Сайдбар отчёта за неделю
│   ├── settings/
│   │   ├── columns-manager.tsx       — Управление колонками
│   │   ├── categories-manager.tsx    — Управление категориями
│   │   └── pin-change-form.tsx       — Смена PIN
│   ├── auth/
│   │   └── pin-form.tsx              — Форма ввода PIN (InputOTP)
│   └── ui/                           — shadcn компоненты (генерируются CLI)
├── lib/
│   ├── db/
│   │   ├── index.ts                  — Drizzle клиент (подключение к Neon)
│   │   ├── schema.ts                 — Схема таблиц Drizzle
│   │   └── seed.ts                   — Сидирование дефолтных колонок
│   ├── services/
│   │   ├── tasks.ts                  — CRUD задач, перемещение, completed_at
│   │   ├── columns.ts               — CRUD колонок, переупорядочивание
│   │   ├── categories.ts            — CRUD категорий
│   │   ├── auth.ts                   — Хеширование/проверка PIN, сессия
│   │   └── reports.ts               — Запросы для отчётов
│   ├── actions/
│   │   ├── tasks.ts                  — Server Actions для задач
│   │   ├── columns.ts               — Server Actions для колонок
│   │   ├── categories.ts            — Server Actions для категорий
│   │   └── auth.ts                   — Server Actions для авторизации
│   └── utils.ts                      — Утилиты (форматирование дат, недель)
├── proxy.ts                          — Защита маршрутов (проверка cookie)
├── drizzle.config.ts                 — Конфигурация Drizzle Kit
├── package.json
├── tsconfig.json
└── next.config.ts
```

---

## Task 1: Инициализация проекта

**Файлы:**
- Создать: `package.json`, `tsconfig.json`, `next.config.ts`, `app/layout.tsx`, `app/globals.css`
- Создать: `components/ui/*` (через shadcn CLI)

- [ ] **Шаг 1: Создать Next.js проект**

```bash
cd /Users/alfa/Development/constance
npx create-next-app@latest . --typescript --tailwind --eslint --app --src=no --import-alias "@/*" --turbopack
```

При запросах выбирать: Yes для всех опций, App Router — да, `src/` directory — нет.

- [ ] **Шаг 2: Инициализировать shadcn**

```bash
npx shadcn@latest init
```

Выбрать: New York стиль, Zinc цвет, CSS variables — да.

- [ ] **Шаг 3: Установить shadcn компоненты**

```bash
npx shadcn@latest add button input textarea dialog sheet tabs badge select input-otp separator card dropdown-menu toast checkbox label popover calendar
```

- [ ] **Шаг 4: Установить зависимости проекта**

```bash
npm install drizzle-orm @neondatabase/serverless bcryptjs @hello-pangea/dnd date-fns
npm install -D drizzle-kit @types/bcryptjs
```

- [ ] **Шаг 5: Убедиться, что dev-сервер запускается**

```bash
npm run dev
```

Ожидание: сервер стартует на `http://localhost:3000`, отображается дефолтная страница Next.js.

- [ ] **Шаг 6: Коммит**

```bash
git init
git add .
git commit -m "chore: init next.js project with shadcn and dependencies"
```

---

## Task 2: Схема базы данных и Drizzle

**Файлы:**
- Создать: `lib/db/schema.ts`, `lib/db/index.ts`, `drizzle.config.ts`
- Создать: `.env.local` (шаблон)

- [ ] **Шаг 1: Создать `.env.local` с переменной подключения**

```env
DATABASE_URL=postgresql://user:password@ep-xxx.us-east-2.aws.neon.tech/constance?sslmode=require
```

Реальный URL будет получен через `vercel env pull` после подключения Neon через Vercel Marketplace.

- [ ] **Шаг 2: Создать конфигурацию Drizzle**

Файл `drizzle.config.ts`:

```typescript
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
```

- [ ] **Шаг 3: Создать схему БД**

Файл `lib/db/schema.ts`:

```typescript
import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  date,
  pgEnum,
} from "drizzle-orm/pg-core";

export const priorityEnum = pgEnum("priority", ["urgent", "high", "normal"]);

export const settings = pgTable("settings", {
  id: integer("id").primaryKey().default(1),
  pinHash: text("pin_hash"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const columns = pgTable("columns", {
  id: uuid("id").defaultRandom().primaryKey(),
  title: text("title").notNull(),
  position: integer("position").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const categories = pgTable("categories", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  color: text("color"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const tasks = pgTable("tasks", {
  id: uuid("id").defaultRandom().primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  columnId: uuid("column_id")
    .notNull()
    .references(() => columns.id),
  categoryId: uuid("category_id").references(() => categories.id, {
    onDelete: "set null",
  }),
  priority: priorityEnum("priority").notNull().default("normal"),
  position: integer("position").notNull(),
  startDate: date("start_date").notNull(),
  plannedDate: date("planned_date"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
```

- [ ] **Шаг 4: Создать клиент подключения к БД**

Файл `lib/db/index.ts`:

```typescript
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

const sql = neon(process.env.DATABASE_URL!);
export const db = drizzle(sql, { schema });
```

- [ ] **Шаг 5: Сгенерировать и применить миграцию**

```bash
npx drizzle-kit generate
npx drizzle-kit push
```

Ожидание: таблицы `settings`, `columns`, `categories`, `tasks` созданы в Neon.

- [ ] **Шаг 6: Коммит**

```bash
git add lib/db/ drizzle.config.ts drizzle/
git commit -m "feat: add database schema with Drizzle ORM"
```

---

## Task 3: Сидирование начальных данных

**Файлы:**
- Создать: `lib/db/seed.ts`
- Изменить: `package.json` (добавить скрипт)

- [ ] **Шаг 1: Создать скрипт сидирования**

Файл `lib/db/seed.ts`:

```typescript
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { columns, settings } from "./schema";
import { eq } from "drizzle-orm";

async function seed() {
  const sql = neon(process.env.DATABASE_URL!);
  const db = drizzle(sql);

  // Создать строку settings если не существует
  const existing = await db.select().from(settings).where(eq(settings.id, 1));
  if (existing.length === 0) {
    await db.insert(settings).values({ id: 1 });
    console.log("Settings row created");
  }

  // Создать дефолтные колонки если нет ни одной
  const existingColumns = await db.select().from(columns);
  if (existingColumns.length === 0) {
    await db.insert(columns).values([
      { title: "Бэклог", position: 0 },
      { title: "В работе", position: 1 },
      { title: "Готово", position: 2 },
    ]);
    console.log("Default columns created: Бэклог, В работе, Готово");
  }

  console.log("Seed complete");
}

seed().catch(console.error);
```

- [ ] **Шаг 2: Добавить скрипт в package.json**

Добавить в `"scripts"`:

```json
"db:seed": "npx tsx lib/db/seed.ts",
"db:push": "drizzle-kit push",
"db:generate": "drizzle-kit generate",
"db:studio": "drizzle-kit studio"
```

- [ ] **Шаг 3: Запустить сидирование**

```bash
npm run db:seed
```

Ожидание: `Settings row created`, `Default columns created: Бэклог, В работе, Готово`.

- [ ] **Шаг 4: Коммит**

```bash
git add lib/db/seed.ts package.json
git commit -m "feat: add database seed script with default columns"
```

---

## Task 4: Сервис авторизации

**Файлы:**
- Создать: `lib/services/auth.ts`, `lib/actions/auth.ts`

- [ ] **Шаг 1: Создать сервис авторизации**

Файл `lib/services/auth.ts`:

```typescript
import { db } from "@/lib/db";
import { settings } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";

const SESSION_SECRET = new TextEncoder().encode(
  process.env.SESSION_SECRET || "constance-default-secret-change-me"
);
const SESSION_COOKIE = "constance-session";
const SESSION_DURATION = 30 * 24 * 60 * 60; // 30 дней в секундах

export async function isPinSet(): Promise<boolean> {
  const [row] = await db
    .select({ pinHash: settings.pinHash })
    .from(settings)
    .where(eq(settings.id, 1));
  return !!row?.pinHash;
}

export async function setPin(pin: string): Promise<void> {
  const hash = await bcrypt.hash(pin, 10);
  await db
    .update(settings)
    .set({ pinHash: hash, updatedAt: new Date() })
    .where(eq(settings.id, 1));
}

export async function verifyPin(pin: string): Promise<boolean> {
  const [row] = await db
    .select({ pinHash: settings.pinHash })
    .from(settings)
    .where(eq(settings.id, 1));
  if (!row?.pinHash) return false;
  return bcrypt.compare(pin, row.pinHash);
}

export async function verifyApiKey(apiKey: string): Promise<boolean> {
  return verifyPin(apiKey);
}

export async function createSession(): Promise<void> {
  const token = await new SignJWT({ authenticated: true })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(`${SESSION_DURATION}s`)
    .sign(SESSION_SECRET);

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SESSION_DURATION,
    path: "/",
  });
}

export async function verifySession(): Promise<boolean> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return false;
  try {
    await jwtVerify(token, SESSION_SECRET);
    return true;
  } catch {
    return false;
  }
}

export async function destroySession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
}
```

- [ ] **Шаг 2: Установить jose для JWT**

```bash
npm install jose
```

- [ ] **Шаг 3: Добавить SESSION_SECRET в .env.local**

```env
SESSION_SECRET=your-random-secret-at-least-32-chars-long
```

- [ ] **Шаг 4: Создать Server Actions для авторизации**

Файл `lib/actions/auth.ts`:

```typescript
"use server";

import {
  isPinSet,
  verifyPin,
  setPin,
  createSession,
  destroySession,
} from "@/lib/services/auth";

export async function loginAction(pin: string): Promise<{ error?: string }> {
  const valid = await verifyPin(pin);
  if (!valid) return { error: "Неверный PIN" };
  await createSession();
  return {};
}

export async function setupPinAction(pin: string): Promise<{ error?: string }> {
  const alreadySet = await isPinSet();
  if (alreadySet) return { error: "PIN уже установлен" };
  await setPin(pin);
  await createSession();
  return {};
}

export async function changePinAction(
  currentPin: string,
  newPin: string
): Promise<{ error?: string }> {
  const valid = await verifyPin(currentPin);
  if (!valid) return { error: "Неверный текущий PIN" };
  await setPin(newPin);
  return {};
}

export async function logoutAction(): Promise<void> {
  await destroySession();
}
```

- [ ] **Шаг 5: Коммит**

```bash
git add lib/services/auth.ts lib/actions/auth.ts
git commit -m "feat: add PIN auth service with session management"
```

---

## Task 5: Страница входа и защита маршрутов

**Файлы:**
- Создать: `app/(auth)/login/page.tsx`, `components/auth/pin-form.tsx`, `proxy.ts`

- [ ] **Шаг 1: Создать компонент формы PIN**

Файл `components/auth/pin-form.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import { Button } from "@/components/ui/button";
import { loginAction, setupPinAction } from "@/lib/actions/auth";
import { useRouter } from "next/navigation";

interface PinFormProps {
  mode: "login" | "setup";
}

export function PinForm({ mode }: PinFormProps) {
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [error, setError] = useState("");
  const [step, setStep] = useState<"enter" | "confirm">("enter");
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleSubmit() {
    if (mode === "setup" && step === "enter") {
      setStep("confirm");
      setConfirmPin("");
      return;
    }

    if (mode === "setup" && step === "confirm") {
      if (pin !== confirmPin) {
        setError("PIN-коды не совпадают");
        setStep("enter");
        setPin("");
        setConfirmPin("");
        return;
      }
    }

    const action = mode === "setup" ? setupPinAction : loginAction;
    const value = mode === "setup" ? pin : pin;

    startTransition(async () => {
      const result = await action(value);
      if (result.error) {
        setError(result.error);
        setPin("");
        setConfirmPin("");
        setStep("enter");
      } else {
        router.push("/");
        router.refresh();
      }
    });
  }

  const currentValue = step === "confirm" ? confirmPin : pin;
  const setCurrentValue = step === "confirm" ? setConfirmPin : setPin;

  return (
    <div className="flex flex-col items-center gap-6">
      <h1 className="text-2xl font-bold">
        {mode === "setup"
          ? step === "confirm"
            ? "Подтвердите PIN"
            : "Придумайте PIN"
          : "Введите PIN"}
      </h1>
      <InputOTP
        maxLength={6}
        value={currentValue}
        onChange={setCurrentValue}
        onComplete={handleSubmit}
      >
        <InputOTPGroup>
          {Array.from({ length: 6 }).map((_, i) => (
            <InputOTPSlot key={i} index={i} />
          ))}
        </InputOTPGroup>
      </InputOTP>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button onClick={handleSubmit} disabled={currentValue.length < 6 || isPending}>
        {isPending
          ? "Проверка..."
          : mode === "setup" && step === "enter"
            ? "Далее"
            : "Войти"}
      </Button>
    </div>
  );
}
```

- [ ] **Шаг 2: Создать страницу логина**

Файл `app/(auth)/login/page.tsx`:

```tsx
import { isPinSet } from "@/lib/services/auth";
import { PinForm } from "@/components/auth/pin-form";

export default async function LoginPage() {
  const pinExists = await isPinSet();

  return (
    <div className="flex min-h-screen items-center justify-center">
      <PinForm mode={pinExists ? "login" : "setup"} />
    </div>
  );
}
```

- [ ] **Шаг 3: Создать proxy.ts для защиты маршрутов**

Файл `proxy.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";

const SESSION_SECRET = new TextEncoder().encode(
  process.env.SESSION_SECRET || "constance-default-secret-change-me"
);

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Пропускаем статику, API авторизации и страницу логина
  if (
    pathname.startsWith("/login") ||
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon")
  ) {
    return NextResponse.next();
  }

  // API Routes проверяют X-API-Key сами
  if (pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  // Проверяем сессию для защищённых страниц
  const token = request.cookies.get("constance-session")?.value;
  if (!token) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  try {
    await jwtVerify(token, SESSION_SECRET);
    return NextResponse.next();
  } catch {
    return NextResponse.redirect(new URL("/login", request.url));
  }
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
```

- [ ] **Шаг 4: Проверить поток авторизации**

```bash
npm run dev
```

Открыть `http://localhost:3000` — должен редиректить на `/login`. На странице логина — экран «Придумайте PIN» (т.к. PIN ещё не задан).

- [ ] **Шаг 5: Коммит**

```bash
git add app/(auth)/ components/auth/ proxy.ts
git commit -m "feat: add PIN login page and route protection via proxy"
```

---

## Task 6: Корневой layout и шапка приложения

**Файлы:**
- Изменить: `app/layout.tsx`
- Создать: `app/(app)/layout.tsx`

- [ ] **Шаг 1: Настроить корневой layout**

Файл `app/layout.tsx`:

```tsx
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";

const inter = Inter({ subsets: ["latin", "cyrillic"] });

export const metadata: Metadata = {
  title: "Constance",
  description: "Персональная канбан-доска для трекинга задач",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ru">
      <body className={inter.className}>
        {children}
        <Toaster />
      </body>
    </html>
  );
}
```

Примечание: установить sonner если ещё не установлен:
```bash
npx shadcn@latest add sonner
```

- [ ] **Шаг 2: Создать layout защищённой зоны с шапкой**

Файл `app/(app)/layout.tsx`:

```tsx
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { CalendarDays, BarChart3, Settings } from "lucide-react";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b bg-background">
        <div className="container flex h-14 items-center justify-between px-4">
          <Link href="/" className="text-lg font-bold">
            Constance
          </Link>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" id="today-plan-trigger">
              <CalendarDays className="mr-2 h-4 w-4" />
              <span className="hidden sm:inline">План на сегодня</span>
            </Button>
            <Button variant="ghost" size="sm" id="report-trigger">
              <BarChart3 className="mr-2 h-4 w-4" />
              <span className="hidden sm:inline">Отчёт</span>
            </Button>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/settings">
                <Settings className="mr-2 h-4 w-4" />
                <span className="hidden sm:inline">Настройки</span>
              </Link>
            </Button>
          </div>
        </div>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}
```

- [ ] **Шаг 3: Создать заглушку главной страницы**

Файл `app/(app)/page.tsx`:

```tsx
export default function BoardPage() {
  return (
    <div className="container px-4 py-6">
      <p className="text-muted-foreground">Канбан-доска будет здесь</p>
    </div>
  );
}
```

- [ ] **Шаг 4: Убедиться, что layout отображается**

```bash
npm run dev
```

Ожидание: после входа по PIN видна шапка с кнопками «План на сегодня», «Отчёт», «Настройки».

- [ ] **Шаг 5: Коммит**

```bash
git add app/layout.tsx app/(app)/
git commit -m "feat: add app layout with header navigation"
```

---

## Task 7: Сервисный слой (колонки, категории, задачи, отчёты)

**Файлы:**
- Создать: `lib/services/columns.ts`, `lib/services/categories.ts`, `lib/services/tasks.ts`, `lib/services/reports.ts`, `lib/utils.ts`

- [ ] **Шаг 1: Создать утилиты для работы с неделями**

Файл `lib/utils.ts` (дополнить существующий от shadcn):

```typescript
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { startOfWeek, endOfWeek } from "date-fns";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function getWeekRange(date: Date): { start: Date; end: Date } {
  return {
    start: startOfWeek(date, { weekStartsOn: 1 }),
    end: endOfWeek(date, { weekStartsOn: 1 }),
  };
}

export function formatDate(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}
```

- [ ] **Шаг 2: Создать сервис колонок**

Файл `lib/services/columns.ts`:

```typescript
import { db } from "@/lib/db";
import { columns, tasks } from "@/lib/db/schema";
import { eq, asc, count } from "drizzle-orm";

export async function getColumns() {
  return db.select().from(columns).orderBy(asc(columns.position));
}

export async function createColumn(title: string) {
  const existing = await getColumns();
  const maxPosition = existing.length > 0
    ? Math.max(...existing.map((c) => c.position))
    : -1;

  const [col] = await db
    .insert(columns)
    .values({ title, position: maxPosition + 1 })
    .returning();
  return col;
}

export async function updateColumn(id: string, title: string) {
  const [col] = await db
    .update(columns)
    .set({ title, updatedAt: new Date() })
    .where(eq(columns.id, id))
    .returning();
  return col;
}

export async function deleteColumn(id: string): Promise<{ error?: string }> {
  const taskCount = await db
    .select({ count: count() })
    .from(tasks)
    .where(eq(tasks.columnId, id));

  if (taskCount[0].count > 0) {
    return { error: "Нельзя удалить колонку с задачами. Сначала перенесите задачи." };
  }

  await db.delete(columns).where(eq(columns.id, id));
  return {};
}

export async function reorderColumns(orderedIds: string[]) {
  await Promise.all(
    orderedIds.map((id, index) =>
      db
        .update(columns)
        .set({ position: index, updatedAt: new Date() })
        .where(eq(columns.id, id))
    )
  );
}
```

- [ ] **Шаг 3: Создать сервис категорий**

Файл `lib/services/categories.ts`:

```typescript
import { db } from "@/lib/db";
import { categories, tasks } from "@/lib/db/schema";
import { eq, asc } from "drizzle-orm";

export async function getCategories() {
  return db.select().from(categories).orderBy(asc(categories.name));
}

export async function createCategory(name: string, color?: string) {
  const [cat] = await db
    .insert(categories)
    .values({ name, color })
    .returning();
  return cat;
}

export async function updateCategory(
  id: string,
  data: { name?: string; color?: string }
) {
  const [cat] = await db
    .update(categories)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(categories.id, id))
    .returning();
  return cat;
}

export async function deleteCategory(id: string) {
  // Обнуляем category_id у задач с этой категорией (ON DELETE SET NULL в схеме)
  await db.delete(categories).where(eq(categories.id, id));
}
```

- [ ] **Шаг 4: Создать сервис задач**

Файл `lib/services/tasks.ts`:

```typescript
import { db } from "@/lib/db";
import { tasks, columns } from "@/lib/db/schema";
import { eq, and, asc, desc, count, max } from "drizzle-orm";

export type CreateTaskInput = {
  title: string;
  description?: string;
  columnId: string;
  categoryId?: string;
  priority?: "urgent" | "high" | "normal";
  startDate?: string;
  plannedDate?: string;
};

export async function getTasks() {
  return db.select().from(tasks).orderBy(asc(tasks.position));
}

export async function getTasksByColumn(columnId: string) {
  return db
    .select()
    .from(tasks)
    .where(eq(tasks.columnId, columnId))
    .orderBy(asc(tasks.position));
}

export async function createTask(input: CreateTaskInput) {
  // Определить позицию: последняя в колонке
  const [maxPos] = await db
    .select({ max: max(tasks.position) })
    .from(tasks)
    .where(eq(tasks.columnId, input.columnId));

  const position = (maxPos?.max ?? -1) + 1;

  const [task] = await db
    .insert(tasks)
    .values({
      title: input.title,
      description: input.description || null,
      columnId: input.columnId,
      categoryId: input.categoryId || null,
      priority: input.priority || "normal",
      position,
      startDate: input.startDate || new Date().toISOString().split("T")[0],
      plannedDate: input.plannedDate || null,
    })
    .returning();

  return task;
}

export async function updateTask(
  id: string,
  data: Partial<{
    title: string;
    description: string | null;
    categoryId: string | null;
    priority: "urgent" | "high" | "normal";
    plannedDate: string | null;
  }>
) {
  const [task] = await db
    .update(tasks)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(tasks.id, id))
    .returning();
  return task;
}

export async function deleteTask(id: string) {
  await db.delete(tasks).where(eq(tasks.id, id));
}

export async function moveTask(
  taskId: string,
  targetColumnId: string,
  targetPosition: number
) {
  // Определить, является ли целевая колонка последней
  const allColumns = await db
    .select()
    .from(columns)
    .orderBy(desc(columns.position));
  const lastColumnId = allColumns[0]?.id;
  const isLastColumn = targetColumnId === lastColumnId;

  // Сдвинуть позиции в целевой колонке
  const targetTasks = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.columnId, targetColumnId), eq(tasks.id, taskId).not()))
    .orderBy(asc(tasks.position));

  // Вставить задачу в нужную позицию и пересчитать
  const reordered = [...targetTasks];
  const [movedTask] = await db.select().from(tasks).where(eq(tasks.id, taskId));
  if (!movedTask) return null;

  // Обновить саму задачу
  const completedAt = isLastColumn ? new Date() : null;

  await db
    .update(tasks)
    .set({
      columnId: targetColumnId,
      position: targetPosition,
      completedAt,
      updatedAt: new Date(),
    })
    .where(eq(tasks.id, taskId));

  // Пересчитать позиции остальных задач в целевой колонке
  const allInTarget = await db
    .select()
    .from(tasks)
    .where(eq(tasks.columnId, targetColumnId))
    .orderBy(asc(tasks.position));

  await Promise.all(
    allInTarget.map((t, idx) =>
      db
        .update(tasks)
        .set({ position: idx })
        .where(eq(tasks.id, t.id))
    )
  );

  return movedTask;
}

export async function getTasksForToday() {
  const today = new Date().toISOString().split("T")[0];
  return db
    .select()
    .from(tasks)
    .where(eq(tasks.plannedDate, today))
    .orderBy(asc(tasks.position));
}
```

- [ ] **Шаг 5: Создать сервис отчётов**

Файл `lib/services/reports.ts`:

```typescript
import { db } from "@/lib/db";
import { tasks, categories, columns } from "@/lib/db/schema";
import { and, gte, lt, eq, asc } from "drizzle-orm";
import { getWeekRange } from "@/lib/utils";

export type ReportTask = {
  id: string;
  title: string;
  description: string | null;
  categoryName: string | null;
  completedAt: Date;
};

export type WeeklyReport = {
  weekStart: Date;
  weekEnd: Date;
  completedTasks: ReportTask[];
  completedCount: number;
  startedCount: number;
};

export async function getWeeklyReport(date: Date): Promise<WeeklyReport> {
  const { start, end } = getWeekRange(date);

  // Задачи, выполненные за неделю
  const completed = await db
    .select({
      id: tasks.id,
      title: tasks.title,
      description: tasks.description,
      completedAt: tasks.completedAt,
      categoryName: categories.name,
    })
    .from(tasks)
    .leftJoin(categories, eq(tasks.categoryId, categories.id))
    .where(and(gte(tasks.completedAt, start), lt(tasks.completedAt, end)))
    .orderBy(asc(tasks.completedAt));

  // Задачи, начатые за неделю
  const startedRows = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(
      and(
        gte(tasks.startDate, start.toISOString().split("T")[0]),
        lt(tasks.startDate, end.toISOString().split("T")[0])
      )
    );

  return {
    weekStart: start,
    weekEnd: end,
    completedTasks: completed.map((t) => ({
      ...t,
      completedAt: t.completedAt!,
    })),
    completedCount: completed.length,
    startedCount: startedRows.length,
  };
}

export function formatReportAsText(report: WeeklyReport): string {
  const { weekStart, weekEnd, completedTasks, completedCount, startedCount } =
    report;
  const startStr = weekStart.toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
  });
  const endStr = weekEnd.toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });

  let text = `Отчёт за неделю: ${startStr} — ${endStr}\n`;
  text += `Выполнено: ${completedCount} из ${startedCount} задач\n\n`;

  for (const task of completedTasks) {
    const cat = task.categoryName ? ` (${task.categoryName})` : "";
    const date = task.completedAt.toLocaleDateString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
    text += `✓ ${task.title}${cat} — ${date}\n`;
    if (task.description) {
      text += `  ${task.description}\n`;
    }
  }

  return text.trim();
}
```

- [ ] **Шаг 6: Коммит**

```bash
git add lib/services/ lib/utils.ts
git commit -m "feat: add service layer for columns, categories, tasks, and reports"
```

---

## Task 8: Server Actions для задач, колонок, категорий

**Файлы:**
- Создать: `lib/actions/tasks.ts`, `lib/actions/columns.ts`, `lib/actions/categories.ts`

- [ ] **Шаг 1: Создать Server Actions для задач**

Файл `lib/actions/tasks.ts`:

```typescript
"use server";

import { revalidatePath } from "next/cache";
import {
  createTask as createTaskService,
  updateTask as updateTaskService,
  deleteTask as deleteTaskService,
  moveTask as moveTaskService,
  type CreateTaskInput,
} from "@/lib/services/tasks";

export async function createTaskAction(input: CreateTaskInput) {
  const task = await createTaskService(input);
  revalidatePath("/");
  return task;
}

export async function updateTaskAction(
  id: string,
  data: Partial<{
    title: string;
    description: string | null;
    categoryId: string | null;
    priority: "urgent" | "high" | "normal";
    plannedDate: string | null;
  }>
) {
  const task = await updateTaskService(id, data);
  revalidatePath("/");
  return task;
}

export async function deleteTaskAction(id: string) {
  await deleteTaskService(id);
  revalidatePath("/");
}

export async function moveTaskAction(
  taskId: string,
  targetColumnId: string,
  targetPosition: number
) {
  await moveTaskService(taskId, targetColumnId, targetPosition);
  revalidatePath("/");
}
```

- [ ] **Шаг 2: Создать Server Actions для колонок**

Файл `lib/actions/columns.ts`:

```typescript
"use server";

import { revalidatePath } from "next/cache";
import {
  createColumn,
  updateColumn,
  deleteColumn,
  reorderColumns,
} from "@/lib/services/columns";

export async function createColumnAction(title: string) {
  const col = await createColumn(title);
  revalidatePath("/");
  revalidatePath("/settings");
  return col;
}

export async function updateColumnAction(id: string, title: string) {
  const col = await updateColumn(id, title);
  revalidatePath("/");
  revalidatePath("/settings");
  return col;
}

export async function deleteColumnAction(id: string) {
  const result = await deleteColumn(id);
  if (result.error) return result;
  revalidatePath("/");
  revalidatePath("/settings");
  return {};
}

export async function reorderColumnsAction(orderedIds: string[]) {
  await reorderColumns(orderedIds);
  revalidatePath("/");
  revalidatePath("/settings");
}
```

- [ ] **Шаг 3: Создать Server Actions для категорий**

Файл `lib/actions/categories.ts`:

```typescript
"use server";

import { revalidatePath } from "next/cache";
import {
  createCategory,
  updateCategory,
  deleteCategory,
} from "@/lib/services/categories";

export async function createCategoryAction(name: string, color?: string) {
  const cat = await createCategory(name, color);
  revalidatePath("/");
  revalidatePath("/settings");
  return cat;
}

export async function updateCategoryAction(
  id: string,
  data: { name?: string; color?: string }
) {
  const cat = await updateCategory(id, data);
  revalidatePath("/");
  revalidatePath("/settings");
  return cat;
}

export async function deleteCategoryAction(id: string) {
  await deleteCategory(id);
  revalidatePath("/");
  revalidatePath("/settings");
}
```

- [ ] **Шаг 4: Коммит**

```bash
git add lib/actions/
git commit -m "feat: add server actions for tasks, columns, and categories"
```

---

## Task 9: Канбан-доска — серверная загрузка и клиентский компонент

**Файлы:**
- Изменить: `app/(app)/page.tsx`
- Создать: `components/board/kanban-board.tsx`, `components/board/board-column.tsx`, `components/board/task-card.tsx`

- [ ] **Шаг 1: Обновить главную страницу для загрузки данных**

Файл `app/(app)/page.tsx`:

```tsx
import { getColumns } from "@/lib/services/columns";
import { getTasks } from "@/lib/services/tasks";
import { getCategories } from "@/lib/services/categories";
import { KanbanBoard } from "@/components/board/kanban-board";

export default async function BoardPage() {
  const [columnsData, tasksData, categoriesData] = await Promise.all([
    getColumns(),
    getTasks(),
    getCategories(),
  ]);

  return (
    <div className="flex-1 overflow-hidden">
      <KanbanBoard
        columns={columnsData}
        tasks={tasksData}
        categories={categoriesData}
      />
    </div>
  );
}
```

- [ ] **Шаг 2: Создать компонент карточки задачи**

Файл `components/board/task-card.tsx`:

```tsx
"use client";

import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";
import { cn } from "@/lib/utils";

type Task = {
  id: string;
  title: string;
  description: string | null;
  priority: "urgent" | "high" | "normal";
  categoryId: string | null;
  plannedDate: string | null;
  completedAt: Date | null;
};

type Category = {
  id: string;
  name: string;
  color: string | null;
};

interface TaskCardProps {
  task: Task;
  categories: Category[];
  onClick?: () => void;
}

const priorityColors = {
  urgent: "border-l-red-500",
  high: "border-l-yellow-500",
  normal: "border-l-gray-300",
};

export function TaskCard({ task, categories, onClick }: TaskCardProps) {
  const category = categories.find((c) => c.id === task.categoryId);

  return (
    <div
      onClick={onClick}
      className={cn(
        "cursor-pointer rounded-lg border border-l-4 bg-card p-3 shadow-sm transition-shadow hover:shadow-md",
        priorityColors[task.priority]
      )}
    >
      <p className="font-medium text-sm">{task.title}</p>
      <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
        {category && (
          <Badge variant="secondary" className="text-xs">
            {category.name}
          </Badge>
        )}
        {task.completedAt ? (
          <span>✓ {formatDate(task.completedAt)}</span>
        ) : task.plannedDate ? (
          <span>до {formatDate(task.plannedDate)}</span>
        ) : null}
      </div>
    </div>
  );
}
```

- [ ] **Шаг 3: Создать компонент колонки**

Файл `components/board/board-column.tsx`:

```tsx
"use client";

import { Droppable, Draggable } from "@hello-pangea/dnd";
import { TaskCard } from "./task-card";

type Task = {
  id: string;
  title: string;
  description: string | null;
  priority: "urgent" | "high" | "normal";
  categoryId: string | null;
  plannedDate: string | null;
  completedAt: Date | null;
  position: number;
};

type Category = {
  id: string;
  name: string;
  color: string | null;
};

interface BoardColumnProps {
  column: { id: string; title: string };
  tasks: Task[];
  categories: Category[];
  onTaskClick?: (taskId: string) => void;
}

export function BoardColumn({
  column,
  tasks,
  categories,
  onTaskClick,
}: BoardColumnProps) {
  return (
    <div className="flex w-72 flex-shrink-0 flex-col rounded-lg bg-muted/50 p-2">
      <div className="mb-2 flex items-center justify-between px-2">
        <h3 className="text-sm font-semibold">{column.title}</h3>
        <span className="text-xs text-muted-foreground">{tasks.length}</span>
      </div>
      <Droppable droppableId={column.id}>
        {(provided, snapshot) => (
          <div
            ref={provided.innerRef}
            {...provided.droppableProps}
            className={cn(
              "flex min-h-[100px] flex-1 flex-col gap-2 rounded-md p-1 transition-colors",
              snapshot.isDraggingOver && "bg-muted"
            )}
          >
            {tasks.map((task, index) => (
              <Draggable key={task.id} draggableId={task.id} index={index}>
                {(provided) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.draggableProps}
                    {...provided.dragHandleProps}
                  >
                    <TaskCard
                      task={task}
                      categories={categories}
                      onClick={() => onTaskClick?.(task.id)}
                    />
                  </div>
                )}
              </Draggable>
            ))}
            {provided.placeholder}
          </div>
        )}
      </Droppable>
    </div>
  );
}
```

Добавить импорт `cn`:
```tsx
import { cn } from "@/lib/utils";
```

- [ ] **Шаг 4: Создать основной компонент канбан-доски**

Файл `components/board/kanban-board.tsx`:

```tsx
"use client";

import { useState, useOptimistic, useTransition } from "react";
import { DragDropContext, type DropResult } from "@hello-pangea/dnd";
import { BoardColumn } from "./board-column";
import { moveTaskAction } from "@/lib/actions/tasks";
import { toast } from "sonner";

type Column = { id: string; title: string; position: number };
type Task = {
  id: string;
  title: string;
  description: string | null;
  columnId: string;
  categoryId: string | null;
  priority: "urgent" | "high" | "normal";
  position: number;
  startDate: string;
  plannedDate: string | null;
  completedAt: Date | null;
};
type Category = { id: string; name: string; color: string | null };

interface KanbanBoardProps {
  columns: Column[];
  tasks: Task[];
  categories: Category[];
}

export function KanbanBoard({
  columns,
  tasks: initialTasks,
  categories,
}: KanbanBoardProps) {
  const [tasks, setTasks] = useState(initialTasks);
  const [isPending, startTransition] = useTransition();

  // Группировка задач по колонкам
  function getTasksForColumn(columnId: string) {
    return tasks
      .filter((t) => t.columnId === columnId)
      .sort((a, b) => a.position - b.position);
  }

  function handleDragEnd(result: DropResult) {
    const { source, destination, draggableId } = result;
    if (!destination) return;
    if (
      source.droppableId === destination.droppableId &&
      source.index === destination.index
    )
      return;

    // Оптимистичное обновление
    setTasks((prev) => {
      const updated = [...prev];
      const taskIndex = updated.findIndex((t) => t.id === draggableId);
      if (taskIndex === -1) return prev;

      const task = { ...updated[taskIndex] };
      task.columnId = destination.droppableId;
      task.position = destination.index;
      updated[taskIndex] = task;

      return updated;
    });

    // Серверное обновление
    startTransition(async () => {
      try {
        await moveTaskAction(
          draggableId,
          destination.droppableId,
          destination.index
        );
      } catch {
        // Откат при ошибке
        setTasks(initialTasks);
        toast.error("Не удалось переместить задачу");
      }
    });
  }

  return (
    <DragDropContext onDragEnd={handleDragEnd}>
      {/* Десктоп: горизонтальные колонки */}
      <div className="hidden md:flex gap-4 overflow-x-auto p-4">
        {columns.map((col) => (
          <BoardColumn
            key={col.id}
            column={col}
            tasks={getTasksForColumn(col.id)}
            categories={categories}
          />
        ))}
      </div>

      {/* Мобильный: табы */}
      <MobileTabs
        columns={columns}
        tasks={tasks}
        categories={categories}
        getTasksForColumn={getTasksForColumn}
      />
    </DragDropContext>
  );
}

function MobileTabs({
  columns,
  tasks,
  categories,
  getTasksForColumn,
}: {
  columns: Column[];
  tasks: Task[];
  categories: Category[];
  getTasksForColumn: (columnId: string) => Task[];
}) {
  const [activeTab, setActiveTab] = useState(columns[0]?.id);

  return (
    <div className="md:hidden flex flex-col">
      <div className="flex border-b overflow-x-auto">
        {columns.map((col) => (
          <button
            key={col.id}
            onClick={() => setActiveTab(col.id)}
            className={cn(
              "px-4 py-2 text-sm font-medium whitespace-nowrap border-b-2 transition-colors",
              activeTab === col.id
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground"
            )}
          >
            {col.title} ({getTasksForColumn(col.id).length})
          </button>
        ))}
      </div>
      <div className="p-4 space-y-2">
        {activeTab &&
          getTasksForColumn(activeTab).map((task) => (
            <TaskCard key={task.id} task={task} categories={categories} />
          ))}
      </div>
    </div>
  );
}
```

Добавить недостающие импорты в начало:
```tsx
import { cn } from "@/lib/utils";
import { TaskCard } from "./task-card";
```

- [ ] **Шаг 5: Проверить отображение доски**

```bash
npm run dev
```

Ожидание: на главной странице три колонки (Бэклог, В работе, Готово), пока без задач. На мобильном — табы.

- [ ] **Шаг 6: Коммит**

```bash
git add app/(app)/page.tsx components/board/
git commit -m "feat: add kanban board with columns, task cards, and drag-and-drop"
```

---

## Task 10: Модалка создания задачи

**Файлы:**
- Создать: `components/modals/create-task-modal.tsx`
- Изменить: `components/board/kanban-board.tsx` (добавить кнопку и модалку)

- [ ] **Шаг 1: Создать компонент модалки создания задачи**

Файл `components/modals/create-task-modal.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Checkbox } from "@/components/ui/checkbox";
import { CalendarIcon } from "lucide-react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { createTaskAction } from "@/lib/actions/tasks";
import { toast } from "sonner";

type Column = { id: string; title: string };
type Category = { id: string; name: string; color: string | null };

interface CreateTaskModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  columns: Column[];
  categories: Category[];
  defaultColumnId: string;
}

const priorities = [
  { value: "urgent" as const, label: "Срочно", color: "bg-red-500" },
  { value: "high" as const, label: "Высокий", color: "bg-yellow-500" },
  { value: "normal" as const, label: "Обычный", color: "bg-gray-300" },
];

export function CreateTaskModal({
  open,
  onOpenChange,
  columns,
  categories,
  defaultColumnId,
}: CreateTaskModalProps) {
  const [isPending, startTransition] = useTransition();
  const [createAnother, setCreateAnother] = useState(false);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [startDate, setStartDate] = useState<Date>(new Date());
  const [plannedDate, setPlannedDate] = useState<Date | undefined>();
  const [categoryId, setCategoryId] = useState<string>("");
  const [priority, setPriority] = useState<"urgent" | "high" | "normal">(
    "normal"
  );

  function resetForm() {
    setTitle("");
    setDescription("");
    setStartDate(new Date());
    setPlannedDate(undefined);
    setCategoryId("");
    setPriority("normal");
  }

  function handleSubmit() {
    if (!title.trim()) {
      toast.error("Введите название задачи");
      return;
    }

    startTransition(async () => {
      await createTaskAction({
        title: title.trim(),
        description: description.trim() || undefined,
        columnId: defaultColumnId,
        categoryId: categoryId || undefined,
        priority,
        startDate: startDate.toISOString().split("T")[0],
        plannedDate: plannedDate?.toISOString().split("T")[0],
      });

      toast.success("Задача создана");

      if (createAnother) {
        resetForm();
      } else {
        resetForm();
        onOpenChange(false);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Новая задача</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label htmlFor="title">Название</Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Название задачи"
              autoFocus
            />
          </div>

          <div>
            <Label htmlFor="description">Описание</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Краткое описание"
              rows={3}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Дата начала</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-full justify-start text-left font-normal">
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {format(startDate, "dd.MM.yyyy")}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0">
                  <Calendar
                    mode="single"
                    selected={startDate}
                    onSelect={(d) => d && setStartDate(d)}
                    locale={ru}
                  />
                </PopoverContent>
              </Popover>
            </div>

            <div>
              <Label>Плановая дата</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal",
                      !plannedDate && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {plannedDate
                      ? format(plannedDate, "dd.MM.yyyy")
                      : "Не задана"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0">
                  <Calendar
                    mode="single"
                    selected={plannedDate}
                    onSelect={setPlannedDate}
                    locale={ru}
                  />
                </PopoverContent>
              </Popover>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Категория</Label>
              <Select value={categoryId} onValueChange={setCategoryId}>
                <SelectTrigger>
                  <SelectValue placeholder="Выбрать" />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((cat) => (
                    <SelectItem key={cat.id} value={cat.id}>
                      {cat.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Приоритет</Label>
              <div className="flex gap-2 mt-1">
                {priorities.map((p) => (
                  <button
                    key={p.value}
                    type="button"
                    onClick={() => setPriority(p.value)}
                    className={cn(
                      "h-8 w-8 rounded-full border-2 transition-all",
                      p.color,
                      priority === p.value
                        ? "border-foreground scale-110"
                        : "border-transparent opacity-50"
                    )}
                    title={p.label}
                  />
                ))}
              </div>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <Checkbox
              id="create-another"
              checked={createAnother}
              onCheckedChange={(v) => setCreateAnother(v === true)}
            />
            <Label htmlFor="create-another" className="text-sm">
              Создать ещё одну
            </Label>
          </div>

          <Button onClick={handleSubmit} disabled={isPending} className="w-full">
            {isPending ? "Создание..." : "Создать задачу"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Шаг 2: Добавить кнопку создания и модалку в канбан-доску**

В файле `components/board/kanban-board.tsx` добавить после импортов:

```tsx
import { CreateTaskModal } from "@/components/modals/create-task-modal";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
```

Внутри компонента `KanbanBoard` добавить состояние:

```tsx
const [createModalOpen, setCreateModalOpen] = useState(false);
```

Перед `<DragDropContext>` добавить:

```tsx
<div className="flex items-center justify-between p-4 pb-0">
  <Button onClick={() => setCreateModalOpen(true)}>
    <Plus className="mr-2 h-4 w-4" />
    Добавить задачу
  </Button>
</div>

<CreateTaskModal
  open={createModalOpen}
  onOpenChange={setCreateModalOpen}
  columns={columns}
  categories={categories}
  defaultColumnId={columns[0]?.id}
/>
```

- [ ] **Шаг 3: Проверить создание задачи**

```bash
npm run dev
```

Ожидание: кнопка «+ Добавить задачу» открывает модалку. После заполнения и нажатия «Создать задачу» — задача появляется в первой колонке. Чекбокс «Создать ещё одну» оставляет модалку открытой.

- [ ] **Шаг 4: Коммит**

```bash
git add components/modals/create-task-modal.tsx components/board/kanban-board.tsx
git commit -m "feat: add create task modal with all fields and 'create another' option"
```

---

## Task 11: Редактирование и удаление задачи

**Файлы:**
- Изменить: `components/board/task-card.tsx`
- Изменить: `components/board/kanban-board.tsx`

- [ ] **Шаг 1: Добавить inline-редактирование в карточку задачи**

Создать файл `components/board/task-edit-dialog.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { CalendarIcon, Trash2 } from "lucide-react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { updateTaskAction, deleteTaskAction } from "@/lib/actions/tasks";
import { toast } from "sonner";

type Task = {
  id: string;
  title: string;
  description: string | null;
  priority: "urgent" | "high" | "normal";
  categoryId: string | null;
  plannedDate: string | null;
};

type Category = { id: string; name: string; color: string | null };

interface TaskEditDialogProps {
  task: Task;
  categories: Category[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const priorities = [
  { value: "urgent" as const, label: "Срочно", color: "bg-red-500" },
  { value: "high" as const, label: "Высокий", color: "bg-yellow-500" },
  { value: "normal" as const, label: "Обычный", color: "bg-gray-300" },
];

export function TaskEditDialog({
  task,
  categories,
  open,
  onOpenChange,
}: TaskEditDialogProps) {
  const [isPending, startTransition] = useTransition();
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description || "");
  const [categoryId, setCategoryId] = useState(task.categoryId || "");
  const [priority, setPriority] = useState(task.priority);
  const [plannedDate, setPlannedDate] = useState<Date | undefined>(
    task.plannedDate ? new Date(task.plannedDate) : undefined
  );

  function handleSave() {
    startTransition(async () => {
      await updateTaskAction(task.id, {
        title: title.trim(),
        description: description.trim() || null,
        categoryId: categoryId || null,
        priority,
        plannedDate: plannedDate?.toISOString().split("T")[0] || null,
      });
      toast.success("Задача обновлена");
      onOpenChange(false);
    });
  }

  function handleDelete() {
    startTransition(async () => {
      await deleteTaskAction(task.id);
      toast.success("Задача удалена");
      onOpenChange(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Редактировать задачу</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label htmlFor="edit-title">Название</Label>
            <Input
              id="edit-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          <div>
            <Label htmlFor="edit-description">Описание</Label>
            <Textarea
              id="edit-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Категория</Label>
              <Select value={categoryId} onValueChange={setCategoryId}>
                <SelectTrigger>
                  <SelectValue placeholder="Выбрать" />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((cat) => (
                    <SelectItem key={cat.id} value={cat.id}>
                      {cat.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Плановая дата</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal",
                      !plannedDate && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {plannedDate
                      ? format(plannedDate, "dd.MM.yyyy")
                      : "Не задана"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0">
                  <Calendar
                    mode="single"
                    selected={plannedDate}
                    onSelect={setPlannedDate}
                    locale={ru}
                  />
                </PopoverContent>
              </Popover>
            </div>
          </div>

          <div>
            <Label>Приоритет</Label>
            <div className="flex gap-2 mt-1">
              {priorities.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => setPriority(p.value)}
                  className={cn(
                    "h-8 w-8 rounded-full border-2 transition-all",
                    p.color,
                    priority === p.value
                      ? "border-foreground scale-110"
                      : "border-transparent opacity-50"
                  )}
                  title={p.label}
                />
              ))}
            </div>
          </div>

          <div className="flex gap-2">
            <Button onClick={handleSave} disabled={isPending} className="flex-1">
              {isPending ? "Сохранение..." : "Сохранить"}
            </Button>
            <Button
              variant="destructive"
              size="icon"
              onClick={handleDelete}
              disabled={isPending}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Шаг 2: Интегрировать диалог редактирования в канбан-доску**

В `components/board/kanban-board.tsx` добавить импорт и состояние:

```tsx
import { TaskEditDialog } from "@/components/board/task-edit-dialog";

// Внутри KanbanBoard:
const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
const editingTask = editingTaskId ? tasks.find((t) => t.id === editingTaskId) : null;
```

Добавить после `<CreateTaskModal>`:

```tsx
{editingTask && (
  <TaskEditDialog
    task={editingTask}
    categories={categories}
    open={!!editingTaskId}
    onOpenChange={(open) => !open && setEditingTaskId(null)}
  />
)}
```

Передать `onTaskClick={setEditingTaskId}` в `BoardColumn`.

- [ ] **Шаг 3: Проверить редактирование и удаление**

```bash
npm run dev
```

Ожидание: клик по карточке открывает диалог редактирования. Сохранение и удаление работают.

- [ ] **Шаг 4: Коммит**

```bash
git add components/board/
git commit -m "feat: add task edit dialog with inline editing and deletion"
```

---

## Task 12: Страница настроек

**Файлы:**
- Создать: `app/(app)/settings/page.tsx`, `components/settings/columns-manager.tsx`, `components/settings/categories-manager.tsx`, `components/settings/pin-change-form.tsx`

- [ ] **Шаг 1: Создать компонент управления колонками**

Файл `components/settings/columns-manager.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { GripVertical, Pencil, Trash2, Plus, Check, X } from "lucide-react";
import {
  createColumnAction,
  updateColumnAction,
  deleteColumnAction,
} from "@/lib/actions/columns";
import { toast } from "sonner";

type Column = { id: string; title: string; position: number };

interface ColumnsManagerProps {
  columns: Column[];
}

export function ColumnsManager({ columns }: ColumnsManagerProps) {
  const [isPending, startTransition] = useTransition();
  const [newTitle, setNewTitle] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");

  function handleCreate() {
    if (!newTitle.trim()) return;
    startTransition(async () => {
      await createColumnAction(newTitle.trim());
      setNewTitle("");
      toast.success("Колонка добавлена");
    });
  }

  function handleUpdate(id: string) {
    if (!editingTitle.trim()) return;
    startTransition(async () => {
      await updateColumnAction(id, editingTitle.trim());
      setEditingId(null);
      toast.success("Колонка переименована");
    });
  }

  function handleDelete(id: string) {
    startTransition(async () => {
      const result = await deleteColumnAction(id);
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success("Колонка удалена");
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Колонки</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {columns.map((col) => (
          <div
            key={col.id}
            className="flex items-center gap-2 rounded-md border p-2"
          >
            <GripVertical className="h-4 w-4 text-muted-foreground" />
            {editingId === col.id ? (
              <>
                <Input
                  value={editingTitle}
                  onChange={(e) => setEditingTitle(e.target.value)}
                  className="flex-1 h-8"
                  autoFocus
                />
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => handleUpdate(col.id)}
                  disabled={isPending}
                >
                  <Check className="h-4 w-4" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => setEditingId(null)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </>
            ) : (
              <>
                <span className="flex-1 text-sm">{col.title}</span>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => {
                    setEditingId(col.id);
                    setEditingTitle(col.title);
                  }}
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => handleDelete(col.id)}
                  disabled={isPending}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </>
            )}
          </div>
        ))}

        <div className="flex gap-2 pt-2">
          <Input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Новая колонка"
            className="flex-1"
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
          />
          <Button onClick={handleCreate} disabled={isPending} size="sm">
            <Plus className="mr-1 h-4 w-4" />
            Добавить
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Шаг 2: Создать компонент управления категориями**

Файл `components/settings/categories-manager.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Pencil, Trash2, Plus, Check, X } from "lucide-react";
import {
  createCategoryAction,
  updateCategoryAction,
  deleteCategoryAction,
} from "@/lib/actions/categories";
import { toast } from "sonner";

type Category = { id: string; name: string; color: string | null };

interface CategoriesManagerProps {
  categories: Category[];
}

export function CategoriesManager({ categories }: CategoriesManagerProps) {
  const [isPending, startTransition] = useTransition();
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");

  function handleCreate() {
    if (!newName.trim()) return;
    startTransition(async () => {
      await createCategoryAction(newName.trim());
      setNewName("");
      toast.success("Категория добавлена");
    });
  }

  function handleUpdate(id: string) {
    if (!editingName.trim()) return;
    startTransition(async () => {
      await updateCategoryAction(id, { name: editingName.trim() });
      setEditingId(null);
      toast.success("Категория обновлена");
    });
  }

  function handleDelete(id: string) {
    startTransition(async () => {
      await deleteCategoryAction(id);
      toast.success("Категория удалена");
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Категории</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {categories.map((cat) => (
          <div
            key={cat.id}
            className="flex items-center gap-2 rounded-md border p-2"
          >
            {editingId === cat.id ? (
              <>
                <Input
                  value={editingName}
                  onChange={(e) => setEditingName(e.target.value)}
                  className="flex-1 h-8"
                  autoFocus
                />
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => handleUpdate(cat.id)}
                  disabled={isPending}
                >
                  <Check className="h-4 w-4" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => setEditingId(null)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </>
            ) : (
              <>
                <span className="flex-1 text-sm">{cat.name}</span>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => {
                    setEditingId(cat.id);
                    setEditingName(cat.name);
                  }}
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => handleDelete(cat.id)}
                  disabled={isPending}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </>
            )}
          </div>
        ))}

        <div className="flex gap-2 pt-2">
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Новая категория"
            className="flex-1"
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
          />
          <Button onClick={handleCreate} disabled={isPending} size="sm">
            <Plus className="mr-1 h-4 w-4" />
            Добавить
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Шаг 3: Создать компонент смены PIN**

Файл `components/settings/pin-change-form.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import { changePinAction } from "@/lib/actions/auth";
import { toast } from "sonner";

export function PinChangeForm() {
  const [isPending, startTransition] = useTransition();
  const [currentPin, setCurrentPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");

  function handleSubmit() {
    if (newPin !== confirmPin) {
      toast.error("Новые PIN-коды не совпадают");
      return;
    }

    startTransition(async () => {
      const result = await changePinAction(currentPin, newPin);
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success("PIN изменён");
        setCurrentPin("");
        setNewPin("");
        setConfirmPin("");
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Смена PIN</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <Label>Текущий PIN</Label>
          <InputOTP maxLength={6} value={currentPin} onChange={setCurrentPin}>
            <InputOTPGroup>
              {Array.from({ length: 6 }).map((_, i) => (
                <InputOTPSlot key={i} index={i} />
              ))}
            </InputOTPGroup>
          </InputOTP>
        </div>

        <div>
          <Label>Новый PIN</Label>
          <InputOTP maxLength={6} value={newPin} onChange={setNewPin}>
            <InputOTPGroup>
              {Array.from({ length: 6 }).map((_, i) => (
                <InputOTPSlot key={i} index={i} />
              ))}
            </InputOTPGroup>
          </InputOTP>
        </div>

        <div>
          <Label>Подтвердите новый PIN</Label>
          <InputOTP maxLength={6} value={confirmPin} onChange={setConfirmPin}>
            <InputOTPGroup>
              {Array.from({ length: 6 }).map((_, i) => (
                <InputOTPSlot key={i} index={i} />
              ))}
            </InputOTPGroup>
          </InputOTP>
        </div>

        <Button
          onClick={handleSubmit}
          disabled={
            isPending ||
            currentPin.length < 6 ||
            newPin.length < 6 ||
            confirmPin.length < 6
          }
        >
          {isPending ? "Сохранение..." : "Сменить PIN"}
        </Button>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Шаг 4: Создать страницу настроек**

Файл `app/(app)/settings/page.tsx`:

```tsx
import { getColumns } from "@/lib/services/columns";
import { getCategories } from "@/lib/services/categories";
import { ColumnsManager } from "@/components/settings/columns-manager";
import { CategoriesManager } from "@/components/settings/categories-manager";
import { PinChangeForm } from "@/components/settings/pin-change-form";

export default async function SettingsPage() {
  const [columns, categories] = await Promise.all([
    getColumns(),
    getCategories(),
  ]);

  return (
    <div className="container max-w-2xl px-4 py-6 space-y-6">
      <h1 className="text-2xl font-bold">Настройки</h1>
      <ColumnsManager columns={columns} />
      <CategoriesManager categories={categories} />
      <PinChangeForm />
    </div>
  );
}
```

- [ ] **Шаг 5: Проверить страницу настроек**

```bash
npm run dev
```

Ожидание: `/settings` показывает три секции. Можно добавлять/переименовывать/удалять колонки и категории, менять PIN.

- [ ] **Шаг 6: Коммит**

```bash
git add app/(app)/settings/ components/settings/
git commit -m "feat: add settings page with column, category, and PIN management"
```

---

## Task 13: Сайдбар отчёта за неделю

**Файлы:**
- Создать: `components/report/report-sidebar.tsx`
- Изменить: `app/(app)/layout.tsx` (подключить сайдбар)

- [ ] **Шаг 1: Создать серверный action для отчёта**

Добавить в `lib/actions/tasks.ts`:

```typescript
import { getWeeklyReport, formatReportAsText } from "@/lib/services/reports";

export async function getReportAction(dateStr: string) {
  const date = new Date(dateStr);
  return getWeeklyReport(date);
}

export async function getReportTextAction(dateStr: string) {
  const date = new Date(dateStr);
  const report = await getWeeklyReport(date);
  return formatReportAsText(report);
}
```

- [ ] **Шаг 2: Создать компонент сайдбара отчёта**

Файл `components/report/report-sidebar.tsx`:

```tsx
"use client";

import { useState, useEffect, useTransition } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChevronLeft, ChevronRight, Copy } from "lucide-react";
import { format, addWeeks, subWeeks, startOfWeek } from "date-fns";
import { ru } from "date-fns/locale";
import { getReportAction, getReportTextAction } from "@/lib/actions/tasks";
import { toast } from "sonner";
import type { WeeklyReport } from "@/lib/services/reports";

interface ReportSidebarProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ReportSidebar({ open, onOpenChange }: ReportSidebarProps) {
  const [isPending, startTransition] = useTransition();
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [report, setReport] = useState<WeeklyReport | null>(null);

  useEffect(() => {
    if (!open) return;
    startTransition(async () => {
      const data = await getReportAction(selectedDate.toISOString());
      setReport(data);
    });
  }, [open, selectedDate]);

  function goToPreviousWeek() {
    setSelectedDate((d) => subWeeks(d, 1));
  }

  function goToNextWeek() {
    setSelectedDate((d) => addWeeks(d, 1));
  }

  function goToCurrentWeek() {
    setSelectedDate(new Date());
  }

  async function copyReport() {
    const text = await getReportTextAction(selectedDate.toISOString());
    await navigator.clipboard.writeText(text);
    toast.success("Отчёт скопирован");
  }

  const weekStart = report?.weekStart
    ? format(report.weekStart, "d MMMM", { locale: ru })
    : "";
  const weekEnd = report?.weekEnd
    ? format(report.weekEnd, "d MMMM yyyy", { locale: ru })
    : "";

  const progressPercent =
    report && report.startedCount > 0
      ? Math.round((report.completedCount / report.startedCount) * 100)
      : 0;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Отчёт за неделю</SheetTitle>
        </SheetHeader>

        <div className="mt-4 space-y-4">
          {/* Навигация по неделям */}
          <div className="flex items-center justify-between">
            <Button variant="ghost" size="icon" onClick={goToPreviousWeek}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm" onClick={goToCurrentWeek}>
              Текущая неделя
            </Button>
            <Button variant="ghost" size="icon" onClick={goToNextWeek}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

          {report && (
            <>
              {/* Период */}
              <p className="text-sm text-center text-muted-foreground">
                {weekStart} — {weekEnd}
              </p>

              {/* Сводка */}
              <div className="rounded-lg border p-4">
                <p className="text-sm font-medium">
                  Выполнено: {report.completedCount} из {report.startedCount}{" "}
                  задач
                </p>
                <div className="mt-2 h-2 rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary transition-all"
                    style={{ width: `${Math.min(progressPercent, 100)}%` }}
                  />
                </div>
                <p className="mt-1 text-xs text-muted-foreground text-right">
                  {progressPercent}%
                </p>
              </div>

              {/* Список задач */}
              <div className="space-y-3">
                {report.completedTasks.map((task) => (
                  <div key={task.id} className="rounded-md border p-3">
                    <div className="flex items-start justify-between">
                      <p className="text-sm font-medium">✓ {task.title}</p>
                      {task.categoryName && (
                        <Badge variant="secondary" className="text-xs ml-2">
                          {task.categoryName}
                        </Badge>
                      )}
                    </div>
                    {task.description && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {task.description}
                      </p>
                    )}
                    <p className="mt-1 text-xs text-muted-foreground">
                      Завершена:{" "}
                      {format(task.completedAt, "dd.MM.yyyy", { locale: ru })}
                    </p>
                  </div>
                ))}

                {report.completedTasks.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    Нет выполненных задач за эту неделю
                  </p>
                )}
              </div>

              {/* Копировать */}
              <Button
                variant="outline"
                className="w-full"
                onClick={copyReport}
              >
                <Copy className="mr-2 h-4 w-4" />
                Копировать текст
              </Button>
            </>
          )}

          {isPending && (
            <p className="text-sm text-muted-foreground text-center">
              Загрузка...
            </p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
```

- [ ] **Шаг 3: Подключить сайдбар в layout**

Переработать `app/(app)/layout.tsx` — обернуть в клиентский компонент-обёртку.

Создать `components/app-shell.tsx`:

```tsx
"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { CalendarDays, BarChart3, Settings } from "lucide-react";
import { ReportSidebar } from "@/components/report/report-sidebar";
// TodayPlanModal — заглушка, заменяется в Task 14
function TodayPlanModal({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  if (!open) return null;
  return null;
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const [reportOpen, setReportOpen] = useState(false);
  const [todayPlanOpen, setTodayPlanOpen] = useState(false);

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b bg-background">
        <div className="container flex h-14 items-center justify-between px-4">
          <Link href="/" className="text-lg font-bold">
            Constance
          </Link>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setTodayPlanOpen(true)}
            >
              <CalendarDays className="mr-2 h-4 w-4" />
              <span className="hidden sm:inline">План на сегодня</span>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setReportOpen(true)}
            >
              <BarChart3 className="mr-2 h-4 w-4" />
              <span className="hidden sm:inline">Отчёт</span>
            </Button>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/settings">
                <Settings className="mr-2 h-4 w-4" />
                <span className="hidden sm:inline">Настройки</span>
              </Link>
            </Button>
          </div>
        </div>
      </header>
      <main className="flex-1">{children}</main>

      <ReportSidebar open={reportOpen} onOpenChange={setReportOpen} />
      <TodayPlanModal open={todayPlanOpen} onOpenChange={setTodayPlanOpen} />
    </div>
  );
}
```

Обновить `app/(app)/layout.tsx`:

```tsx
import { AppShell } from "@/components/app-shell";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
```

- [ ] **Шаг 4: Проверить сайдбар отчёта**

```bash
npm run dev
```

Ожидание: кнопка «Отчёт» в шапке открывает сайдбар справа. Навигация по неделям работает. Кнопка «Копировать текст» копирует отчёт в буфер.

- [ ] **Шаг 5: Коммит**

```bash
git add components/report/ components/app-shell.tsx app/(app)/layout.tsx lib/actions/tasks.ts
git commit -m "feat: add weekly report sidebar with week navigation and copy to clipboard"
```

---

## Task 14: Модалка «План на сегодня»

**Файлы:**
- Создать: `components/modals/today-plan-modal.tsx`
- Создать: `lib/actions/today.ts`
- Изменить: `components/app-shell.tsx` (заменить заглушку TodayPlanModal на импорт)

- [ ] **Шаг 1: Создать Server Action для плана на сегодня**

Файл `lib/actions/today.ts`:

```typescript
"use server";

import { getTasksForToday } from "@/lib/services/tasks";
import { getColumns } from "@/lib/services/columns";

export async function getTodayPlanAction() {
  const [todayTasks, columns] = await Promise.all([
    getTasksForToday(),
    getColumns(),
  ]);

  // Группировка по колонкам
  const grouped = columns
    .map((col) => ({
      column: col,
      tasks: todayTasks.filter((t) => t.columnId === col.id),
    }))
    .filter((g) => g.tasks.length > 0);

  return { grouped, totalCount: todayTasks.length };
}
```

- [ ] **Шаг 2: Создать компонент модалки**

Файл `components/modals/today-plan-modal.tsx`:

```tsx
"use client";

import { useState, useEffect, useTransition } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { getTodayPlanAction } from "@/lib/actions/today";
import { format } from "date-fns";
import { ru } from "date-fns/locale";

interface TodayPlanModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type TodayPlan = Awaited<ReturnType<typeof getTodayPlanAction>>;

const priorityColors = {
  urgent: "border-l-red-500",
  high: "border-l-yellow-500",
  normal: "border-l-gray-300",
};

export function TodayPlanModal({ open, onOpenChange }: TodayPlanModalProps) {
  const [isPending, startTransition] = useTransition();
  const [plan, setPlan] = useState<TodayPlan | null>(null);

  useEffect(() => {
    if (!open) return;
    startTransition(async () => {
      const data = await getTodayPlanAction();
      setPlan(data);
    });
  }, [open]);

  const today = format(new Date(), "dd.MM.yyyy", { locale: ru });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>План на сегодня ({today})</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {isPending && (
            <p className="text-sm text-muted-foreground">Загрузка...</p>
          )}

          {plan && plan.grouped.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">
              Нет задач с плановой датой на сегодня
            </p>
          )}

          {plan?.grouped.map(({ column, tasks }) => (
            <div key={column.id}>
              <h4 className="text-sm font-semibold text-muted-foreground mb-2">
                {column.title}
              </h4>
              <div className="space-y-2">
                {tasks.map((task) => (
                  <div
                    key={task.id}
                    className={`rounded-md border border-l-4 p-3 ${priorityColors[task.priority]}`}
                  >
                    <p className="text-sm font-medium">{task.title}</p>
                    {task.description && (
                      <p className="text-xs text-muted-foreground mt-1">
                        {task.description}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}

          {plan && (
            <p className="text-sm text-muted-foreground text-center border-t pt-3">
              Задач на сегодня: {plan.totalCount}
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Шаг 3: Заменить заглушку в app-shell.tsx на реальный импорт**

В `components/app-shell.tsx` заменить заглушку `TodayPlanModal` на:

```tsx
import { TodayPlanModal } from "@/components/modals/today-plan-modal";
```

И удалить inline-заглушку функции `TodayPlanModal`.

- [ ] **Шаг 4: Проверить модалку**

```bash
npm run dev
```

Ожидание: кнопка «План на сегодня» открывает модалку. Если есть задачи с `planned_date = сегодня` — они показываются, сгруппированные по колонкам.

- [ ] **Шаг 5: Коммит**

```bash
git add components/modals/today-plan-modal.tsx lib/actions/today.ts components/app-shell.tsx
git commit -m "feat: add today's plan modal showing tasks due today"
```

---

## Task 15: API Routes для Telegram-бота

**Файлы:**
- Создать: `app/api/auth/route.ts`, `app/api/tasks/route.ts`, `app/api/tasks/[id]/route.ts`, `app/api/report/route.ts`

- [ ] **Шаг 1: Создать хелпер проверки API-ключа**

Файл `lib/api-auth.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { verifyApiKey } from "@/lib/services/auth";

export async function withApiAuth(
  request: NextRequest,
  handler: () => Promise<NextResponse>
): Promise<NextResponse> {
  const apiKey = request.headers.get("X-API-Key");
  if (!apiKey) {
    return NextResponse.json({ error: "API key required" }, { status: 401 });
  }
  const valid = await verifyApiKey(apiKey);
  if (!valid) {
    return NextResponse.json({ error: "Invalid API key" }, { status: 401 });
  }
  return handler();
}
```

- [ ] **Шаг 2: Создать API Route для авторизации**

Файл `app/api/auth/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { verifyPin } from "@/lib/services/auth";

export async function POST(request: NextRequest) {
  const { pin } = await request.json();
  const valid = await verifyPin(pin);
  if (!valid) {
    return NextResponse.json({ error: "Invalid PIN" }, { status: 401 });
  }
  return NextResponse.json({ success: true });
}
```

- [ ] **Шаг 3: Создать API Routes для задач**

Файл `app/api/tasks/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { withApiAuth } from "@/lib/api-auth";
import { getTasks, createTask } from "@/lib/services/tasks";

export async function GET(request: NextRequest) {
  return withApiAuth(request, async () => {
    const tasks = await getTasks();
    return NextResponse.json(tasks);
  });
}

export async function POST(request: NextRequest) {
  return withApiAuth(request, async () => {
    const body = await request.json();
    const task = await createTask(body);
    return NextResponse.json(task, { status: 201 });
  });
}
```

Файл `app/api/tasks/[id]/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { withApiAuth } from "@/lib/api-auth";
import { updateTask, deleteTask } from "@/lib/services/tasks";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withApiAuth(request, async () => {
    const { id } = await params;
    const body = await request.json();
    const task = await updateTask(id, body);
    return NextResponse.json(task);
  });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withApiAuth(request, async () => {
    const { id } = await params;
    await deleteTask(id);
    return NextResponse.json({ success: true });
  });
}
```

- [ ] **Шаг 4: Создать API Route для отчёта**

Файл `app/api/report/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { withApiAuth } from "@/lib/api-auth";
import { getWeeklyReport, formatReportAsText } from "@/lib/services/reports";
import { startOfWeek } from "date-fns";

export async function GET(request: NextRequest) {
  return withApiAuth(request, async () => {
    const weekParam = request.nextUrl.searchParams.get("week");
    const date = weekParam ? parseISOWeek(weekParam) : new Date();
    const report = await getWeeklyReport(date);
    const format = request.nextUrl.searchParams.get("format");

    if (format === "text") {
      return new NextResponse(formatReportAsText(report), {
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }

    return NextResponse.json(report);
  });
}

function parseISOWeek(weekStr: string): Date {
  // Формат: 2026-W14
  const match = weekStr.match(/^(\d{4})-W(\d{1,2})$/);
  if (!match) return new Date();
  const year = parseInt(match[1]);
  const week = parseInt(match[2]);
  const jan4 = new Date(year, 0, 4);
  const start = startOfWeek(jan4, { weekStartsOn: 1 });
  start.setDate(start.getDate() + (week - 1) * 7);
  return start;
}
```

- [ ] **Шаг 5: Проверить API**

```bash
# Создать задачу через API
curl -X POST http://localhost:3000/api/tasks \
  -H "Content-Type: application/json" \
  -H "X-API-Key: 123456" \
  -d '{"title":"Тестовая задача","columnId":"<id первой колонки>"}'

# Получить отчёт
curl http://localhost:3000/api/report?format=text \
  -H "X-API-Key: 123456"
```

Ожидание: 201 Created с JSON задачи / текстовый отчёт.

- [ ] **Шаг 6: Коммит**

```bash
git add app/api/ lib/api-auth.ts
git commit -m "feat: add REST API routes for future Telegram bot integration"
```

---

## Task 16: Финальная сборка и деплой

**Файлы:**
- Изменить: `next.config.ts` (при необходимости)
- Создать: `.gitignore` дополнения

- [ ] **Шаг 1: Убедиться, что проект собирается**

```bash
npm run build
```

Ожидание: сборка проходит без ошибок.

- [ ] **Шаг 2: Добавить .env.local в .gitignore**

Убедиться, что `.gitignore` содержит:
```
.env.local
.env*.local
```

- [ ] **Шаг 3: Подключить Neon через Vercel Marketplace**

```bash
npm i -g vercel
vercel link
# Через Vercel Dashboard: Storage → Add → Neon Postgres → Connect
vercel env pull
```

Это автоматически добавит `DATABASE_URL` в переменные окружения Vercel.

- [ ] **Шаг 4: Применить миграции к production БД**

```bash
npx drizzle-kit push
npm run db:seed
```

- [ ] **Шаг 5: Задеплоить**

```bash
vercel deploy --prod
```

Ожидание: приложение доступно по URL на Vercel, показывает экран ввода PIN.

- [ ] **Шаг 6: Коммит**

```bash
git add .
git commit -m "chore: finalize project for Vercel deployment"
```
