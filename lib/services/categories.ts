import { db } from "@/lib/db";
import { categories } from "@/lib/db/schema";
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
  await db.delete(categories).where(eq(categories.id, id));
}
