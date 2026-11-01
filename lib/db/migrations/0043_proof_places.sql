CREATE TABLE "place_tiles" (
	"tile_key" text PRIMARY KEY NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "places" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"kind" text NOT NULL,
	"name" text,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"radius_m" integer NOT NULL,
	"user_id" uuid,
	"osm_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quest_proofs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quest_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"method" text NOT NULL,
	"status" text NOT NULL,
	"summary" jsonb NOT NULL,
	"reason" text NOT NULL,
	"evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"client_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session_spots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "places" ADD CONSTRAINT "places_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quest_proofs" ADD CONSTRAINT "quest_proofs_quest_id_quests_id_fk" FOREIGN KEY ("quest_id") REFERENCES "public"."quests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quest_proofs" ADD CONSTRAINT "quest_proofs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_spots" ADD CONSTRAINT "session_spots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "places_lat_lng_idx" ON "places" USING btree ("lat","lng");--> statement-breakpoint
CREATE INDEX "places_user_idx" ON "places" USING btree ("user_id") WHERE "places"."user_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "places_osm_id_idx" ON "places" USING btree ("osm_id") WHERE "places"."osm_id" is not null;--> statement-breakpoint
CREATE INDEX "quest_proofs_quest_idx" ON "quest_proofs" USING btree ("quest_id");--> statement-breakpoint
CREATE INDEX "quest_proofs_user_created_idx" ON "quest_proofs" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "quest_proofs_user_client_idx" ON "quest_proofs" USING btree ("user_id","client_id") WHERE "quest_proofs"."client_id" is not null;--> statement-breakpoint
CREATE INDEX "session_spots_lat_lng_idx" ON "session_spots" USING btree ("lat","lng");--> statement-breakpoint
CREATE INDEX "session_spots_created_idx" ON "session_spots" USING btree ("created_at");