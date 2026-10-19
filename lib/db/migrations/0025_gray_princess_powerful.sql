CREATE TABLE "duo_checkins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"duo_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "duo_checkins_kind_valid" CHECK ("duo_checkins"."kind" in ('going_now', 'checked_in', 'done'))
);
--> statement-breakpoint
CREATE TABLE "duo_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"from_id" uuid NOT NULL,
	"to_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	CONSTRAINT "duo_invites_status_valid" CHECK ("duo_invites"."status" in ('pending', 'accepted', 'declined', 'cancelled')),
	CONSTRAINT "duo_invites_distinct" CHECK ("duo_invites"."from_id" <> "duo_invites"."to_id")
);
--> statement-breakpoint
CREATE TABLE "duo_members" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"duo_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "duos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_a" uuid NOT NULL,
	"user_b" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "duos_distinct" CHECK ("duos"."user_a" <> "duos"."user_b")
);
--> statement-breakpoint
ALTER TABLE "duo_checkins" ADD CONSTRAINT "duo_checkins_duo_id_duos_id_fk" FOREIGN KEY ("duo_id") REFERENCES "public"."duos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duo_checkins" ADD CONSTRAINT "duo_checkins_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duo_invites" ADD CONSTRAINT "duo_invites_from_id_users_id_fk" FOREIGN KEY ("from_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duo_invites" ADD CONSTRAINT "duo_invites_to_id_users_id_fk" FOREIGN KEY ("to_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duo_members" ADD CONSTRAINT "duo_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duo_members" ADD CONSTRAINT "duo_members_duo_id_duos_id_fk" FOREIGN KEY ("duo_id") REFERENCES "public"."duos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duos" ADD CONSTRAINT "duos_user_a_users_id_fk" FOREIGN KEY ("user_a") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duos" ADD CONSTRAINT "duos_user_b_users_id_fk" FOREIGN KEY ("user_b") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "duo_checkins_duo_created_idx" ON "duo_checkins" USING btree ("duo_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "duo_checkins_user_created_idx" ON "duo_checkins" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "duo_invites_to_idx" ON "duo_invites" USING btree ("to_id","status");--> statement-breakpoint
CREATE INDEX "duo_invites_from_idx" ON "duo_invites" USING btree ("from_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "duo_invites_pending_uq" ON "duo_invites" USING btree ("from_id","to_id") WHERE "duo_invites"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "duo_members_duo_idx" ON "duo_members" USING btree ("duo_id");