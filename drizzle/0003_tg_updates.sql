CREATE TYPE "public"."tg_update_status" AS ENUM('received', 'processed', 'failed');--> statement-breakpoint
CREATE TABLE "tg_updates" (
	"update_id" bigint PRIMARY KEY NOT NULL,
	"chat_id" bigint,
	"raw_text" text,
	"payload" jsonb NOT NULL,
	"status" "tg_update_status" DEFAULT 'received' NOT NULL,
	"error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"processed_at" timestamp
);
