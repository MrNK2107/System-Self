-- Legacy rows are keyed by username and cannot be attributed to a user; no production data exists.
DELETE FROM "generated_quests";--> statement-breakpoint
DELETE FROM "generated_quest_batches";--> statement-breakpoint
DELETE FROM "quest_completion_events";--> statement-breakpoint
DELETE FROM "system_messages";--> statement-breakpoint
DROP INDEX "quest_completion_events_username_idempotency_key_unique";--> statement-breakpoint
ALTER TABLE "generated_quest_batches" ADD COLUMN "user_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "generated_quests" ADD COLUMN "user_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "quest_completion_events" ADD COLUMN "user_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "system_messages" ADD COLUMN "user_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "generated_quest_batches" ADD CONSTRAINT "generated_quest_batches_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generated_quests" ADD CONSTRAINT "generated_quests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quest_completion_events" ADD CONSTRAINT "quest_completion_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "system_messages" ADD CONSTRAINT "system_messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "generated_quest_batches_user_created_idx" ON "generated_quest_batches" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "generated_quests_user_created_domain_idx" ON "generated_quests" USING btree ("user_id","created_at","domain");--> statement-breakpoint
CREATE UNIQUE INDEX "quest_completion_events_user_idempotency_key_unique" ON "quest_completion_events" USING btree ("user_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "quest_completion_events_user_completed_status_domain_idx" ON "quest_completion_events" USING btree ("user_id","completed_at","status","domain");--> statement-breakpoint
CREATE INDEX "system_messages_user_created_idx" ON "system_messages" USING btree ("user_id","created_at");--> statement-breakpoint
ALTER TABLE "generated_quest_batches" DROP COLUMN "username";--> statement-breakpoint
ALTER TABLE "generated_quests" DROP COLUMN "username";--> statement-breakpoint
ALTER TABLE "quest_completion_events" DROP COLUMN "username";--> statement-breakpoint
ALTER TABLE "system_messages" DROP COLUMN "username";