ALTER TABLE "user_reports" DROP CONSTRAINT "user_reports_subject_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "user_reports" ALTER COLUMN "subject_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "user_reports" ADD COLUMN "subject_handle" text;--> statement-breakpoint
ALTER TABLE "clan_dispatches" ADD COLUMN "template_key" text;--> statement-breakpoint
ALTER TABLE "clan_dispatches" ADD COLUMN "actor_id" uuid;--> statement-breakpoint
ALTER TABLE "clan_dispatches" ADD COLUMN "subject_id" uuid;--> statement-breakpoint
ALTER TABLE "clan_raids" ADD COLUMN "value_hidden" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "named_challenges" ADD COLUMN "outcome" text;--> statement-breakpoint
ALTER TABLE "user_reports" ADD CONSTRAINT "user_reports_subject_id_users_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clan_dispatches" ADD CONSTRAINT "clan_dispatches_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clan_dispatches" ADD CONSTRAINT "clan_dispatches_subject_id_users_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "named_challenges" ADD CONSTRAINT "named_challenges_outcome_valid" CHECK ("named_challenges"."outcome" is null or "named_challenges"."outcome" in ('challenger_won', 'opponent_won', 'draw', 'void'));