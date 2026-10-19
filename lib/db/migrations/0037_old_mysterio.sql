CREATE TABLE "rank_freezes" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"started_on" date NOT NULL,
	"until_on" date NOT NULL,
	"month" text NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "rank_freezes" ADD CONSTRAINT "rank_freezes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "rank_freezes_user_month_uq" ON "rank_freezes" USING btree ("user_id","month");