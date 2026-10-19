CREATE TABLE "ghost_rivals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"codename" text NOT NULL,
	"rank" text NOT NULL,
	"scores" jsonb NOT NULL,
	"trajectory" text NOT NULL,
	"shadow_active" boolean DEFAULT false NOT NULL,
	"last_drift_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rival_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"slot" integer NOT NULL,
	"rival_user_id" uuid,
	"ghost_id" uuid,
	"codename" text NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "rival_assignments_slot_range" CHECK ("rival_assignments"."slot" between 1 and 3),
	CONSTRAINT "rival_assignments_one_rival" CHECK (("rival_assignments"."rival_user_id" is null) <> ("rival_assignments"."ghost_id" is null))
);
--> statement-breakpoint
CREATE TABLE "rival_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"assignment_id" uuid,
	"codename" text NOT NULL,
	"domain" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"user_start" real NOT NULL,
	"rival_start" real NOT NULL,
	"user_end" real,
	"rival_end" real,
	"outcome" text,
	"resolved_at" timestamp with time zone,
	"acknowledged_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rival_pressure" (
	"user_id" uuid NOT NULL,
	"assignment_id" uuid NOT NULL,
	"domain" text NOT NULL,
	"ahead" boolean NOT NULL,
	CONSTRAINT "rival_pressure_user_id_assignment_id_domain_pk" PRIMARY KEY("user_id","assignment_id","domain")
);
--> statement-breakpoint
CREATE TABLE "rival_taunts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"assignment_id" uuid,
	"codename" text NOT NULL,
	"message" text NOT NULL,
	"local_date" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "ghost_rivals" ADD CONSTRAINT "ghost_rivals_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rival_assignments" ADD CONSTRAINT "rival_assignments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rival_assignments" ADD CONSTRAINT "rival_assignments_rival_user_id_users_id_fk" FOREIGN KEY ("rival_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rival_assignments" ADD CONSTRAINT "rival_assignments_ghost_id_ghost_rivals_id_fk" FOREIGN KEY ("ghost_id") REFERENCES "public"."ghost_rivals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rival_challenges" ADD CONSTRAINT "rival_challenges_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rival_challenges" ADD CONSTRAINT "rival_challenges_assignment_id_rival_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."rival_assignments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rival_pressure" ADD CONSTRAINT "rival_pressure_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rival_pressure" ADD CONSTRAINT "rival_pressure_assignment_id_rival_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."rival_assignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rival_taunts" ADD CONSTRAINT "rival_taunts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rival_taunts" ADD CONSTRAINT "rival_taunts_assignment_id_rival_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."rival_assignments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ghost_rivals_owner_idx" ON "ghost_rivals" USING btree ("owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rival_assignments_user_slot_uq" ON "rival_assignments" USING btree ("user_id","slot");--> statement-breakpoint
CREATE INDEX "rival_assignments_rival_idx" ON "rival_assignments" USING btree ("rival_user_id");--> statement-breakpoint
CREATE INDEX "rival_assignments_expires_idx" ON "rival_assignments" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "rival_challenges_user_idx" ON "rival_challenges" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rival_challenges_open_uq" ON "rival_challenges" USING btree ("assignment_id") WHERE "rival_challenges"."outcome" is null;--> statement-breakpoint
CREATE INDEX "rival_taunts_user_idx" ON "rival_taunts" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "rival_taunts_daily_uq" ON "rival_taunts" USING btree ("user_id","assignment_id","local_date");--> statement-breakpoint
-- Before the one-open-report index: keep the oldest open report per (reporter, subject), resolve the rest.
UPDATE "user_reports" r SET "resolved_at" = now()
WHERE r."resolved_at" IS NULL AND EXISTS (
	SELECT 1 FROM "user_reports" o
	WHERE o."reporter_id" = r."reporter_id" AND o."subject_id" = r."subject_id" AND o."resolved_at" IS NULL
	AND (o."created_at", o."id") < (r."created_at", r."id")
);--> statement-breakpoint
CREATE UNIQUE INDEX "user_reports_open_uq" ON "user_reports" USING btree ("reporter_id","subject_id") WHERE "user_reports"."resolved_at" is null;