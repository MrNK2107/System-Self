ALTER TABLE "generated_quest_batches" ADD COLUMN "local_date" date;--> statement-breakpoint
ALTER TABLE "system_messages" ADD COLUMN "local_date" date;--> statement-breakpoint
CREATE INDEX "generated_quest_batches_user_local_date_idx" ON "generated_quest_batches" USING btree ("user_id","local_date");--> statement-breakpoint
CREATE INDEX "system_messages_user_local_date_idx" ON "system_messages" USING btree ("user_id","local_date");