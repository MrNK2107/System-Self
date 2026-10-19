CREATE TABLE "blocks" (
	"blocker_id" uuid NOT NULL,
	"blocked_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "blocks_blocker_id_blocked_id_pk" PRIMARY KEY("blocker_id","blocked_id"),
	CONSTRAINT "blocks_not_self" CHECK ("blocks"."blocker_id" <> "blocks"."blocked_id")
);
--> statement-breakpoint
CREATE TABLE "follows" (
	"follower_id" uuid NOT NULL,
	"followee_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "follows_follower_id_followee_id_pk" PRIMARY KEY("follower_id","followee_id"),
	CONSTRAINT "follows_not_self" CHECK ("follows"."follower_id" <> "follows"."followee_id")
);
--> statement-breakpoint
CREATE TABLE "user_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reporter_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "user_reports_reason_len" CHECK (char_length("user_reports"."reason") between 1 and 500)
);
--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "public_codename" text;--> statement-breakpoint
-- Backfill (deterministic, unique by construction): profiles ordered by (onboarded_at, user_id) take the nth (word, number) pair,
-- word = ((n-1) mod 118)th word of the engine CODENAME_WORDS list, number = ((n-1) div 118)+1 (1..9 for the first 1062 profiles,
-- then it keeps counting so uniqueness never depends on luck). New profiles draw random codenames with unique-retry (engine codenames.ts).
UPDATE "profiles" AS p SET "public_codename" = c."codename" FROM (SELECT "user_id", 'USER // ' || (ARRAY['ANCHOR','ARROW','ASH','ATLAS','AXIS','BEACON','BLADE','BOLT','BRAVE','BRIAR','CAIRN','CEDAR','CINDER','CLIFF','COMET','CORAL','CRAG','CREST','DAWN','DRIFT','DUNE','DUSK','EBB','EMBER','FALCON','FERN','FINCH','FJORD','FLARE','FLINT','FORGE','FROST','GALE','GLACIER','GRANITE','GROVE','HARBOR','HAWK','HELM','HERON','HOLLOW','IRON','IVY','JADE','JUNIPER','KESTREL','KINDLE','LANTERN','LARK','LEDGE','LUMEN','LYNX','MARSH','MERIDIAN','MESA','MIST','MOSS','NEBULA','NOMAD','NORTH','OAK','ONYX','ORBIT','OTTER','OWL','PEAK','PEBBLE','PIKE','PINE','PIVOT','PRISM','QUARRY','QUARTZ','QUILL','RAVEN','REEF','RIDGE','RIVER','ROOK','RUNE','SABLE','SAGE','SCOUT','SEDGE','SHALE','SIGNAL','SLATE','SPARK','SPIRE','SPRUCE','STEEL','STONE','STORM','SUMMIT','SWIFT','TALON','TEMPEST','THISTLE','THORN','TIDE','TIMBER','TORCH','TRAIL','TUNDRA','VALE','VANGUARD','VAULT','VERGE','VIPER','VISTA','WARDEN','WILLOW','WIND','WOLF','WREN','YARROW','ZENITH','ZEPHYR'])[((rn - 1) % 118) + 1] || '-' || (((rn - 1) / 118) + 1)::text AS "codename" FROM (SELECT "user_id", row_number() OVER (ORDER BY "onboarded_at", "user_id") AS rn FROM "profiles") AS r) AS c WHERE c."user_id" = p."user_id";--> statement-breakpoint
ALTER TABLE "profiles" ALTER COLUMN "public_codename" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_blocker_id_users_id_fk" FOREIGN KEY ("blocker_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_blocked_id_users_id_fk" FOREIGN KEY ("blocked_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follows" ADD CONSTRAINT "follows_follower_id_users_id_fk" FOREIGN KEY ("follower_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follows" ADD CONSTRAINT "follows_followee_id_users_id_fk" FOREIGN KEY ("followee_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_reports" ADD CONSTRAINT "user_reports_reporter_id_users_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_reports" ADD CONSTRAINT "user_reports_subject_id_users_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "blocks_blocked_idx" ON "blocks" USING btree ("blocked_id");--> statement-breakpoint
CREATE INDEX "follows_followee_idx" ON "follows" USING btree ("followee_id");--> statement-breakpoint
CREATE INDEX "user_reports_subject_idx" ON "user_reports" USING btree ("subject_id");--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_public_codename_unique" UNIQUE("public_codename");