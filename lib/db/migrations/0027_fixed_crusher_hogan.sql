CREATE TABLE "budgets" (
	"user_id" uuid NOT NULL,
	"category" text NOT NULL,
	"monthly_limit" double precision NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budgets_user_id_category_pk" PRIMARY KEY("user_id","category"),
	CONSTRAINT "budgets_limit_positive" CHECK ("budgets"."monthly_limit" > 0)
);
--> statement-breakpoint
CREATE TABLE "finance_weeks" (
	"user_id" uuid NOT NULL,
	"week_key" text NOT NULL,
	"evaluated_on" date NOT NULL,
	"income" double precision DEFAULT 0 NOT NULL,
	"expenses" double precision DEFAULT 0 NOT NULL,
	"savings_rate" real DEFAULT 0 NOT NULL,
	"discretionary" double precision DEFAULT 0 NOT NULL,
	"discretionary_budget" double precision,
	"delta" real DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "finance_weeks_user_id_week_key_pk" PRIMARY KEY("user_id","week_key")
);
--> statement-breakpoint
CREATE TABLE "financial_goals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"target_amount" double precision NOT NULL,
	"saved_amount" double precision DEFAULT 0 NOT NULL,
	"deadline" date,
	"status" text DEFAULT 'active' NOT NULL,
	"achieved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "financial_goals_status_valid" CHECK ("financial_goals"."status" in ('active', 'achieved', 'abandoned')),
	CONSTRAINT "financial_goals_title_length" CHECK (char_length("financial_goals"."title") between 1 and 80),
	CONSTRAINT "financial_goals_target_positive" CHECK ("financial_goals"."target_amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "net_worth_snapshots" (
	"user_id" uuid NOT NULL,
	"month" text NOT NULL,
	"amount" double precision NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "net_worth_snapshots_user_id_month_pk" PRIMARY KEY("user_id","month"),
	CONSTRAINT "net_worth_month_format" CHECK ("net_worth_snapshots"."month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
);
--> statement-breakpoint
CREATE TABLE "recurring_income" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"label" text NOT NULL,
	"amount" double precision NOT NULL,
	"day_of_month" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recurring_income_day_valid" CHECK ("recurring_income"."day_of_month" between 1 and 28),
	CONSTRAINT "recurring_income_amount_positive" CHECK ("recurring_income"."amount" > 0)
);
--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "currency" text DEFAULT 'INR' NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "savings_target" real DEFAULT 0.2 NOT NULL;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_weeks" ADD CONSTRAINT "finance_weeks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_goals" ADD CONSTRAINT "financial_goals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "net_worth_snapshots" ADD CONSTRAINT "net_worth_snapshots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_income" ADD CONSTRAINT "recurring_income_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "financial_goals_user_idx" ON "financial_goals" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "recurring_income_user_idx" ON "recurring_income" USING btree ("user_id");