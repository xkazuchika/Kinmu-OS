CREATE TYPE "public"."attendance_operational_status" AS ENUM('non_workday', 'worked', 'open_punch', 'leave_full', 'leave_half_worked', 'unresolved', 'absence', 'conflict');--> statement-breakpoint
CREATE TYPE "public"."leave_request_status" AS ENUM('pending', 'approved', 'rejected', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."leave_transaction_kind" AS ENUM('grant', 'adjustment', 'consumption', 'reversal', 'expiry');--> statement-breakpoint
CREATE TYPE "public"."work_calendar_day_kind" AS ENUM('workday', 'non_workday');--> statement-breakpoint
CREATE TYPE "public"."work_calendar_status" AS ENUM('draft', 'active');--> statement-breakpoint
CREATE TABLE "absence_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"work_date" date NOT NULL,
	"reason" text NOT NULL,
	"confirmed_by_user_id" uuid NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by_user_id" uuid,
	"revoke_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "absence_records_reason_not_blank" CHECK (length(trim("absence_records"."reason")) > 0),
	CONSTRAINT "absence_records_version_nonnegative" CHECK ("absence_records"."version" >= 0),
	CONSTRAINT "absence_records_revoke_complete" CHECK (("absence_records"."revoked_at" IS NULL AND "absence_records"."revoked_by_user_id" IS NULL AND "absence_records"."revoke_reason" IS NULL) OR ("absence_records"."revoked_at" IS NOT NULL AND "absence_records"."revoked_by_user_id" IS NOT NULL AND length(trim("absence_records"."revoke_reason")) > 0))
);
--> statement-breakpoint
CREATE TABLE "import_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"fingerprint" text NOT NULL,
	"file_name" text,
	"row_count" integer NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "import_batches_kind_valid" CHECK ("import_batches"."kind" IN ('calendar', 'leave_grant')),
	CONSTRAINT "import_batches_row_count_nonnegative" CHECK ("import_batches"."row_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "leave_balance_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"leave_type_id" uuid NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leave_balance_accounts_version_nonnegative" CHECK ("leave_balance_accounts"."version" >= 0)
);
--> statement-breakpoint
CREATE TABLE "leave_grant_lots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"leave_type_id" uuid NOT NULL,
	"granted_units" integer NOT NULL,
	"granted_on" date NOT NULL,
	"expires_on" date,
	"reason" text NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leave_grant_lots_units_positive" CHECK ("leave_grant_lots"."granted_units" > 0),
	CONSTRAINT "leave_grant_lots_reason_not_blank" CHECK (length(trim("leave_grant_lots"."reason")) > 0),
	CONSTRAINT "leave_grant_lots_expiry_valid" CHECK ("leave_grant_lots"."expires_on" IS NULL OR "leave_grant_lots"."expires_on" >= "leave_grant_lots"."granted_on")
);
--> statement-breakpoint
CREATE TABLE "leave_request_days" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"work_date" date NOT NULL,
	"units" integer NOT NULL,
	"scheduled_minutes" integer DEFAULT 0 NOT NULL,
	"calendar_source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leave_request_days_units_valid" CHECK ("leave_request_days"."units" IN (1, 2)),
	CONSTRAINT "leave_request_days_scheduled_minutes_nonnegative" CHECK ("leave_request_days"."scheduled_minutes" >= 0)
);
--> statement-breakpoint
CREATE TABLE "leave_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"leave_type_id" uuid NOT NULL,
	"requested_by_user_id" uuid NOT NULL,
	"reviewer_user_id" uuid,
	"status" "leave_request_status" DEFAULT 'pending' NOT NULL,
	"reason" text NOT NULL,
	"review_comment" text,
	"base_balance_version" integer DEFAULT 0 NOT NULL,
	"leave_type_code" text NOT NULL,
	"leave_type_name" text NOT NULL,
	"paid" boolean NOT NULL,
	"consumes_balance" boolean NOT NULL,
	"reviewed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leave_requests_reason_not_blank" CHECK (length(trim("leave_requests"."reason")) > 0),
	CONSTRAINT "leave_requests_base_balance_version_nonnegative" CHECK ("leave_requests"."base_balance_version" >= 0)
);
--> statement-breakpoint
CREATE TABLE "leave_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"leave_type_id" uuid NOT NULL,
	"grant_lot_id" uuid,
	"request_id" uuid,
	"original_transaction_id" uuid,
	"kind" "leave_transaction_kind" NOT NULL,
	"units" integer NOT NULL,
	"effective_on" date NOT NULL,
	"reason" text NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leave_transactions_units_nonzero" CHECK ("leave_transactions"."units" <> 0),
	CONSTRAINT "leave_transactions_reason_not_blank" CHECK (length(trim("leave_transactions"."reason")) > 0),
	CONSTRAINT "leave_transactions_kind_sign_valid" CHECK (("leave_transactions"."kind" = 'grant' AND "leave_transactions"."units" > 0) OR ("leave_transactions"."kind" = 'consumption' AND "leave_transactions"."units" < 0) OR ("leave_transactions"."kind" = 'expiry' AND "leave_transactions"."units" < 0) OR ("leave_transactions"."kind" IN ('adjustment', 'reversal')))
);
--> statement-breakpoint
CREATE TABLE "leave_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"paid" boolean DEFAULT false NOT NULL,
	"consumes_balance" boolean DEFAULT false NOT NULL,
	"requestable" boolean DEFAULT true NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leave_types_code_not_blank" CHECK (length(trim("leave_types"."code")) > 0),
	CONSTRAINT "leave_types_name_not_blank" CHECK (length(trim("leave_types"."name")) > 0),
	CONSTRAINT "leave_types_effective_range_valid" CHECK ("leave_types"."effective_to" IS NULL OR "leave_types"."effective_to" >= "leave_types"."effective_from")
);
--> statement-breakpoint
CREATE TABLE "work_calendar_date_exceptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"employee_id" uuid,
	"calendar_date" date NOT NULL,
	"day_kind" "work_calendar_day_kind" NOT NULL,
	"name" text NOT NULL,
	"reason" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_calendar_exceptions_name_not_blank" CHECK (length(trim("work_calendar_date_exceptions"."name")) > 0),
	CONSTRAINT "work_calendar_exceptions_reason_not_blank" CHECK (length(trim("work_calendar_date_exceptions"."reason")) > 0)
);
--> statement-breakpoint
CREATE TABLE "work_calendar_patterns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"effective_from" date NOT NULL,
	"status" "work_calendar_status" DEFAULT 'draft' NOT NULL,
	"monday_workday" boolean DEFAULT true NOT NULL,
	"tuesday_workday" boolean DEFAULT true NOT NULL,
	"wednesday_workday" boolean DEFAULT true NOT NULL,
	"thursday_workday" boolean DEFAULT true NOT NULL,
	"friday_workday" boolean DEFAULT true NOT NULL,
	"saturday_workday" boolean DEFAULT false NOT NULL,
	"sunday_workday" boolean DEFAULT false NOT NULL,
	"created_by_user_id" uuid,
	"activated_by_user_id" uuid,
	"activated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_calendar_patterns_activation_complete" CHECK (("work_calendar_patterns"."status" = 'draft' AND "work_calendar_patterns"."activated_at" IS NULL AND "work_calendar_patterns"."activated_by_user_id" IS NULL) OR ("work_calendar_patterns"."status" = 'active' AND "work_calendar_patterns"."activated_at" IS NOT NULL AND "work_calendar_patterns"."activated_by_user_id" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "attendance_month_day_snapshots" ADD COLUMN "operational_status" "attendance_operational_status";--> statement-breakpoint
ALTER TABLE "attendance_month_day_snapshots" ADD COLUMN "calendar_source" text;--> statement-breakpoint
ALTER TABLE "attendance_month_day_snapshots" ADD COLUMN "calendar_label" text;--> statement-breakpoint
ALTER TABLE "attendance_month_day_snapshots" ADD COLUMN "leave_type_code" text;--> statement-breakpoint
ALTER TABLE "attendance_month_day_snapshots" ADD COLUMN "leave_type_name" text;--> statement-breakpoint
ALTER TABLE "attendance_month_day_snapshots" ADD COLUMN "leave_units" integer;--> statement-breakpoint
ALTER TABLE "attendance_month_day_snapshots" ADD COLUMN "leave_scheduled_minutes" integer;--> statement-breakpoint
ALTER TABLE "attendance_month_day_snapshots" ADD COLUMN "absence_reason" text;--> statement-breakpoint
ALTER TABLE "absence_records" ADD CONSTRAINT "absence_records_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "absence_records" ADD CONSTRAINT "absence_records_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "absence_records" ADD CONSTRAINT "absence_records_confirmed_by_user_id_users_id_fk" FOREIGN KEY ("confirmed_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "absence_records" ADD CONSTRAINT "absence_records_revoked_by_user_id_users_id_fk" FOREIGN KEY ("revoked_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_balance_accounts" ADD CONSTRAINT "leave_balance_accounts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_balance_accounts" ADD CONSTRAINT "leave_balance_accounts_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_balance_accounts" ADD CONSTRAINT "leave_balance_accounts_leave_type_id_leave_types_id_fk" FOREIGN KEY ("leave_type_id") REFERENCES "public"."leave_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_grant_lots" ADD CONSTRAINT "leave_grant_lots_account_id_leave_balance_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."leave_balance_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_grant_lots" ADD CONSTRAINT "leave_grant_lots_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_grant_lots" ADD CONSTRAINT "leave_grant_lots_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_grant_lots" ADD CONSTRAINT "leave_grant_lots_leave_type_id_leave_types_id_fk" FOREIGN KEY ("leave_type_id") REFERENCES "public"."leave_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_grant_lots" ADD CONSTRAINT "leave_grant_lots_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_request_days" ADD CONSTRAINT "leave_request_days_request_id_leave_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."leave_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_leave_type_id_leave_types_id_fk" FOREIGN KEY ("leave_type_id") REFERENCES "public"."leave_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_reviewer_user_id_users_id_fk" FOREIGN KEY ("reviewer_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_transactions" ADD CONSTRAINT "leave_transactions_account_id_leave_balance_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."leave_balance_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_transactions" ADD CONSTRAINT "leave_transactions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_transactions" ADD CONSTRAINT "leave_transactions_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_transactions" ADD CONSTRAINT "leave_transactions_leave_type_id_leave_types_id_fk" FOREIGN KEY ("leave_type_id") REFERENCES "public"."leave_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_transactions" ADD CONSTRAINT "leave_transactions_grant_lot_id_leave_grant_lots_id_fk" FOREIGN KEY ("grant_lot_id") REFERENCES "public"."leave_grant_lots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_transactions" ADD CONSTRAINT "leave_transactions_request_id_leave_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."leave_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_transactions" ADD CONSTRAINT "leave_transactions_original_transaction_id_leave_transactions_id_fk" FOREIGN KEY ("original_transaction_id") REFERENCES "public"."leave_transactions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_transactions" ADD CONSTRAINT "leave_transactions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_types" ADD CONSTRAINT "leave_types_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_calendar_date_exceptions" ADD CONSTRAINT "work_calendar_date_exceptions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_calendar_date_exceptions" ADD CONSTRAINT "work_calendar_date_exceptions_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_calendar_date_exceptions" ADD CONSTRAINT "work_calendar_date_exceptions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_calendar_patterns" ADD CONSTRAINT "work_calendar_patterns_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_calendar_patterns" ADD CONSTRAINT "work_calendar_patterns_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_calendar_patterns" ADD CONSTRAINT "work_calendar_patterns_activated_by_user_id_users_id_fk" FOREIGN KEY ("activated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "absence_records_employee_date_active_unique" ON "absence_records" USING btree ("employee_id","work_date") WHERE "absence_records"."revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX "absence_records_org_date_idx" ON "absence_records" USING btree ("organization_id","work_date");--> statement-breakpoint
CREATE UNIQUE INDEX "import_batches_org_kind_fingerprint_unique" ON "import_batches" USING btree ("organization_id","kind","fingerprint");--> statement-breakpoint
CREATE INDEX "import_batches_org_created_idx" ON "import_batches" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "leave_balance_accounts_employee_type_unique" ON "leave_balance_accounts" USING btree ("employee_id","leave_type_id");--> statement-breakpoint
CREATE INDEX "leave_balance_accounts_org_employee_idx" ON "leave_balance_accounts" USING btree ("organization_id","employee_id");--> statement-breakpoint
CREATE INDEX "leave_grant_lots_account_expiry_idx" ON "leave_grant_lots" USING btree ("account_id","expires_on","granted_on");--> statement-breakpoint
CREATE UNIQUE INDEX "leave_request_days_request_date_unique" ON "leave_request_days" USING btree ("request_id","work_date");--> statement-breakpoint
CREATE INDEX "leave_request_days_work_date_idx" ON "leave_request_days" USING btree ("work_date");--> statement-breakpoint
CREATE INDEX "leave_requests_org_status_created_idx" ON "leave_requests" USING btree ("organization_id","status","created_at");--> statement-breakpoint
CREATE INDEX "leave_requests_employee_created_idx" ON "leave_requests" USING btree ("employee_id","created_at");--> statement-breakpoint
CREATE INDEX "leave_requests_leave_type_idx" ON "leave_requests" USING btree ("leave_type_id");--> statement-breakpoint
CREATE INDEX "leave_transactions_account_effective_idx" ON "leave_transactions" USING btree ("account_id","effective_on","created_at");--> statement-breakpoint
CREATE INDEX "leave_transactions_request_idx" ON "leave_transactions" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "leave_transactions_grant_lot_idx" ON "leave_transactions" USING btree ("grant_lot_id");--> statement-breakpoint
CREATE UNIQUE INDEX "leave_types_org_code_unique" ON "leave_types" USING btree ("organization_id","code");--> statement-breakpoint
CREATE INDEX "leave_types_org_active_effective_idx" ON "leave_types" USING btree ("organization_id","active","effective_from");--> statement-breakpoint
CREATE UNIQUE INDEX "work_calendar_exceptions_org_date_unique" ON "work_calendar_date_exceptions" USING btree ("organization_id","calendar_date") WHERE "work_calendar_date_exceptions"."employee_id" IS NULL AND "work_calendar_date_exceptions"."active" = true;--> statement-breakpoint
CREATE UNIQUE INDEX "work_calendar_exceptions_employee_date_unique" ON "work_calendar_date_exceptions" USING btree ("employee_id","calendar_date") WHERE "work_calendar_date_exceptions"."employee_id" IS NOT NULL AND "work_calendar_date_exceptions"."active" = true;--> statement-breakpoint
CREATE INDEX "work_calendar_exceptions_org_date_idx" ON "work_calendar_date_exceptions" USING btree ("organization_id","calendar_date");--> statement-breakpoint
CREATE INDEX "work_calendar_exceptions_employee_date_idx" ON "work_calendar_date_exceptions" USING btree ("employee_id","calendar_date");--> statement-breakpoint
CREATE UNIQUE INDEX "work_calendar_patterns_org_effective_unique" ON "work_calendar_patterns" USING btree ("organization_id","effective_from");--> statement-breakpoint
CREATE INDEX "work_calendar_patterns_org_status_effective_idx" ON "work_calendar_patterns" USING btree ("organization_id","status","effective_from");--> statement-breakpoint
ALTER TABLE "attendance_month_day_snapshots" ADD CONSTRAINT "attendance_month_snapshots_leave_units_valid" CHECK ("attendance_month_day_snapshots"."leave_units" IS NULL OR "attendance_month_day_snapshots"."leave_units" IN (0, 1, 2));--> statement-breakpoint
ALTER TABLE "attendance_month_day_snapshots" ADD CONSTRAINT "attendance_month_snapshots_leave_minutes_nonnegative" CHECK ("attendance_month_day_snapshots"."leave_scheduled_minutes" IS NULL OR "attendance_month_day_snapshots"."leave_scheduled_minutes" >= 0);