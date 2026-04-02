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
