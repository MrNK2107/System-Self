CREATE INDEX "exercises_user_idx" ON "exercises" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "workout_plans_user_idx" ON "workout_plans" USING btree ("user_id");