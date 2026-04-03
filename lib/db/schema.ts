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

export const ENVIRONMENT_COLORS = [
  "#3b82f6", // синий
  "#22c55e", // зелёный
  "#f59e0b", // жёлтый
  "#ef4444", // красный
  "#8b5cf6", // фиолетовый
  "#ec4899", // розовый
  "#06b6d4", // голубой
  "#f97316", // оранжевый
] as const;

export const environments = pgTable("environments", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  color: text("color").notNull(),
  position: integer("position").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const columns = pgTable("columns", {
  id: uuid("id").defaultRandom().primaryKey(),
  title: text("title").notNull(),
  position: integer("position").notNull(),
  environmentId: uuid("environment_id")
    .notNull()
    .references(() => environments.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const categories = pgTable("categories", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  color: text("color"),
  environmentId: uuid("environment_id")
    .notNull()
    .references(() => environments.id, { onDelete: "cascade" }),
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
