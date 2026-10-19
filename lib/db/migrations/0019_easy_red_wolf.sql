CREATE TABLE "entitlements" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"tier" text NOT NULL,
	"source" text NOT NULL,
	"expires_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entitlements_tier_valid" CHECK ("entitlements"."tier" in ('free', 'pro')),
	CONSTRAINT "entitlements_source_valid" CHECK ("entitlements"."source" in ('admin', 'revenuecat'))
);
--> statement-breakpoint
ALTER TABLE "rival_taunts" ADD COLUMN "is_ghost" boolean DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE "rival_taunts" t SET "is_ghost" = true FROM "rival_assignments" a WHERE a."id" = t."assignment_id" AND a."ghost_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;