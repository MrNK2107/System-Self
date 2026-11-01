CREATE TABLE "vouch_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quest_id" uuid NOT NULL,
	"requester_id" uuid NOT NULL,
	"voucher_id" uuid NOT NULL,
	"note" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"responded_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "vouch_requests" ADD CONSTRAINT "vouch_requests_quest_id_quests_id_fk" FOREIGN KEY ("quest_id") REFERENCES "public"."quests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vouch_requests" ADD CONSTRAINT "vouch_requests_requester_id_users_id_fk" FOREIGN KEY ("requester_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vouch_requests" ADD CONSTRAINT "vouch_requests_voucher_id_users_id_fk" FOREIGN KEY ("voucher_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "vouch_requests_voucher_status_idx" ON "vouch_requests" USING btree ("voucher_id","status");--> statement-breakpoint
CREATE INDEX "vouch_requests_requester_idx" ON "vouch_requests" USING btree ("requester_id","created_at");