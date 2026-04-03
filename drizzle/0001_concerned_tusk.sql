CREATE TABLE "environments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"color" text NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
INSERT INTO "environments" ("id", "name", "color", "position")
VALUES ('00000000-0000-0000-0000-000000000001', 'Основная', '#3b82f6', 0);
--> statement-breakpoint
ALTER TABLE "columns" ADD COLUMN "environment_id" uuid;--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "environment_id" uuid;--> statement-breakpoint
UPDATE "columns" SET "environment_id" = '00000000-0000-0000-0000-000000000001';--> statement-breakpoint
UPDATE "categories" SET "environment_id" = '00000000-0000-0000-0000-000000000001';--> statement-breakpoint
ALTER TABLE "columns" ALTER COLUMN "environment_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "categories" ALTER COLUMN "environment_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "columns" ADD CONSTRAINT "columns_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;
