CREATE TABLE "seasons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "life_context" text DEFAULT 'student' NOT NULL;--> statement-breakpoint
ALTER TABLE "seasons" ADD CONSTRAINT "seasons_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "seasons_user_ends_idx" ON "seasons" USING btree ("user_id","ends_on");