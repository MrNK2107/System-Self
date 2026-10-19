ALTER TABLE "clans" ALTER COLUMN "clan_score" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "clans" ALTER COLUMN "clan_score" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "clans" ADD COLUMN "active_member_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE "clans" SET "clan_score" = NULL WHERE "scored_on" IS NULL;