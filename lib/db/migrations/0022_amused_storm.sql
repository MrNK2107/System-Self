CREATE TABLE "clan_raids" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"week_key" text NOT NULL,
	"type" text NOT NULL,
	"group_id" uuid NOT NULL,
	"clan_id" uuid NOT NULL,
	"metric_value" real DEFAULT 0 NOT NULL,
	"position" integer,
	"winner" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "clan_raids_type_valid" CHECK ("clan_raids"."type" in ('domain', 'discipline', 'body', 'score')),
	CONSTRAINT "clan_raids_week_key_valid" CHECK ("clan_raids"."week_key" ~ '^[0-9]{4}-W[0-9]{2}$')
);
--> statement-breakpoint
ALTER TABLE "clan_raids" ADD CONSTRAINT "clan_raids_clan_id_clans_id_fk" FOREIGN KEY ("clan_id") REFERENCES "public"."clans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "clan_raids_week_clan_uq" ON "clan_raids" USING btree ("week_key","clan_id");--> statement-breakpoint
CREATE INDEX "clan_raids_group_idx" ON "clan_raids" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "clan_raids_unresolved_idx" ON "clan_raids" USING btree ("week_key") WHERE "clan_raids"."resolved_at" is null;