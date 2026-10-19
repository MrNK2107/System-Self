CREATE TABLE "custom_domains" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"unit" text DEFAULT '' NOT NULL,
	"log_label" text DEFAULT 'Log' NOT NULL,
	"baseline" real NOT NULL,
	"target" real NOT NULL,
	"is_public" boolean DEFAULT false NOT NULL,
	"score" real DEFAULT 50 NOT NULL,
	"streak" integer DEFAULT 0 NOT NULL,
	"last_log_date" date,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "custom_domains_score_range" CHECK ("custom_domains"."score" between 0 and 100),
	CONSTRAINT "custom_domains_name_length" CHECK (char_length("custom_domains"."name") between 1 and 24)
);
--> statement-breakpoint
CREATE TABLE "custom_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"custom_domain_id" uuid NOT NULL,
	"client_id" text NOT NULL,
	"value" real NOT NULL,
	"note" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"local_date" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "custom_domains" ADD CONSTRAINT "custom_domains_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_logs" ADD CONSTRAINT "custom_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_logs" ADD CONSTRAINT "custom_logs_custom_domain_id_custom_domains_id_fk" FOREIGN KEY ("custom_domain_id") REFERENCES "public"."custom_domains"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "custom_domains_user_idx" ON "custom_domains" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "custom_domains_user_name_active_idx" ON "custom_domains" USING btree ("user_id",lower("name")) WHERE "custom_domains"."archived_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "custom_logs_user_client_idx" ON "custom_logs" USING btree ("user_id","client_id");--> statement-breakpoint
CREATE INDEX "custom_logs_domain_occurred_idx" ON "custom_logs" USING btree ("custom_domain_id","occurred_at");