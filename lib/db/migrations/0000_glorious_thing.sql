CREATE TABLE "generated_quest_batches" (
	"id" serial PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"rank" text NOT NULL,
	"weakest_domain" text NOT NULL,
	"primary_goal" text NOT NULL,
	"day_number" integer NOT NULL,
	"shadow_gap" integer NOT NULL,
	"model" text NOT NULL,
	"prompt_version" text NOT NULL,
	"attempts" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "generated_quests" (
	"id" serial PRIMARY KEY NOT NULL,
	"batch_id" integer NOT NULL,
	"username" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"domain" text NOT NULL,
	"type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quest_completion_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"quest_id" text NOT NULL,
	"status" text NOT NULL,
	"domain" text NOT NULL,
	"quest_type" text NOT NULL,
	"idempotency_key" text,
	"completed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source" text DEFAULT 'app' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "system_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"message_type" text NOT NULL,
	"rank" text NOT NULL,
	"trajectory" text NOT NULL,
	"shadow_active" boolean NOT NULL,
	"shadow_gap" integer NOT NULL,
	"day_number" integer NOT NULL,
	"message" text NOT NULL,
	"model" text NOT NULL,
	"prompt_version" text NOT NULL,
	"attempts" integer NOT NULL,
	"context" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "generated_quests" ADD CONSTRAINT "generated_quests_batch_id_generated_quest_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."generated_quest_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "quest_completion_events_username_idempotency_key_unique" ON "quest_completion_events" USING btree ("username","idempotency_key");