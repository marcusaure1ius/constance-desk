import { db } from "@/lib/db";
import { environments, columns } from "@/lib/db/schema";
import { eq, asc } from "drizzle-orm";

const DEFAULT_COLUMNS = [
  { title: "Бэклог", position: 0 },
  { title: "В работе", position: 1 },
  { title: "Готово", position: 2 },
];

export async function getEnvironments() {
  return db.select().from(environments).orderBy(asc(environments.position));
}

export async function getEnvironmentById(id: string) {
  const [env] = await db
    .select()
    .from(environments)
    .where(eq(environments.id, id));
  return env ?? null;
}

export async function createEnvironment(name: string, color: string) {
  const existing = await getEnvironments();
  const maxPosition = existing.length > 0
    ? Math.max(...existing.map((e) => e.position))
    : -1;

  const [env] = await db
    .insert(environments)
    .values({ name, color, position: maxPosition + 1 })
    .returning();

  // Создать дефолтные колонки для новой среды
  await db.insert(columns).values(
    DEFAULT_COLUMNS.map((col) => ({
      title: col.title,
      position: col.position,
      environmentId: env.id,
    }))
  );

  return env;
}

export async function updateEnvironment(
  id: string,
  data: { name?: string; color?: string }
) {
  const [env] = await db
    .update(environments)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(environments.id, id))
    .returning();
  return env;
}

export async function deleteEnvironment(
  id: string
): Promise<{ error?: string }> {
  const all = await getEnvironments();
  if (all.length <= 1) {
    return { error: "Нельзя удалить последнюю среду" };
  }

  await db.delete(environments).where(eq(environments.id, id));
  return {};
}

export async function getActiveEnvironment(cookieValue: string | undefined) {
  if (cookieValue) {
    const env = await getEnvironmentById(cookieValue);
    if (env) return env;
  }
  // Fallback — первая среда по position
  const all = await getEnvironments();
  return all[0] ?? null;
}
