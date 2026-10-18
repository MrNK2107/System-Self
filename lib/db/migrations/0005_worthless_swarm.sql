CREATE TABLE "achievements" (
	"user_id" uuid NOT NULL,
	"achievement_id" text NOT NULL,
	"unlocked_at" timestamp with time zone NOT NULL,
	CONSTRAINT "achievements_user_id_achievement_id_pk" PRIMARY KEY("user_id","achievement_id")
);
--> statement-breakpoint
CREATE TABLE "daily_snapshots" (
	"user_id" uuid NOT NULL,
	"local_date" date NOT NULL,
	"scores" jsonb NOT NULL,
	"hidden" real NOT NULL,
	"rank" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "daily_snapshots_user_id_local_date_pk" PRIMARY KEY("user_id","local_date")
);
--> statement-breakpoint
CREATE TABLE "debriefs" (
	"user_id" uuid NOT NULL,
	"local_date" date NOT NULL,
	"deltas" jsonb,
	"quest_completed" integer,
	"quest_total" integer,
	"verdict" text,
	"text" text,
	"model" text,
	"acknowledged_at" timestamp with time zone,
	CONSTRAINT "debriefs_user_id_local_date_pk" PRIMARY KEY("user_id","local_date")
);
--> statement-breakpoint
CREATE TABLE "domain_scores" (
	"user_id" uuid NOT NULL,
	"domain" text NOT NULL,
	"score" real NOT NULL,
	"streak" integer DEFAULT 0 NOT NULL,
	"last_log_date" date,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "domain_scores_user_id_domain_pk" PRIMARY KEY("user_id","domain")
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"user_id" uuid NOT NULL,
	"key" text NOT NULL,
	"route" text,
	"response_status" integer,
	"response_body" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idempotency_keys_user_id_key_pk" PRIMARY KEY("user_id","key")
);
--> statement-breakpoint
CREATE TABLE "logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"client_id" text NOT NULL,
	"domain" text NOT NULL,
	"log_type" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"free_text" text,
	"forbidden" boolean DEFAULT false NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"local_date" date NOT NULL,
	"is_retroactive" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "milestones" (
	"user_id" uuid NOT NULL,
	"domain" text NOT NULL,
	"tier" integer NOT NULL,
	"unlocked_at" timestamp with time zone NOT NULL,
	CONSTRAINT "milestones_user_id_domain_tier_pk" PRIMARY KEY("user_id","domain","tier")
);
--> statement-breakpoint
CREATE TABLE "notices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"seen_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"identity_setting" text DEFAULT 'semi-public' NOT NULL,
	"primary_goal" text NOT NULL,
	"biggest_weakness" text NOT NULL,
	"stopped_before" text,
	"morning_time" text DEFAULT '07:00' NOT NULL,
	"nightly_time" text DEFAULT '21:00' NOT NULL,
	"rank" text DEFAULT 'E' NOT NULL,
	"rank_since" timestamp with time zone DEFAULT now() NOT NULL,
	"codename" text NOT NULL,
	"onboarded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"onboarding_ratings" jsonb NOT NULL,
	"rank_freeze_until" date,
	"rank_freeze_used_month" text
);
--> statement-breakpoint
CREATE TABLE "quest_chains" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"template_key" text NOT NULL,
	"name" text NOT NULL,
	"domain" text NOT NULL,
	"current_step" integer DEFAULT 0 NOT NULL,
	"total_steps" integer NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "quests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"batch_id" integer,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"domain" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_local_date" date,
	"generated_by_system" boolean DEFAULT true NOT NULL,
	"chain_id" uuid,
	"chain_step" integer,
	"chain_total" integer,
	"refusal_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "score_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"domain" text NOT NULL,
	"delta" real NOT NULL,
	"actual_delta" real NOT NULL,
	"reason" text NOT NULL,
	"ref_id" text,
	"local_date" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shadow_selves" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	"codename" text NOT NULL,
	"initial_scores" jsonb,
	"gain_rates" jsonb,
	"activated_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"gap_at_activation" real
);
--> statement-breakpoint
CREATE TABLE "user_day_state" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"last_rolled_date" date,
	"next_rollover_at" timestamp with time zone NOT NULL,
	"last_activity_date" date
);
--> statement-breakpoint
CREATE TABLE "body_part_scores" (
	"user_id" uuid NOT NULL,
	"body_part" text NOT NULL,
	"points" real DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "body_part_scores_user_id_body_part_pk" PRIMARY KEY("user_id","body_part")
);
--> statement-breakpoint
CREATE TABLE "exercises" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"name" text NOT NULL,
	"primary_body_part" text NOT NULL,
	"secondary_body_parts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_big5" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "performed_sets" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"session_id" uuid NOT NULL,
	"exercise_id" text NOT NULL,
	"set_index" integer NOT NULL,
	"reps" integer NOT NULL,
	"weight" real DEFAULT 0 NOT NULL,
	"completed" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "personal_records" (
	"user_id" uuid NOT NULL,
	"exercise_id" text NOT NULL,
	"value" real NOT NULL,
	"reps" integer NOT NULL,
	"weight" real NOT NULL,
	"achieved_at" timestamp with time zone NOT NULL,
	CONSTRAINT "personal_records_user_id_exercise_id_pk" PRIMARY KEY("user_id","exercise_id")
);
--> statement-breakpoint
CREATE TABLE "workout_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"goal" text NOT NULL,
	"days" jsonb NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workout_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"plan_id" uuid,
	"started_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"local_date" date NOT NULL,
	"points" real DEFAULT 0 NOT NULL,
	"client_id" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "achievements" ADD CONSTRAINT "achievements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_snapshots" ADD CONSTRAINT "daily_snapshots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "debriefs" ADD CONSTRAINT "debriefs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain_scores" ADD CONSTRAINT "domain_scores_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "logs" ADD CONSTRAINT "logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notices" ADD CONSTRAINT "notices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quest_chains" ADD CONSTRAINT "quest_chains_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quests" ADD CONSTRAINT "quests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quests" ADD CONSTRAINT "quests_batch_id_generated_quest_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."generated_quest_batches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "score_events" ADD CONSTRAINT "score_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shadow_selves" ADD CONSTRAINT "shadow_selves_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_day_state" ADD CONSTRAINT "user_day_state_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "body_part_scores" ADD CONSTRAINT "body_part_scores_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercises" ADD CONSTRAINT "exercises_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performed_sets" ADD CONSTRAINT "performed_sets_session_id_workout_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."workout_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_records" ADD CONSTRAINT "personal_records_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_plans" ADD CONSTRAINT "workout_plans_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_sessions" ADD CONSTRAINT "workout_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_sessions" ADD CONSTRAINT "workout_sessions_plan_id_workout_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."workout_plans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "logs_user_client_id_idx" ON "logs" USING btree ("user_id","client_id");--> statement-breakpoint
CREATE INDEX "logs_user_occurred_at_idx" ON "logs" USING btree ("user_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "notices_user_seen_created_idx" ON "notices" USING btree ("user_id","seen_at","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "quest_chains_active_template_idx" ON "quest_chains" USING btree ("user_id","template_key") WHERE "quest_chains"."status" = 'active';--> statement-breakpoint
CREATE INDEX "quests_user_status_expires_idx" ON "quests" USING btree ("user_id","status","expires_at");--> statement-breakpoint
CREATE INDEX "score_events_user_created_idx" ON "score_events" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "score_events_user_local_date_idx" ON "score_events" USING btree ("user_id","local_date");--> statement-breakpoint
CREATE INDEX "user_day_state_next_rollover_idx" ON "user_day_state" USING btree ("next_rollover_at");--> statement-breakpoint
CREATE INDEX "performed_sets_session_idx" ON "performed_sets" USING btree ("session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workout_sessions_user_client_id_idx" ON "workout_sessions" USING btree ("user_id","client_id");
--> statement-breakpoint
-- Seed: mirrors DEFAULT_EXERCISES in @workspace/engine (lib/engine/src/gym.ts); guarded by a test.
INSERT INTO "exercises" ("id", "user_id", "name", "primary_body_part", "secondary_body_parts", "is_big5") VALUES
  ('ex_squat', NULL, 'Back Squat', 'quads', '["glutes","core"]'::jsonb, true),
  ('ex_bench', NULL, 'Bench Press', 'chest', '["triceps","shoulders"]'::jsonb, true),
  ('ex_deadlift', NULL, 'Deadlift', 'hamstrings', '["back","glutes"]'::jsonb, true),
  ('ex_ohp', NULL, 'Overhead Press', 'shoulders', '["triceps","core"]'::jsonb, true),
  ('ex_row', NULL, 'Barbell Row', 'back', '["biceps","core"]'::jsonb, true),
  ('ex_pullup', NULL, 'Pull-up', 'back', '["biceps"]'::jsonb, false),
  ('ex_lunge', NULL, 'Walking Lunge', 'quads', '["glutes"]'::jsonb, false),
  ('ex_plank', NULL, 'Plank', 'core', '[]'::jsonb, false);
