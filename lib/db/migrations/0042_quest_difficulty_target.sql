ALTER TABLE "quests" ADD COLUMN "difficulty" text DEFAULT 'normal' NOT NULL;--> statement-breakpoint
ALTER TABLE "quests" ADD COLUMN "target" jsonb;