CREATE TYPE "public"."attendance_month_status" AS ENUM('open', 'closed');--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'attendance_month_closed' BEFORE 'csv_imported';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'attendance_month_reopened' BEFORE 'csv_imported';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'attendance_month_reclosed' BEFORE 'csv_imported';--> statement-breakpoint
CREATE TABLE "attendance_month_day_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"revision_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"attendance_day_id" uuid,
	"employee_id" uuid NOT NULL,
	"employee_number" text NOT NULL,
	"display_name" text NOT NULL,
	"department_code" text,
	"department_name" text,
	"work_date" date NOT NULL,
	"status" "attendance_day_status" NOT NULL,
	"scheduled_minutes" integer DEFAULT 0 NOT NULL,
	"worked_minutes" integer,
	"break_minutes" integer,
	"overtime_minutes" integer,
	"work_rule_id" uuid,
	"work_rule_name" text,
	"is_corrected" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attendance_month_periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"target_month" text NOT NULL,
	"status" "attendance_month_status" DEFAULT 'open' NOT NULL,
	"current_revision" integer,
	"next_revision" integer DEFAULT 1 NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attendance_month_periods_month_format" CHECK ("attendance_month_periods"."target_month" ~ '^\d{4}-\d{2}$'),
	CONSTRAINT "attendance_month_periods_next_revision_positive" CHECK ("attendance_month_periods"."next_revision" > 0),
	CONSTRAINT "attendance_month_periods_version_nonnegative" CHECK ("attendance_month_periods"."version" >= 0)
);
--> statement-breakpoint
CREATE TABLE "attendance_month_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"period_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"target_month" text NOT NULL,
	"revision" integer NOT NULL,
	"closed_by_user_id" uuid NOT NULL,
	"closed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reopened_by_user_id" uuid,
	"reopened_at" timestamp with time zone,
	"reopen_reason" text,
	"employee_count" integer DEFAULT 0 NOT NULL,
	"day_count" integer DEFAULT 0 NOT NULL,
	"scheduled_minutes" integer DEFAULT 0 NOT NULL,
	"worked_minutes" integer DEFAULT 0 NOT NULL,
	"overtime_minutes" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "attendance_month_revisions_revision_positive" CHECK ("attendance_month_revisions"."revision" > 0),
	CONSTRAINT "attendance_month_revisions_reopen_complete" CHECK (("attendance_month_revisions"."reopened_at" IS NULL AND "attendance_month_revisions"."reopened_by_user_id" IS NULL AND "attendance_month_revisions"."reopen_reason" IS NULL) OR ("attendance_month_revisions"."reopened_at" IS NOT NULL AND "attendance_month_revisions"."reopened_by_user_id" IS NOT NULL AND length(trim("attendance_month_revisions"."reopen_reason")) > 0))
);
--> statement-breakpoint
ALTER TABLE "attendance_month_day_snapshots" ADD CONSTRAINT "attendance_month_day_snapshots_revision_id_attendance_month_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."attendance_month_revisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_month_day_snapshots" ADD CONSTRAINT "attendance_month_day_snapshots_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_month_day_snapshots" ADD CONSTRAINT "attendance_month_day_snapshots_attendance_day_id_attendance_days_id_fk" FOREIGN KEY ("attendance_day_id") REFERENCES "public"."attendance_days"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_month_day_snapshots" ADD CONSTRAINT "attendance_month_day_snapshots_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_month_day_snapshots" ADD CONSTRAINT "attendance_month_day_snapshots_work_rule_id_work_rules_id_fk" FOREIGN KEY ("work_rule_id") REFERENCES "public"."work_rules"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_month_periods" ADD CONSTRAINT "attendance_month_periods_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_month_revisions" ADD CONSTRAINT "attendance_month_revisions_period_id_attendance_month_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."attendance_month_periods"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_month_revisions" ADD CONSTRAINT "attendance_month_revisions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_month_revisions" ADD CONSTRAINT "attendance_month_revisions_closed_by_user_id_users_id_fk" FOREIGN KEY ("closed_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_month_revisions" ADD CONSTRAINT "attendance_month_revisions_reopened_by_user_id_users_id_fk" FOREIGN KEY ("reopened_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_month_snapshots_revision_employee_date_unique" ON "attendance_month_day_snapshots" USING btree ("revision_id","employee_id","work_date");--> statement-breakpoint
CREATE INDEX "attendance_month_snapshots_org_date_index" ON "attendance_month_day_snapshots" USING btree ("organization_id","work_date");--> statement-breakpoint
CREATE INDEX "attendance_month_snapshots_revision_employee_index" ON "attendance_month_day_snapshots" USING btree ("revision_id","employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_month_periods_org_month_unique" ON "attendance_month_periods" USING btree ("organization_id","target_month");--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_month_revisions_period_revision_unique" ON "attendance_month_revisions" USING btree ("period_id","revision");--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_month_revisions_one_active_unique" ON "attendance_month_revisions" USING btree ("period_id") WHERE "attendance_month_revisions"."reopened_at" IS NULL;--> statement-breakpoint
CREATE INDEX "attendance_month_revisions_org_month_index" ON "attendance_month_revisions" USING btree ("organization_id","target_month","revision");