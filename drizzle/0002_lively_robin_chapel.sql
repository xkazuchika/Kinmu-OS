CREATE TYPE "public"."attendance_day_status" AS ENUM('open', 'complete');--> statement-breakpoint
CREATE TYPE "public"."attendance_event_type" AS ENUM('clock_in', 'clock_out', 'break_start', 'break_end');--> statement-breakpoint
CREATE TABLE "attendance_days" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"work_rule_id" uuid,
	"work_date" date NOT NULL,
	"scheduled_minutes" integer DEFAULT 0 NOT NULL,
	"status" "attendance_day_status" DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attendance_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"attendance_day_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"type" "attendance_event_type" NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"source" text DEFAULT 'web' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daily_attendance_summaries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"attendance_day_id" uuid NOT NULL,
	"scheduled_minutes" integer DEFAULT 0 NOT NULL,
	"worked_minutes" integer DEFAULT 0 NOT NULL,
	"break_minutes" integer DEFAULT 0 NOT NULL,
	"overtime_minutes" integer DEFAULT 0 NOT NULL,
	"status" "attendance_day_status" DEFAULT 'open' NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"employee_id" uuid,
	"name" text NOT NULL,
	"effective_from" date NOT NULL,
	"scheduled_start_time" text NOT NULL,
	"scheduled_end_time" text NOT NULL,
	"scheduled_break_minutes" integer DEFAULT 60 NOT NULL,
	"daily_standard_minutes" integer DEFAULT 480 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "attendance_days" ADD CONSTRAINT "attendance_days_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_days" ADD CONSTRAINT "attendance_days_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_days" ADD CONSTRAINT "attendance_days_work_rule_id_work_rules_id_fk" FOREIGN KEY ("work_rule_id") REFERENCES "public"."work_rules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_events" ADD CONSTRAINT "attendance_events_attendance_day_id_attendance_days_id_fk" FOREIGN KEY ("attendance_day_id") REFERENCES "public"."attendance_days"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_events" ADD CONSTRAINT "attendance_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_events" ADD CONSTRAINT "attendance_events_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_attendance_summaries" ADD CONSTRAINT "daily_attendance_summaries_attendance_day_id_attendance_days_id_fk" FOREIGN KEY ("attendance_day_id") REFERENCES "public"."attendance_days"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_rules" ADD CONSTRAINT "work_rules_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_rules" ADD CONSTRAINT "work_rules_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_days_employee_date_unique" ON "attendance_days" USING btree ("employee_id","work_date");--> statement-breakpoint
CREATE INDEX "attendance_days_organization_date_index" ON "attendance_days" USING btree ("organization_id","work_date");--> statement-breakpoint
CREATE INDEX "attendance_events_day_time_index" ON "attendance_events" USING btree ("attendance_day_id","occurred_at");--> statement-breakpoint
CREATE INDEX "attendance_events_employee_time_index" ON "attendance_events" USING btree ("employee_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "daily_attendance_summaries_day_unique" ON "daily_attendance_summaries" USING btree ("attendance_day_id");--> statement-breakpoint
CREATE INDEX "work_rules_organization_effective_index" ON "work_rules" USING btree ("organization_id","effective_from");--> statement-breakpoint
CREATE INDEX "work_rules_employee_effective_index" ON "work_rules" USING btree ("employee_id","effective_from");