CREATE TABLE "ai_usage_daily" (
	"user_id" uuid NOT NULL,
	"local_date" date NOT NULL,
	"name" text NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "ai_usage_daily_user_id_local_date_name_pk" PRIMARY KEY("user_id","local_date","name")
);
--> statement-breakpoint
ALTER TABLE "ai_usage_daily" ADD CONSTRAINT "ai_usage_daily_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;