CREATE TYPE "public"."tg_handle_status" AS ENUM('active', 'used', 'cancelled');--> statement-breakpoint
CREATE TABLE "tg_handles" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"chat_id" bigint,
	"message_id" bigint,
	"status" "tg_handle_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE INDEX "tg_handles_chat_idx" ON "tg_handles" USING btree ("chat_id","kind","status");