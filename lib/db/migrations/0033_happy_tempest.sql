CREATE TABLE "billing_events" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "entitlements" ADD COLUMN "product_id" text;--> statement-breakpoint
ALTER TABLE "entitlements" ADD COLUMN "period_type" text;--> statement-breakpoint
ALTER TABLE "entitlements" ADD COLUMN "latest_event_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "billing_events" ADD CONSTRAINT "billing_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;