ALTER TABLE "profiles" ADD COLUMN "baseline_scores" jsonb;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "baseline_date" date;--> statement-breakpoint
UPDATE "profiles" AS p SET "baseline_scores" = s."scores", "baseline_date" = s."local_date" FROM (SELECT DISTINCT ON ("user_id") "user_id", "scores", "local_date" FROM "daily_snapshots" ORDER BY "user_id", "local_date" ASC) AS s WHERE s."user_id" = p."user_id" AND p."baseline_scores" IS NULL;
