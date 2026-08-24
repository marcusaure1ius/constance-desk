import {
  pgTable,
  uuid,
  text,
  integer,
  bigint,
  jsonb,
  timestamp,
  date,
  pgEnum,
  index,
} from "drizzle-orm/pg-core";

export const priorityEnum = pgEnum("priority", ["urgent", "high", "normal"]);

export const settings = pgTable("settings", {
  id: integer("id").primaryKey().default(1),
  pinHash: text("pin_hash"),
  nickname: text("nickname"),
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

/** Состояние обработки апдейта из Telegram. */
export const tgUpdateStatusEnum = pgEnum("tg_update_status", [
  "received",
  "processed",
  "failed",
]);

/**
 * Входящие апдейты Telegram.
 *
 * Строка пишется ДО любой обработки: Telegram не повторит сообщение, если бот
 * уже ответил 200, поэтому потерять сырой текст нельзя. update_id первичный
 * ключ — на нём же держится дедуп повторной доставки.
 */
export const tgUpdates = pgTable("tg_updates", {
  updateId: bigint("update_id", { mode: "number" }).primaryKey(),
  chatId: bigint("chat_id", { mode: "number" }),
  rawText: text("raw_text"),
  payload: jsonb("payload").notNull(),
  status: tgUpdateStatusEnum("status").notNull().default("received"),
  error: text("error"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  processedAt: timestamp("processed_at"),
});

/** Состояние хендла: живой, отработанный, отменённый. */
export const tgHandleStatusEnum = pgEnum("tg_handle_status", [
  "active",
  "used",
  "cancelled",
]);

/**
 * Состояние за короткой кнопкой.
 *
 * В `callback_data` помещается 64 байта, и поисковый запрос («найди всё по
 * стратегии за третий квартал») туда не влезает в принципе. В кнопке лежит
 * идентификатор из десяти символов, а сам запрос — здесь.
 *
 * Вторая роль — ожидание ввода: нажатие «Название» не может изменить задачу
 * сразу, бот ждёт следующего сообщения, и это ожидание нужно где-то держать.
 *
 * `expires_at` не украшение: инлайн-кнопки живут вечно, и нажатие на карточке
 * месячной давности не должно ничего менять.
 */
export const tgHandles = pgTable(
  "tg_handles",
  {
    id: text("id").primaryKey(),
    kind: text("kind").notNull(),
    payload: jsonb("payload").notNull(),
    chatId: bigint("chat_id", { mode: "number" }),
    messageId: bigint("message_id", { mode: "number" }),
    status: tgHandleStatusEnum("status").notNull().default("active"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    expiresAt: timestamp("expires_at").notNull(),
  },
  (table) => [
    // Ожидание ввода ищется по чату, а не по идентификатору: следующее
    // сообщение пользователя про хендл ничего не знает.
    index("tg_handles_chat_idx").on(table.chatId, table.kind, table.status),
  ]
);
