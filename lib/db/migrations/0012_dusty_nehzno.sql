CREATE TABLE "gym_crowd_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"session_id" uuid,
	"level" text NOT NULL,
	"weekday" integer NOT NULL,
	"hour" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "gym_crowd_reports" ADD CONSTRAINT "gym_crowd_reports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gym_crowd_reports" ADD CONSTRAINT "gym_crowd_reports_session_id_workout_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."workout_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "gym_crowd_reports_user_idx" ON "gym_crowd_reports" USING btree ("user_id");
--> statement-breakpoint
INSERT INTO "exercises" ("id", "user_id", "name", "primary_body_part", "secondary_body_parts", "is_big5") VALUES
  ('ex_db_press', NULL, 'Dumbbell Bench Press', 'chest', '["triceps","shoulders"]'::jsonb, false),
  ('ex_goblet_squat', NULL, 'Goblet Squat', 'quads', '["glutes","core"]'::jsonb, false),
  ('ex_lat_pulldown', NULL, 'Lat Pulldown', 'back', '["biceps"]'::jsonb, false),
  ('ex_leg_press', NULL, 'Leg Press', 'quads', '["glutes","hamstrings"]'::jsonb, false),
  ('ex_db_row', NULL, 'Dumbbell Row', 'back', '["biceps","core"]'::jsonb, false),
  ('ex_pushup', NULL, 'Push-up', 'chest', '["triceps","shoulders","core"]'::jsonb, false),
  ('ex_rdl_db', NULL, 'Dumbbell Romanian Deadlift', 'hamstrings', '["glutes","back"]'::jsonb, false),
  ('ex_db_shoulder_press', NULL, 'Dumbbell Shoulder Press', 'shoulders', '["triceps"]'::jsonb, false),
  ('ex_glute_bridge', NULL, 'Glute Bridge', 'glutes', '["hamstrings","core"]'::jsonb, false),
  ('ex_bodyweight_squat', NULL, 'Bodyweight Squat', 'quads', '["glutes"]'::jsonb, false),
  ('ex_inverted_row', NULL, 'Inverted Row', 'back', '["biceps","core"]'::jsonb, false),
  ('ex_dead_bug', NULL, 'Dead Bug', 'core', '[]'::jsonb, false);
