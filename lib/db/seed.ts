import { loadEnvConfig } from "@next/env";
import { neon } from "@neondatabase/serverless";

loadEnvConfig(process.cwd());
import { drizzle } from "drizzle-orm/neon-http";
import { environments, columns, settings } from "./schema";
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

  // Создать дефолтную среду если нет ни одной
  const existingEnvs = await db.select().from(environments);
  if (existingEnvs.length === 0) {
    const [env] = await db
      .insert(environments)
      .values({ name: "Основная", color: "#3b82f6", position: 0 })
      .returning();
    console.log("Default environment created: Основная");

    // Создать дефолтные колонки для этой среды
    const existingColumns = await db.select().from(columns);
    if (existingColumns.length === 0) {
      await db.insert(columns).values([
        { title: "Бэклог", position: 0, environmentId: env.id },
        { title: "В работе", position: 1, environmentId: env.id },
        { title: "Готово", position: 2, environmentId: env.id },
      ]);
      console.log("Default columns created: Бэклог, В работе, Готово");
    }
  }

  console.log("Seed complete");
}

seed().catch(console.error);
