CREATE TABLE "clan_dispatches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clan_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clan_members" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"clan_id" uuid NOT NULL,
	"role" text NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"flagged_at" timestamp with time zone,
	CONSTRAINT "clan_members_role_valid" CHECK ("clan_members"."role" in ('leader', 'member'))
);
--> statement-breakpoint
CREATE TABLE "clans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"name_lower" text NOT NULL,
	"tag" text NOT NULL,
	"description" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'forming' NOT NULL,
	"clan_score" real DEFAULT 0 NOT NULL,
	"clan_rank" integer,
	"scored_on" date,
	"raid_wins" integer DEFAULT 0 NOT NULL,
	"raid_bonus_month" text,
	"raid_bonus" real DEFAULT 0 NOT NULL,
	"invite_code" text NOT NULL,
	CONSTRAINT "clans_status_valid" CHECK ("clans"."status" in ('forming', 'active')),
	CONSTRAINT "clans_description_len" CHECK ("clans"."description" is null or char_length("clans"."description") <= 200),
	CONSTRAINT "clans_tag_valid" CHECK ("clans"."tag" ~ '^[A-Z]{2,5}$')
);
--> statement-breakpoint
CREATE TABLE "job_runs" (
	"job" text PRIMARY KEY NOT NULL,
	"last_run_date" date NOT NULL
);
--> statement-breakpoint
ALTER TABLE "clan_dispatches" ADD CONSTRAINT "clan_dispatches_clan_id_clans_id_fk" FOREIGN KEY ("clan_id") REFERENCES "public"."clans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clan_members" ADD CONSTRAINT "clan_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clan_members" ADD CONSTRAINT "clan_members_clan_id_clans_id_fk" FOREIGN KEY ("clan_id") REFERENCES "public"."clans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clans" ADD CONSTRAINT "clans_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "clan_dispatches_clan_created_idx" ON "clan_dispatches" USING btree ("clan_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "clan_members_clan_idx" ON "clan_members" USING btree ("clan_id");--> statement-breakpoint
CREATE UNIQUE INDEX "clan_members_one_leader_uq" ON "clan_members" USING btree ("clan_id") WHERE "clan_members"."role" = 'leader';--> statement-breakpoint
CREATE UNIQUE INDEX "clans_name_lower_uq" ON "clans" USING btree ("name_lower");--> statement-breakpoint
CREATE UNIQUE INDEX "clans_invite_code_uq" ON "clans" USING btree ("invite_code");--> statement-breakpoint
CREATE INDEX "clans_rank_idx" ON "clans" USING btree ("clan_rank");