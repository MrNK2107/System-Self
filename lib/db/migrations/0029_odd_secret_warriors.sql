CREATE TABLE "peer_rating_weeks" (
	"user_id" uuid NOT NULL,
	"week_key" text NOT NULL,
	"evaluated_on" date NOT NULL,
	"rating_count" integer NOT NULL,
	"average" real NOT NULL,
	"delta" real DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "peer_rating_weeks_user_id_week_key_pk" PRIMARY KEY("user_id","week_key")
);
--> statement-breakpoint
CREATE TABLE "peer_ratings" (
	"rater_id" uuid NOT NULL,
	"ratee_id" uuid NOT NULL,
	"week_key" text NOT NULL,
	"rating" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "peer_ratings_rater_id_ratee_id_week_key_pk" PRIMARY KEY("rater_id","ratee_id","week_key"),
	CONSTRAINT "peer_ratings_rating_range" CHECK ("peer_ratings"."rating" between 1 and 5),
	CONSTRAINT "peer_ratings_no_self" CHECK ("peer_ratings"."rater_id" <> "peer_ratings"."ratee_id"),
	CONSTRAINT "peer_ratings_week_key_valid" CHECK ("peer_ratings"."week_key" ~ '^[0-9]{4}-W[0-9]{2}$')
);
--> statement-breakpoint
ALTER TABLE "peer_rating_weeks" ADD CONSTRAINT "peer_rating_weeks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "peer_ratings" ADD CONSTRAINT "peer_ratings_rater_id_users_id_fk" FOREIGN KEY ("rater_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "peer_ratings" ADD CONSTRAINT "peer_ratings_ratee_id_users_id_fk" FOREIGN KEY ("ratee_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "peer_ratings_ratee_week_idx" ON "peer_ratings" USING btree ("ratee_id","week_key");