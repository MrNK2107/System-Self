ALTER TABLE "logs" ADD COLUMN "system" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "finance_weeks" ADD COLUMN "quoted_at" timestamp with time zone;--> statement-breakpoint
-- Recurring income auto-logs written before the column existed.
UPDATE "logs" SET "system" = true WHERE "client_id" LIKE 'recurring:%';