-- Колонка уже существует в прод-базе: была накатана через `drizzle-kit push`
-- до появления процесса миграций. IF NOT EXISTS делает миграцию безопасной
-- и на существующей базе, и на пустой.
ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "nickname" text;
