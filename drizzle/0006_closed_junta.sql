CREATE TABLE "note_folders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"parent_id" uuid,
	"environment_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "note_folders_id_environment_key" UNIQUE("id","environment_id")
);
--> statement-breakpoint
CREATE TABLE "notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"text" text DEFAULT '' NOT NULL,
	"folder_id" uuid,
	"environment_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "note_folders" ADD CONSTRAINT "note_folders_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_folders" ADD CONSTRAINT "note_folders_parent_fk" FOREIGN KEY ("parent_id","environment_id") REFERENCES "public"."note_folders"("id","environment_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_folder_fk" FOREIGN KEY ("folder_id","environment_id") REFERENCES "public"."note_folders"("id","environment_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "note_folders_sibling_name_idx" ON "note_folders" USING btree ("environment_id","parent_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "note_folders_root_name_idx" ON "note_folders" USING btree ("environment_id","name") WHERE parent_id is null;--> statement-breakpoint
CREATE UNIQUE INDEX "notes_folder_title_idx" ON "notes" USING btree ("folder_id","title");--> statement-breakpoint
CREATE UNIQUE INDEX "notes_root_title_idx" ON "notes" USING btree ("environment_id","title") WHERE folder_id is null;--> statement-breakpoint
CREATE INDEX "notes_environment_idx" ON "notes" USING btree ("environment_id");