CREATE TABLE "comebacks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"started_on" date NOT NULL,
	"gap_days" integer NOT NULL,
	"checklist" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "home_path_active" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "home_sessions" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "returner_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "comebacks" ADD CONSTRAINT "comebacks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "comebacks_user_started_idx" ON "comebacks" USING btree ("user_id","started_on");