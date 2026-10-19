CREATE TABLE "named_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"challenger_id" uuid,
	"opponent_id" uuid,
	"domain" text NOT NULL,
	"days" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"respond_by" timestamp with time zone NOT NULL,
	"start_date" date,
	"end_date" date,
	"challenger_start" real,
	"opponent_start" real,
	"challenger_end" real,
	"opponent_end" real,
	"winner_id" uuid,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "named_challenges_days_valid" CHECK ("named_challenges"."days" in (3, 7, 14, 30)),
	CONSTRAINT "named_challenges_status_valid" CHECK ("named_challenges"."status" in ('pending', 'active', 'ignored', 'resolved', 'void')),
	CONSTRAINT "named_challenges_distinct" CHECK ("named_challenges"."challenger_id" is null or "named_challenges"."opponent_id" is null or "named_challenges"."challenger_id" <> "named_challenges"."opponent_id")
);
--> statement-breakpoint
ALTER TABLE "quests" ADD COLUMN "shame_mode" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "named_challenges" ADD CONSTRAINT "named_challenges_challenger_id_users_id_fk" FOREIGN KEY ("challenger_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "named_challenges" ADD CONSTRAINT "named_challenges_opponent_id_users_id_fk" FOREIGN KEY ("opponent_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "named_challenges" ADD CONSTRAINT "named_challenges_winner_id_users_id_fk" FOREIGN KEY ("winner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "named_challenges_challenger_idx" ON "named_challenges" USING btree ("challenger_id","status");--> statement-breakpoint
CREATE INDEX "named_challenges_opponent_idx" ON "named_challenges" USING btree ("opponent_id","status");--> statement-breakpoint
CREATE INDEX "named_challenges_open_idx" ON "named_challenges" USING btree ("status","respond_by");