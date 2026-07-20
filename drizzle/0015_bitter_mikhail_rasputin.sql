CREATE TYPE "public"."notification_kind" AS ENUM('overtime_request_submitted', 'overtime_request_cancelled', 'overtime_request_approved', 'overtime_request_rejected');--> statement-breakpoint
CREATE TYPE "public"."overtime_policy_status" AS ENUM('draft', 'active', 'inactive');--> statement-breakpoint
CREATE TYPE "public"."overtime_reconciliation_status" AS ENUM('within_request', 'under_request', 'exceeded_request', 'no_actual', 'unapproved_actual');--> statement-breakpoint
CREATE TYPE "public"."overtime_request_kind" AS ENUM('overtime', 'holiday_work');--> statement-breakpoint
CREATE TYPE "public"."overtime_request_status" AS ENUM('pending', 'approved', 'rejected', 'cancelled');--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'overtime_policy_created' BEFORE 'csv_imported';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'overtime_policy_activated' BEFORE 'csv_imported';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'overtime_policy_changed' BEFORE 'csv_imported';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'overtime_request_submitted' BEFORE 'csv_imported';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'overtime_request_cancelled' BEFORE 'csv_imported';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'overtime_request_approved' BEFORE 'csv_imported';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'overtime_request_rejected' BEFORE 'csv_imported';--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"recipient_user_id" uuid NOT NULL,
	"kind" "notification_kind" NOT NULL,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notifications_title_not_blank" CHECK (length(trim("notifications"."title")) > 0),
	CONSTRAINT "notifications_summary_not_blank" CHECK (length(trim("notifications"."summary")) > 0),
	CONSTRAINT "notifications_entity_type_not_blank" CHECK (length(trim("notifications"."entity_type")) > 0)
);
--> statement-breakpoint
CREATE TABLE "overtime_request_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"effective_from" date NOT NULL,
	"status" "overtime_policy_status" DEFAULT 'draft' NOT NULL,
	"minute_increment" integer DEFAULT 15 NOT NULL,
	"require_prior_approval" boolean DEFAULT true NOT NULL,
	"allowed_deviation_minutes" integer DEFAULT 0 NOT NULL,
	"block_close_on_unresolved_difference" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"created_by_user_id" uuid,
	"activated_by_user_id" uuid,
	"activated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "overtime_request_policies_minute_increment_valid" CHECK ("overtime_request_policies"."minute_increment" IN (1, 5, 10, 15, 30)),
	CONSTRAINT "overtime_request_policies_allowed_deviation_nonnegative" CHECK ("overtime_request_policies"."allowed_deviation_minutes" >= 0),
	CONSTRAINT "overtime_request_policies_version_nonnegative" CHECK ("overtime_request_policies"."version" >= 0),
	CONSTRAINT "overtime_request_policies_activation_complete" CHECK (("overtime_request_policies"."status" = 'draft' AND "overtime_request_policies"."activated_by_user_id" IS NULL AND "overtime_request_policies"."activated_at" IS NULL) OR ("overtime_request_policies"."status" IN ('active', 'inactive') AND "overtime_request_policies"."activated_by_user_id" IS NOT NULL AND "overtime_request_policies"."activated_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "overtime_work_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"requested_by_user_id" uuid NOT NULL,
	"policy_id" uuid NOT NULL,
	"kind" "overtime_request_kind" NOT NULL,
	"work_date" date NOT NULL,
	"planned_start_at" timestamp with time zone NOT NULL,
	"planned_end_at" timestamp with time zone NOT NULL,
	"planned_break_minutes" integer DEFAULT 0 NOT NULL,
	"planned_minutes" integer NOT NULL,
	"reason" text NOT NULL,
	"work_rule_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"calendar_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "overtime_request_status" DEFAULT 'pending' NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"reviewer_user_id" uuid,
	"review_comment" text,
	"reviewed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "overtime_work_requests_reason_not_blank" CHECK (length(trim("overtime_work_requests"."reason")) > 0),
	CONSTRAINT "overtime_work_requests_planned_range_valid" CHECK ("overtime_work_requests"."planned_end_at" > "overtime_work_requests"."planned_start_at" AND "overtime_work_requests"."planned_end_at" <= "overtime_work_requests"."planned_start_at" + interval '24 hours'),
	CONSTRAINT "overtime_work_requests_break_nonnegative" CHECK ("overtime_work_requests"."planned_break_minutes" >= 0),
	CONSTRAINT "overtime_work_requests_minutes_positive" CHECK ("overtime_work_requests"."planned_minutes" > 0),
	CONSTRAINT "overtime_work_requests_version_nonnegative" CHECK ("overtime_work_requests"."version" >= 0),
	CONSTRAINT "overtime_work_requests_status_details_valid" CHECK (("overtime_work_requests"."status" = 'pending' AND "overtime_work_requests"."reviewer_user_id" IS NULL AND "overtime_work_requests"."reviewed_at" IS NULL AND "overtime_work_requests"."cancelled_at" IS NULL) OR ("overtime_work_requests"."status" = 'approved' AND "overtime_work_requests"."reviewer_user_id" IS NOT NULL AND "overtime_work_requests"."reviewed_at" IS NOT NULL AND "overtime_work_requests"."cancelled_at" IS NULL) OR ("overtime_work_requests"."status" = 'rejected' AND "overtime_work_requests"."reviewer_user_id" IS NOT NULL AND "overtime_work_requests"."reviewed_at" IS NOT NULL AND length(trim("overtime_work_requests"."review_comment")) > 0 AND "overtime_work_requests"."cancelled_at" IS NULL) OR ("overtime_work_requests"."status" = 'cancelled' AND "overtime_work_requests"."reviewer_user_id" IS NULL AND "overtime_work_requests"."reviewed_at" IS NULL AND "overtime_work_requests"."cancelled_at" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "attendance_month_day_snapshots" ADD COLUMN "overtime_policy_id" uuid;--> statement-breakpoint
ALTER TABLE "attendance_month_day_snapshots" ADD COLUMN "overtime_request_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "attendance_month_day_snapshots" ADD COLUMN "overtime_request_kind" "overtime_request_kind";--> statement-breakpoint
ALTER TABLE "attendance_month_day_snapshots" ADD COLUMN "overtime_requested_minutes" integer;--> statement-breakpoint
ALTER TABLE "attendance_month_day_snapshots" ADD COLUMN "overtime_actual_minutes" integer;--> statement-breakpoint
ALTER TABLE "attendance_month_day_snapshots" ADD COLUMN "overtime_difference_minutes" integer;--> statement-breakpoint
ALTER TABLE "attendance_month_day_snapshots" ADD COLUMN "overtime_reconciliation_status" "overtime_reconciliation_status";--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_user_id_users_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "overtime_request_policies" ADD CONSTRAINT "overtime_request_policies_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "overtime_request_policies" ADD CONSTRAINT "overtime_request_policies_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "overtime_request_policies" ADD CONSTRAINT "overtime_request_policies_activated_by_user_id_users_id_fk" FOREIGN KEY ("activated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "overtime_work_requests" ADD CONSTRAINT "overtime_work_requests_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "overtime_work_requests" ADD CONSTRAINT "overtime_work_requests_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "overtime_work_requests" ADD CONSTRAINT "overtime_work_requests_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "overtime_work_requests" ADD CONSTRAINT "overtime_work_requests_policy_id_overtime_request_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."overtime_request_policies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "overtime_work_requests" ADD CONSTRAINT "overtime_work_requests_reviewer_user_id_users_id_fk" FOREIGN KEY ("reviewer_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notifications_recipient_unread_created_idx" ON "notifications" USING btree ("organization_id","recipient_user_id","read_at","created_at");--> statement-breakpoint
CREATE INDEX "notifications_entity_idx" ON "notifications" USING btree ("organization_id","entity_type","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "overtime_request_policies_org_effective_unique" ON "overtime_request_policies" USING btree ("organization_id","effective_from");--> statement-breakpoint
CREATE INDEX "overtime_request_policies_org_status_effective_idx" ON "overtime_request_policies" USING btree ("organization_id","status","effective_from");--> statement-breakpoint
CREATE INDEX "overtime_work_requests_org_status_created_idx" ON "overtime_work_requests" USING btree ("organization_id","status","created_at");--> statement-breakpoint
CREATE INDEX "overtime_work_requests_employee_date_idx" ON "overtime_work_requests" USING btree ("employee_id","work_date");--> statement-breakpoint
CREATE INDEX "overtime_work_requests_org_date_kind_idx" ON "overtime_work_requests" USING btree ("organization_id","work_date","kind");--> statement-breakpoint
ALTER TABLE "attendance_month_day_snapshots" ADD CONSTRAINT "attendance_month_day_snapshots_overtime_policy_id_overtime_request_policies_id_fk" FOREIGN KEY ("overtime_policy_id") REFERENCES "public"."overtime_request_policies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_month_day_snapshots" ADD CONSTRAINT "attendance_month_snapshots_overtime_requested_nonnegative" CHECK ("attendance_month_day_snapshots"."overtime_requested_minutes" IS NULL OR "attendance_month_day_snapshots"."overtime_requested_minutes" >= 0);--> statement-breakpoint
ALTER TABLE "attendance_month_day_snapshots" ADD CONSTRAINT "attendance_month_snapshots_overtime_actual_nonnegative" CHECK ("attendance_month_day_snapshots"."overtime_actual_minutes" IS NULL OR "attendance_month_day_snapshots"."overtime_actual_minutes" >= 0);
--> statement-breakpoint
CREATE FUNCTION enforce_v05_organization_boundary() RETURNS trigger AS $$
BEGIN
  IF TG_TABLE_NAME = 'overtime_request_policies' THEN
    IF NEW.created_by_user_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM users actor
      WHERE actor.id = NEW.created_by_user_id
        AND actor.organization_id = NEW.organization_id
    ) THEN
      RAISE EXCEPTION 'overtime policy creator must belong to the policy organization';
    END IF;
    IF NEW.activated_by_user_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM users actor
      WHERE actor.id = NEW.activated_by_user_id
        AND actor.organization_id = NEW.organization_id
    ) THEN
      RAISE EXCEPTION 'overtime policy activator must belong to the policy organization';
    END IF;
  ELSIF TG_TABLE_NAME = 'overtime_work_requests' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM employees employee
      JOIN users requester ON requester.id = NEW.requested_by_user_id
      JOIN overtime_request_policies policy ON policy.id = NEW.policy_id
      WHERE employee.id = NEW.employee_id
        AND employee.organization_id = NEW.organization_id
        AND employee.user_id = requester.id
        AND requester.organization_id = NEW.organization_id
        AND policy.organization_id = NEW.organization_id
    ) THEN
      RAISE EXCEPTION 'overtime request employee, requester, and policy must belong to the request organization';
    END IF;
    IF NEW.reviewer_user_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM users reviewer
      WHERE reviewer.id = NEW.reviewer_user_id
        AND reviewer.organization_id = NEW.organization_id
    ) THEN
      RAISE EXCEPTION 'overtime reviewer must belong to the request organization';
    END IF;
  ELSIF TG_TABLE_NAME = 'notifications' THEN
    IF NOT EXISTS (
      SELECT 1 FROM users recipient
      WHERE recipient.id = NEW.recipient_user_id
        AND recipient.organization_id = NEW.organization_id
    ) THEN
      RAISE EXCEPTION 'notification recipient must belong to the notification organization';
    END IF;
    IF NEW.entity_type <> 'overtime_work_request' OR NOT EXISTS (
      SELECT 1 FROM overtime_work_requests request
      WHERE request.id = NEW.entity_id
        AND request.organization_id = NEW.organization_id
    ) THEN
      RAISE EXCEPTION 'notification target must be an overtime request in the notification organization';
    END IF;
  ELSIF TG_TABLE_NAME = 'attendance_month_day_snapshots' THEN
    IF NEW.overtime_policy_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM overtime_request_policies policy
      WHERE policy.id = NEW.overtime_policy_id
        AND policy.organization_id = NEW.organization_id
    ) THEN
      RAISE EXCEPTION 'snapshot overtime policy must belong to the snapshot organization';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM jsonb_array_elements_text(NEW.overtime_request_ids) request_id
      WHERE NOT EXISTS (
        SELECT 1 FROM overtime_work_requests request
        WHERE request.id = request_id::uuid
          AND request.organization_id = NEW.organization_id
          AND request.employee_id = NEW.employee_id
          AND request.work_date = NEW.work_date
      )
    ) THEN
      RAISE EXCEPTION 'snapshot overtime requests must match its organization, employee, and work date';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER overtime_request_policies_organization_boundary
BEFORE INSERT OR UPDATE ON "overtime_request_policies"
FOR EACH ROW EXECUTE FUNCTION enforce_v05_organization_boundary();
--> statement-breakpoint
CREATE TRIGGER overtime_work_requests_organization_boundary
BEFORE INSERT OR UPDATE ON "overtime_work_requests"
FOR EACH ROW EXECUTE FUNCTION enforce_v05_organization_boundary();
--> statement-breakpoint
CREATE TRIGGER notifications_organization_boundary
BEFORE INSERT OR UPDATE ON "notifications"
FOR EACH ROW EXECUTE FUNCTION enforce_v05_organization_boundary();
--> statement-breakpoint
CREATE TRIGGER attendance_month_snapshots_overtime_boundary
BEFORE INSERT OR UPDATE ON "attendance_month_day_snapshots"
FOR EACH ROW EXECUTE FUNCTION enforce_v05_organization_boundary();
--> statement-breakpoint
CREATE FUNCTION enforce_overtime_request_transition() RETURNS trigger AS $$
BEGIN
  IF OLD.status <> NEW.status AND OLD.status <> 'pending' THEN
    RAISE EXCEPTION 'a reviewed or cancelled overtime request is final';
  END IF;
  IF OLD.status = 'pending' AND NEW.status = 'pending' AND (
    OLD.organization_id <> NEW.organization_id OR
    OLD.employee_id <> NEW.employee_id OR
    OLD.requested_by_user_id <> NEW.requested_by_user_id OR
    OLD.policy_id <> NEW.policy_id OR
    OLD.kind <> NEW.kind OR
    OLD.work_date <> NEW.work_date OR
    OLD.planned_start_at <> NEW.planned_start_at OR
    OLD.planned_end_at <> NEW.planned_end_at OR
    OLD.planned_break_minutes <> NEW.planned_break_minutes OR
    OLD.planned_minutes <> NEW.planned_minutes OR
    OLD.reason <> NEW.reason OR
    OLD.work_rule_snapshot <> NEW.work_rule_snapshot OR
    OLD.calendar_snapshot <> NEW.calendar_snapshot
  ) THEN
    RAISE EXCEPTION 'overtime request details are immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER overtime_work_requests_final_state
BEFORE UPDATE ON "overtime_work_requests"
FOR EACH ROW EXECUTE FUNCTION enforce_overtime_request_transition();
--> statement-breakpoint
CREATE FUNCTION prevent_overlapping_overtime_requests() RETURNS trigger AS $$
BEGIN
  IF NEW.status IN ('pending', 'approved') AND EXISTS (
    SELECT 1 FROM overtime_work_requests existing
    WHERE existing.employee_id = NEW.employee_id
      AND existing.id <> NEW.id
      AND existing.status IN ('pending', 'approved')
      AND tstzrange(existing.planned_start_at, existing.planned_end_at, '[)')
        && tstzrange(NEW.planned_start_at, NEW.planned_end_at, '[)')
  ) THEN
    RAISE EXCEPTION 'overtime request overlaps an existing pending or approved request';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER overtime_work_requests_no_overlap
BEFORE INSERT OR UPDATE ON "overtime_work_requests"
FOR EACH ROW EXECUTE FUNCTION prevent_overlapping_overtime_requests();
--> statement-breakpoint
INSERT INTO "overtime_request_policies" (
  "organization_id",
  "effective_from",
  "status",
  "minute_increment",
  "require_prior_approval",
  "allowed_deviation_minutes",
  "block_close_on_unresolved_difference"
)
SELECT
  organization.id,
  CURRENT_DATE,
  'draft',
  15,
  true,
  0,
  false
FROM organizations organization
ON CONFLICT (organization_id, effective_from) DO NOTHING;
