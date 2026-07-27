CREATE TYPE "public"."approval_case_status" AS ENUM('pending', 'returned', 'approved', 'rejected', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."approval_request_type" AS ENUM('attendance_correction', 'leave', 'overtime', 'holiday_work');--> statement-breakpoint
ALTER TYPE "public"."attendance_correction_status" ADD VALUE 'returned' BEFORE 'approved';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'approval_route_changed' BEFORE 'payroll_profile_created';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'approval_delegation_changed' BEFORE 'payroll_profile_created';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'approval_case_assigned' BEFORE 'payroll_profile_created';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'approval_case_submitted' BEFORE 'payroll_profile_created';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'approval_case_returned' BEFORE 'payroll_profile_created';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'approval_case_resubmitted' BEFORE 'payroll_profile_created';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'approval_case_approved' BEFORE 'payroll_profile_created';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'approval_case_rejected' BEFORE 'payroll_profile_created';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'approval_case_cancelled' BEFORE 'payroll_profile_created';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'approval_proxy_created' BEFORE 'payroll_profile_created';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'approval_self_review_rejected' BEFORE 'payroll_profile_created';--> statement-breakpoint
ALTER TYPE "public"."leave_request_status" ADD VALUE 'returned' BEFORE 'approved';--> statement-breakpoint
ALTER TYPE "public"."notification_kind" ADD VALUE 'approval_submitted';--> statement-breakpoint
ALTER TYPE "public"."notification_kind" ADD VALUE 'approval_resubmitted';--> statement-breakpoint
ALTER TYPE "public"."notification_kind" ADD VALUE 'approval_returned';--> statement-breakpoint
ALTER TYPE "public"."notification_kind" ADD VALUE 'approval_approved';--> statement-breakpoint
ALTER TYPE "public"."notification_kind" ADD VALUE 'approval_rejected';--> statement-breakpoint
ALTER TYPE "public"."notification_kind" ADD VALUE 'approval_cancelled';--> statement-breakpoint
ALTER TYPE "public"."notification_kind" ADD VALUE 'approval_assigned';--> statement-breakpoint
ALTER TYPE "public"."notification_kind" ADD VALUE 'approval_unassigned';--> statement-breakpoint
ALTER TYPE "public"."overtime_request_status" ADD VALUE 'returned' BEFORE 'approved';--> statement-breakpoint
ALTER TYPE "public"."user_role" ADD VALUE 'approver' BEFORE 'employee';--> statement-breakpoint
CREATE TABLE "approval_assignment_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"approval_case_id" uuid NOT NULL,
	"original_approver_user_id" uuid,
	"from_approver_user_id" uuid,
	"to_approver_user_id" uuid,
	"reason" text NOT NULL,
	"changed_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approval_assignment_history_reason_not_blank" CHECK (length(trim("approval_assignment_history"."reason")) > 0)
);
--> statement-breakpoint
CREATE TABLE "approval_case_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"approval_case_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"revised_by_user_id" uuid NOT NULL,
	"snapshot" jsonb NOT NULL,
	"revision_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approval_case_revisions_revision_positive" CHECK ("approval_case_revisions"."revision" >= 1),
	CONSTRAINT "approval_case_revisions_snapshot_size" CHECK (octet_length("approval_case_revisions"."snapshot"::text) <= 1048576)
);
--> statement-breakpoint
CREATE TABLE "approval_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"request_type" "approval_request_type" NOT NULL,
	"target_employee_id" uuid NOT NULL,
	"submitted_department_id" uuid,
	"submitted_by_user_id" uuid NOT NULL,
	"submitted_on_behalf" boolean DEFAULT false NOT NULL,
	"proxy_reason" text,
	"attendance_correction_request_id" uuid,
	"leave_request_id" uuid,
	"overtime_work_request_id" uuid,
	"route_assignment_id" uuid,
	"original_approver_user_id" uuid,
	"assigned_approver_user_id" uuid,
	"route_reason" text NOT NULL,
	"target_date" date NOT NULL,
	"due_at" timestamp with time zone,
	"status" "approval_case_status" DEFAULT 'pending' NOT NULL,
	"current_revision" integer DEFAULT 1 NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"reviewer_user_id" uuid,
	"review_comment" text,
	"reviewed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approval_cases_single_domain_request" CHECK ((CASE WHEN "approval_cases"."attendance_correction_request_id" IS NOT NULL THEN 1 ELSE 0 END + CASE WHEN "approval_cases"."leave_request_id" IS NOT NULL THEN 1 ELSE 0 END + CASE WHEN "approval_cases"."overtime_work_request_id" IS NOT NULL THEN 1 ELSE 0 END) = 1),
	CONSTRAINT "approval_cases_request_type_matches_reference" CHECK (("approval_cases"."request_type" = 'attendance_correction' AND "approval_cases"."attendance_correction_request_id" IS NOT NULL AND "approval_cases"."leave_request_id" IS NULL AND "approval_cases"."overtime_work_request_id" IS NULL) OR ("approval_cases"."request_type" = 'leave' AND "approval_cases"."attendance_correction_request_id" IS NULL AND "approval_cases"."leave_request_id" IS NOT NULL AND "approval_cases"."overtime_work_request_id" IS NULL) OR ("approval_cases"."request_type" IN ('overtime', 'holiday_work') AND "approval_cases"."attendance_correction_request_id" IS NULL AND "approval_cases"."leave_request_id" IS NULL AND "approval_cases"."overtime_work_request_id" IS NOT NULL)),
	CONSTRAINT "approval_cases_proxy_reason_valid" CHECK (("approval_cases"."submitted_on_behalf" = false AND "approval_cases"."proxy_reason" IS NULL) OR ("approval_cases"."submitted_on_behalf" = true AND length(trim("approval_cases"."proxy_reason")) > 0)),
	CONSTRAINT "approval_cases_route_reason_valid" CHECK ("approval_cases"."route_reason" IN ('department_route', 'delegated', 'legacy_admin_pool', 'manual_reassignment')),
	CONSTRAINT "approval_cases_current_revision_positive" CHECK ("approval_cases"."current_revision" >= 1),
	CONSTRAINT "approval_cases_version_nonnegative" CHECK ("approval_cases"."version" >= 0),
	CONSTRAINT "approval_cases_status_details_valid" CHECK (("approval_cases"."status" = 'pending' AND "approval_cases"."reviewer_user_id" IS NULL AND "approval_cases"."reviewed_at" IS NULL AND "approval_cases"."cancelled_at" IS NULL) OR ("approval_cases"."status" = 'returned' AND "approval_cases"."reviewer_user_id" IS NOT NULL AND "approval_cases"."reviewed_at" IS NOT NULL AND length(trim("approval_cases"."review_comment")) > 0 AND "approval_cases"."cancelled_at" IS NULL) OR ("approval_cases"."status" = 'approved' AND "approval_cases"."reviewer_user_id" IS NOT NULL AND "approval_cases"."reviewed_at" IS NOT NULL AND "approval_cases"."cancelled_at" IS NULL) OR ("approval_cases"."status" = 'rejected' AND "approval_cases"."reviewer_user_id" IS NOT NULL AND "approval_cases"."reviewed_at" IS NOT NULL AND length(trim("approval_cases"."review_comment")) > 0 AND "approval_cases"."cancelled_at" IS NULL) OR ("approval_cases"."status" = 'cancelled' AND "approval_cases"."reviewer_user_id" IS NULL AND "approval_cases"."reviewed_at" IS NULL AND "approval_cases"."cancelled_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "approval_delegations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"department_id" uuid NOT NULL,
	"request_type" "approval_request_type" NOT NULL,
	"original_approver_user_id" uuid NOT NULL,
	"delegate_approver_user_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"reason" text NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approval_delegations_time_range_valid" CHECK ("approval_delegations"."ends_at" > "approval_delegations"."starts_at"),
	CONSTRAINT "approval_delegations_reason_not_blank" CHECK (length(trim("approval_delegations"."reason")) > 0),
	CONSTRAINT "approval_delegations_distinct_approvers" CHECK ("approval_delegations"."original_approver_user_id" <> "approval_delegations"."delegate_approver_user_id"),
	CONSTRAINT "approval_delegations_version_nonnegative" CHECK ("approval_delegations"."version" >= 0)
);
--> statement-breakpoint
CREATE TABLE "approval_route_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"department_id" uuid NOT NULL,
	"request_type" "approval_request_type" NOT NULL,
	"approver_user_id" uuid NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"due_days" integer,
	"version" integer DEFAULT 0 NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approval_route_assignments_effective_range_valid" CHECK ("approval_route_assignments"."effective_to" IS NULL OR "approval_route_assignments"."effective_to" >= "approval_route_assignments"."effective_from"),
	CONSTRAINT "approval_route_assignments_due_days_valid" CHECK ("approval_route_assignments"."due_days" IS NULL OR ("approval_route_assignments"."due_days" >= 1 AND "approval_route_assignments"."due_days" <= 365)),
	CONSTRAINT "approval_route_assignments_version_nonnegative" CHECK ("approval_route_assignments"."version" >= 0)
);
--> statement-breakpoint
ALTER TABLE "leave_requests" DROP CONSTRAINT "leave_requests_status_details_valid";--> statement-breakpoint
ALTER TABLE "overtime_work_requests" DROP CONSTRAINT "overtime_work_requests_status_details_valid";--> statement-breakpoint
DROP INDEX "attendance_correction_requests_pending_unique";--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "event_key" text;--> statement-breakpoint
ALTER TABLE "approval_assignment_history" ADD CONSTRAINT "approval_assignment_history_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_assignment_history" ADD CONSTRAINT "approval_assignment_history_approval_case_id_approval_cases_id_fk" FOREIGN KEY ("approval_case_id") REFERENCES "public"."approval_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_assignment_history" ADD CONSTRAINT "approval_assignment_history_original_approver_user_id_users_id_fk" FOREIGN KEY ("original_approver_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_assignment_history" ADD CONSTRAINT "approval_assignment_history_from_approver_user_id_users_id_fk" FOREIGN KEY ("from_approver_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_assignment_history" ADD CONSTRAINT "approval_assignment_history_to_approver_user_id_users_id_fk" FOREIGN KEY ("to_approver_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_assignment_history" ADD CONSTRAINT "approval_assignment_history_changed_by_user_id_users_id_fk" FOREIGN KEY ("changed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_case_revisions" ADD CONSTRAINT "approval_case_revisions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_case_revisions" ADD CONSTRAINT "approval_case_revisions_approval_case_id_approval_cases_id_fk" FOREIGN KEY ("approval_case_id") REFERENCES "public"."approval_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_case_revisions" ADD CONSTRAINT "approval_case_revisions_revised_by_user_id_users_id_fk" FOREIGN KEY ("revised_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_cases" ADD CONSTRAINT "approval_cases_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_cases" ADD CONSTRAINT "approval_cases_target_employee_id_employees_id_fk" FOREIGN KEY ("target_employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_cases" ADD CONSTRAINT "approval_cases_submitted_department_id_departments_id_fk" FOREIGN KEY ("submitted_department_id") REFERENCES "public"."departments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_cases" ADD CONSTRAINT "approval_cases_submitted_by_user_id_users_id_fk" FOREIGN KEY ("submitted_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_cases" ADD CONSTRAINT "approval_cases_attendance_correction_request_id_attendance_correction_requests_id_fk" FOREIGN KEY ("attendance_correction_request_id") REFERENCES "public"."attendance_correction_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_cases" ADD CONSTRAINT "approval_cases_leave_request_id_leave_requests_id_fk" FOREIGN KEY ("leave_request_id") REFERENCES "public"."leave_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_cases" ADD CONSTRAINT "approval_cases_overtime_work_request_id_overtime_work_requests_id_fk" FOREIGN KEY ("overtime_work_request_id") REFERENCES "public"."overtime_work_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_cases" ADD CONSTRAINT "approval_cases_route_assignment_id_approval_route_assignments_id_fk" FOREIGN KEY ("route_assignment_id") REFERENCES "public"."approval_route_assignments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_cases" ADD CONSTRAINT "approval_cases_original_approver_user_id_users_id_fk" FOREIGN KEY ("original_approver_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_cases" ADD CONSTRAINT "approval_cases_assigned_approver_user_id_users_id_fk" FOREIGN KEY ("assigned_approver_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_cases" ADD CONSTRAINT "approval_cases_reviewer_user_id_users_id_fk" FOREIGN KEY ("reviewer_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_delegations" ADD CONSTRAINT "approval_delegations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_delegations" ADD CONSTRAINT "approval_delegations_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_delegations" ADD CONSTRAINT "approval_delegations_original_approver_user_id_users_id_fk" FOREIGN KEY ("original_approver_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_delegations" ADD CONSTRAINT "approval_delegations_delegate_approver_user_id_users_id_fk" FOREIGN KEY ("delegate_approver_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_delegations" ADD CONSTRAINT "approval_delegations_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_route_assignments" ADD CONSTRAINT "approval_route_assignments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_route_assignments" ADD CONSTRAINT "approval_route_assignments_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_route_assignments" ADD CONSTRAINT "approval_route_assignments_approver_user_id_users_id_fk" FOREIGN KEY ("approver_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_route_assignments" ADD CONSTRAINT "approval_route_assignments_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "approval_assignment_history_case_created_idx" ON "approval_assignment_history" USING btree ("approval_case_id","created_at");--> statement-breakpoint
CREATE INDEX "approval_assignment_history_org_assignee_idx" ON "approval_assignment_history" USING btree ("organization_id","to_approver_user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "approval_case_revisions_case_revision_unique" ON "approval_case_revisions" USING btree ("approval_case_id","revision");--> statement-breakpoint
CREATE INDEX "approval_case_revisions_org_created_idx" ON "approval_case_revisions" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "approval_cases_attendance_correction_unique" ON "approval_cases" USING btree ("attendance_correction_request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "approval_cases_leave_request_unique" ON "approval_cases" USING btree ("leave_request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "approval_cases_overtime_request_unique" ON "approval_cases" USING btree ("overtime_work_request_id");--> statement-breakpoint
CREATE INDEX "approval_cases_inbox_idx" ON "approval_cases" USING btree ("organization_id","assigned_approver_user_id","status","due_at","created_at");--> statement-breakpoint
CREATE INDEX "approval_cases_org_type_target_idx" ON "approval_cases" USING btree ("organization_id","request_type","target_date");--> statement-breakpoint
CREATE INDEX "approval_cases_org_department_status_idx" ON "approval_cases" USING btree ("organization_id","submitted_department_id","status");--> statement-breakpoint
CREATE INDEX "approval_cases_target_employee_idx" ON "approval_cases" USING btree ("organization_id","target_employee_id","created_at");--> statement-breakpoint
CREATE INDEX "approval_delegations_resolution_idx" ON "approval_delegations" USING btree ("organization_id","department_id","request_type","original_approver_user_id","starts_at","ends_at");--> statement-breakpoint
CREATE INDEX "approval_delegations_delegate_idx" ON "approval_delegations" USING btree ("organization_id","delegate_approver_user_id","ends_at");--> statement-breakpoint
CREATE UNIQUE INDEX "approval_route_assignments_org_dept_type_from_unique" ON "approval_route_assignments" USING btree ("organization_id","department_id","request_type","effective_from");--> statement-breakpoint
CREATE INDEX "approval_route_assignments_resolution_idx" ON "approval_route_assignments" USING btree ("organization_id","department_id","request_type","effective_from","effective_to");--> statement-breakpoint
CREATE INDEX "approval_route_assignments_approver_idx" ON "approval_route_assignments" USING btree ("organization_id","approver_user_id","effective_from");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_event_key_unique" ON "notifications" USING btree ("event_key");--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_correction_requests_pending_unique" ON "attendance_correction_requests" USING btree ("employee_id","work_date") WHERE "attendance_correction_requests"."status" NOT IN ('approved', 'rejected', 'cancelled');--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_status_details_valid" CHECK (("leave_requests"."status"::text = 'pending' AND "leave_requests"."reviewer_user_id" IS NULL AND "leave_requests"."reviewed_at" IS NULL AND "leave_requests"."cancelled_at" IS NULL) OR ("leave_requests"."status"::text = 'returned' AND "leave_requests"."reviewer_user_id" IS NOT NULL AND "leave_requests"."reviewed_at" IS NOT NULL AND length(trim("leave_requests"."review_comment")) > 0 AND "leave_requests"."cancelled_at" IS NULL) OR ("leave_requests"."status"::text = 'approved' AND "leave_requests"."reviewer_user_id" IS NOT NULL AND "leave_requests"."reviewed_at" IS NOT NULL AND "leave_requests"."cancelled_at" IS NULL) OR ("leave_requests"."status"::text = 'rejected' AND "leave_requests"."reviewer_user_id" IS NOT NULL AND "leave_requests"."reviewed_at" IS NOT NULL AND length(trim("leave_requests"."review_comment")) > 0 AND "leave_requests"."cancelled_at" IS NULL) OR ("leave_requests"."status"::text = 'cancelled' AND "leave_requests"."reviewer_user_id" IS NULL AND "leave_requests"."reviewed_at" IS NULL AND "leave_requests"."cancelled_at" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "overtime_work_requests" ADD CONSTRAINT "overtime_work_requests_status_details_valid" CHECK (("overtime_work_requests"."status"::text = 'pending' AND "overtime_work_requests"."reviewer_user_id" IS NULL AND "overtime_work_requests"."reviewed_at" IS NULL AND "overtime_work_requests"."cancelled_at" IS NULL) OR ("overtime_work_requests"."status"::text = 'returned' AND "overtime_work_requests"."reviewer_user_id" IS NOT NULL AND "overtime_work_requests"."reviewed_at" IS NOT NULL AND length(trim("overtime_work_requests"."review_comment")) > 0 AND "overtime_work_requests"."cancelled_at" IS NULL) OR ("overtime_work_requests"."status"::text = 'approved' AND "overtime_work_requests"."reviewer_user_id" IS NOT NULL AND "overtime_work_requests"."reviewed_at" IS NOT NULL AND "overtime_work_requests"."cancelled_at" IS NULL) OR ("overtime_work_requests"."status"::text = 'rejected' AND "overtime_work_requests"."reviewer_user_id" IS NOT NULL AND "overtime_work_requests"."reviewed_at" IS NOT NULL AND length(trim("overtime_work_requests"."review_comment")) > 0 AND "overtime_work_requests"."cancelled_at" IS NULL) OR ("overtime_work_requests"."status"::text = 'cancelled' AND "overtime_work_requests"."reviewer_user_id" IS NULL AND "overtime_work_requests"."reviewed_at" IS NULL AND "overtime_work_requests"."cancelled_at" IS NOT NULL));--> statement-breakpoint

CREATE FUNCTION enforce_v08_approval_organization_boundary() RETURNS trigger AS $$
BEGIN
  IF TG_TABLE_NAME = 'approval_route_assignments' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM departments d
      WHERE d.id = NEW.department_id
        AND d.organization_id = NEW.organization_id
    ) THEN
      RAISE EXCEPTION 'approval route department must belong to the route organization';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM users u
      WHERE u.id = NEW.approver_user_id
        AND u.organization_id = NEW.organization_id
        AND u.status = 'active'
        AND u.role IN ('owner', 'hr_admin', 'approver')
    ) THEN
      RAISE EXCEPTION 'approval route approver must be an active eligible user in the route organization';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = NEW.created_by_user_id
        AND u.organization_id = NEW.organization_id
    ) THEN
      RAISE EXCEPTION 'approval route creator must belong to the route organization';
    END IF;
  ELSIF TG_TABLE_NAME = 'approval_delegations' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM departments d
      WHERE d.id = NEW.department_id
        AND d.organization_id = NEW.organization_id
    ) THEN
      RAISE EXCEPTION 'approval delegation department must belong to the delegation organization';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM users original_user
      JOIN users delegate_user
        ON delegate_user.id = NEW.delegate_approver_user_id
       AND delegate_user.organization_id = NEW.organization_id
       AND delegate_user.status = 'active'
       AND delegate_user.role IN ('owner', 'hr_admin', 'approver')
      WHERE original_user.id = NEW.original_approver_user_id
        AND original_user.organization_id = NEW.organization_id
        AND original_user.status = 'active'
        AND original_user.role IN ('owner', 'hr_admin', 'approver')
    ) THEN
      RAISE EXCEPTION 'approval delegation users must be active eligible users in the delegation organization';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = NEW.created_by_user_id
        AND u.organization_id = NEW.organization_id
    ) THEN
      RAISE EXCEPTION 'approval delegation creator must belong to the delegation organization';
    END IF;
  ELSIF TG_TABLE_NAME = 'approval_cases' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM employees e
      JOIN users submitter
        ON submitter.id = NEW.submitted_by_user_id
       AND submitter.organization_id = NEW.organization_id
      WHERE e.id = NEW.target_employee_id
        AND e.organization_id = NEW.organization_id
    ) THEN
      RAISE EXCEPTION 'approval case employee and submitter must belong to the case organization';
    END IF;

    IF NEW.submitted_department_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM departments d
      WHERE d.id = NEW.submitted_department_id
        AND d.organization_id = NEW.organization_id
    ) THEN
      RAISE EXCEPTION 'approval case department must belong to the case organization';
    END IF;

    IF NEW.route_assignment_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM approval_route_assignments route
      WHERE route.id = NEW.route_assignment_id
        AND route.organization_id = NEW.organization_id
        AND route.department_id = NEW.submitted_department_id
        AND route.request_type = NEW.request_type
    ) THEN
      RAISE EXCEPTION 'approval case route must match the case organization, department, and request type';
    END IF;

    IF NEW.original_approver_user_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = NEW.original_approver_user_id
        AND u.organization_id = NEW.organization_id
    ) THEN
      RAISE EXCEPTION 'approval case original approver must belong to the case organization';
    END IF;

    IF NEW.assigned_approver_user_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = NEW.assigned_approver_user_id
        AND u.organization_id = NEW.organization_id
        AND u.status = 'active'
        AND u.role IN ('owner', 'hr_admin', 'approver')
    ) THEN
      RAISE EXCEPTION 'approval case assignee must be an active eligible user in the case organization';
    END IF;

    IF NEW.reviewer_user_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = NEW.reviewer_user_id
        AND u.organization_id = NEW.organization_id
    ) THEN
      RAISE EXCEPTION 'approval case reviewer must belong to the case organization';
    END IF;

    IF NEW.attendance_correction_request_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM attendance_correction_requests request
      WHERE request.id = NEW.attendance_correction_request_id
        AND request.organization_id = NEW.organization_id
        AND request.employee_id = NEW.target_employee_id
    ) THEN
      RAISE EXCEPTION 'attendance correction request must match its approval case';
    END IF;

    IF NEW.leave_request_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM leave_requests request
      WHERE request.id = NEW.leave_request_id
        AND request.organization_id = NEW.organization_id
        AND request.employee_id = NEW.target_employee_id
    ) THEN
      RAISE EXCEPTION 'leave request must match its approval case';
    END IF;

    IF NEW.overtime_work_request_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM overtime_work_requests request
      WHERE request.id = NEW.overtime_work_request_id
        AND request.organization_id = NEW.organization_id
        AND request.employee_id = NEW.target_employee_id
        AND request.kind::text = NEW.request_type::text
    ) THEN
      RAISE EXCEPTION 'overtime request must match its approval case';
    END IF;
  ELSIF TG_TABLE_NAME = 'approval_case_revisions' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM approval_cases approval_case
      JOIN users reviser
        ON reviser.id = NEW.revised_by_user_id
       AND reviser.organization_id = NEW.organization_id
      WHERE approval_case.id = NEW.approval_case_id
        AND approval_case.organization_id = NEW.organization_id
    ) THEN
      RAISE EXCEPTION 'approval revision case and reviser must belong to the revision organization';
    END IF;
  ELSIF TG_TABLE_NAME = 'approval_assignment_history' THEN
    IF NOT EXISTS (
      SELECT 1 FROM approval_cases approval_case
      WHERE approval_case.id = NEW.approval_case_id
        AND approval_case.organization_id = NEW.organization_id
    ) THEN
      RAISE EXCEPTION 'approval assignment history case must belong to the history organization';
    END IF;

    IF (
      NEW.original_approver_user_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM users u
        WHERE u.id = NEW.original_approver_user_id
          AND u.organization_id = NEW.organization_id
      )
    ) OR (
      NEW.from_approver_user_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM users u
        WHERE u.id = NEW.from_approver_user_id
          AND u.organization_id = NEW.organization_id
      )
    ) OR (
      NEW.to_approver_user_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM users u
        WHERE u.id = NEW.to_approver_user_id
          AND u.organization_id = NEW.organization_id
      )
    ) OR (
      NEW.changed_by_user_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM users u
        WHERE u.id = NEW.changed_by_user_id
          AND u.organization_id = NEW.organization_id
      )
    ) THEN
      RAISE EXCEPTION 'approval assignment history users must belong to the history organization';
    END IF;
  ELSIF TG_TABLE_NAME = 'notifications' THEN
    IF NOT EXISTS (
      SELECT 1 FROM users recipient
      WHERE recipient.id = NEW.recipient_user_id
        AND recipient.organization_id = NEW.organization_id
    ) THEN
      RAISE EXCEPTION 'notification recipient must belong to the notification organization';
    END IF;

    IF NEW.entity_type = 'approval_case' THEN
      IF NOT EXISTS (
        SELECT 1 FROM approval_cases approval_case
        WHERE approval_case.id = NEW.entity_id
          AND approval_case.organization_id = NEW.organization_id
      ) THEN
        RAISE EXCEPTION 'notification approval case must belong to the notification organization';
      END IF;
    ELSIF NEW.entity_type = 'overtime_work_request' THEN
      IF NOT EXISTS (
        SELECT 1 FROM overtime_work_requests request
        WHERE request.id = NEW.entity_id
          AND request.organization_id = NEW.organization_id
      ) THEN
        RAISE EXCEPTION 'notification overtime request must belong to the notification organization';
      END IF;
    ELSE
      RAISE EXCEPTION 'notification target type is not supported';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER approval_route_assignments_organization_boundary
BEFORE INSERT OR UPDATE ON approval_route_assignments
FOR EACH ROW EXECUTE FUNCTION enforce_v08_approval_organization_boundary();--> statement-breakpoint

CREATE TRIGGER approval_delegations_organization_boundary
BEFORE INSERT OR UPDATE ON approval_delegations
FOR EACH ROW EXECUTE FUNCTION enforce_v08_approval_organization_boundary();--> statement-breakpoint

CREATE TRIGGER approval_cases_organization_boundary
BEFORE INSERT OR UPDATE ON approval_cases
FOR EACH ROW EXECUTE FUNCTION enforce_v08_approval_organization_boundary();--> statement-breakpoint

CREATE TRIGGER approval_case_revisions_organization_boundary
BEFORE INSERT OR UPDATE ON approval_case_revisions
FOR EACH ROW EXECUTE FUNCTION enforce_v08_approval_organization_boundary();--> statement-breakpoint

CREATE TRIGGER approval_assignment_history_organization_boundary
BEFORE INSERT OR UPDATE ON approval_assignment_history
FOR EACH ROW EXECUTE FUNCTION enforce_v08_approval_organization_boundary();--> statement-breakpoint

DROP TRIGGER notifications_organization_boundary ON notifications;--> statement-breakpoint

CREATE TRIGGER notifications_organization_boundary
BEFORE INSERT OR UPDATE ON notifications
FOR EACH ROW EXECUTE FUNCTION enforce_v08_approval_organization_boundary();--> statement-breakpoint

INSERT INTO approval_cases (
  organization_id,
  request_type,
  target_employee_id,
  submitted_department_id,
  submitted_by_user_id,
  submitted_on_behalf,
  attendance_correction_request_id,
  route_reason,
  target_date,
  status,
  reviewer_user_id,
  review_comment,
  reviewed_at,
  cancelled_at,
  created_at,
  updated_at
)
SELECT
  request.organization_id,
  'attendance_correction',
  request.employee_id,
  primary_department.department_id,
  request.requested_by_user_id,
  false,
  request.id,
  'legacy_admin_pool',
  request.work_date,
  request.status::text::approval_case_status,
  request.reviewer_user_id,
  request.review_comment,
  request.reviewed_at,
  request.cancelled_at,
  request.created_at,
  request.updated_at
FROM attendance_correction_requests request
LEFT JOIN LATERAL (
  SELECT employee_department.department_id
  FROM employee_departments employee_department
  WHERE employee_department.employee_id = request.employee_id
    AND employee_department.is_primary = true
    AND employee_department.started_on <= request.created_at::date
    AND (
      employee_department.ended_on IS NULL
      OR employee_department.ended_on >= request.created_at::date
    )
  ORDER BY employee_department.started_on DESC, employee_department.created_at DESC
  LIMIT 1
) primary_department ON true
ON CONFLICT (attendance_correction_request_id) DO NOTHING;--> statement-breakpoint

INSERT INTO approval_cases (
  organization_id,
  request_type,
  target_employee_id,
  submitted_department_id,
  submitted_by_user_id,
  submitted_on_behalf,
  leave_request_id,
  route_reason,
  target_date,
  status,
  reviewer_user_id,
  review_comment,
  reviewed_at,
  cancelled_at,
  created_at,
  updated_at
)
SELECT
  request.organization_id,
  'leave',
  request.employee_id,
  primary_department.department_id,
  request.requested_by_user_id,
  false,
  request.id,
  'legacy_admin_pool',
  COALESCE(request_dates.target_date, request.created_at::date),
  request.status::text::approval_case_status,
  request.reviewer_user_id,
  request.review_comment,
  request.reviewed_at,
  request.cancelled_at,
  request.created_at,
  request.updated_at
FROM leave_requests request
LEFT JOIN LATERAL (
  SELECT MIN(request_day.work_date) AS target_date
  FROM leave_request_days request_day
  WHERE request_day.request_id = request.id
) request_dates ON true
LEFT JOIN LATERAL (
  SELECT employee_department.department_id
  FROM employee_departments employee_department
  WHERE employee_department.employee_id = request.employee_id
    AND employee_department.is_primary = true
    AND employee_department.started_on <= request.created_at::date
    AND (
      employee_department.ended_on IS NULL
      OR employee_department.ended_on >= request.created_at::date
    )
  ORDER BY employee_department.started_on DESC, employee_department.created_at DESC
  LIMIT 1
) primary_department ON true
ON CONFLICT (leave_request_id) DO NOTHING;--> statement-breakpoint

INSERT INTO approval_cases (
  organization_id,
  request_type,
  target_employee_id,
  submitted_department_id,
  submitted_by_user_id,
  submitted_on_behalf,
  overtime_work_request_id,
  route_reason,
  target_date,
  status,
  reviewer_user_id,
  review_comment,
  reviewed_at,
  cancelled_at,
  created_at,
  updated_at
)
SELECT
  request.organization_id,
  request.kind::text::approval_request_type,
  request.employee_id,
  primary_department.department_id,
  request.requested_by_user_id,
  false,
  request.id,
  'legacy_admin_pool',
  request.work_date,
  request.status::text::approval_case_status,
  request.reviewer_user_id,
  request.review_comment,
  request.reviewed_at,
  request.cancelled_at,
  request.created_at,
  request.updated_at
FROM overtime_work_requests request
LEFT JOIN LATERAL (
  SELECT employee_department.department_id
  FROM employee_departments employee_department
  WHERE employee_department.employee_id = request.employee_id
    AND employee_department.is_primary = true
    AND employee_department.started_on <= request.created_at::date
    AND (
      employee_department.ended_on IS NULL
      OR employee_department.ended_on >= request.created_at::date
    )
  ORDER BY employee_department.started_on DESC, employee_department.created_at DESC
  LIMIT 1
) primary_department ON true
ON CONFLICT (overtime_work_request_id) DO NOTHING;--> statement-breakpoint

INSERT INTO approval_case_revisions (
  organization_id,
  approval_case_id,
  revision,
  revised_by_user_id,
  snapshot,
  revision_reason,
  created_at
)
SELECT
  approval_case.organization_id,
  approval_case.id,
  1,
  request.requested_by_user_id,
  jsonb_build_object(
    'requestType', 'attendance_correction',
    'requestId', request.id,
    'employeeId', request.employee_id,
    'workDate', request.work_date,
    'attendanceDayId', request.attendance_day_id,
    'reason', request.reason,
    'baseRevision', request.base_revision,
    'entries', COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'kind', request_entry.kind,
            'occurredAt', request_entry.occurred_at,
            'originalEventId', request_entry.original_event_id,
            'position', request_entry.position,
            'type', request_entry.type
          )
          ORDER BY request_entry.kind, request_entry.position
        )
        FROM attendance_correction_entries request_entry
        WHERE request_entry.request_id = request.id
      ),
      '[]'::jsonb
    )
  ),
  'v0.8 migration backfill',
  request.created_at
FROM approval_cases approval_case
JOIN attendance_correction_requests request
  ON request.id = approval_case.attendance_correction_request_id
ON CONFLICT (approval_case_id, revision) DO NOTHING;--> statement-breakpoint

INSERT INTO approval_case_revisions (
  organization_id,
  approval_case_id,
  revision,
  revised_by_user_id,
  snapshot,
  revision_reason,
  created_at
)
SELECT
  approval_case.organization_id,
  approval_case.id,
  1,
  request.requested_by_user_id,
  jsonb_build_object(
    'requestType', 'leave',
    'requestId', request.id,
    'employeeId', request.employee_id,
    'leaveTypeId', request.leave_type_id,
    'leaveTypeCode', request.leave_type_code,
    'leaveTypeName', request.leave_type_name,
    'reason', request.reason,
    'days', COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'workDate', request_day.work_date,
            'units', request_day.units,
            'scheduledMinutes', request_day.scheduled_minutes,
            'calendarSource', request_day.calendar_source
          )
          ORDER BY request_day.work_date
        )
        FROM leave_request_days request_day
        WHERE request_day.request_id = request.id
      ),
      '[]'::jsonb
    )
  ),
  'v0.8 migration backfill',
  request.created_at
FROM approval_cases approval_case
JOIN leave_requests request
  ON request.id = approval_case.leave_request_id
ON CONFLICT (approval_case_id, revision) DO NOTHING;--> statement-breakpoint

INSERT INTO approval_case_revisions (
  organization_id,
  approval_case_id,
  revision,
  revised_by_user_id,
  snapshot,
  revision_reason,
  created_at
)
SELECT
  approval_case.organization_id,
  approval_case.id,
  1,
  request.requested_by_user_id,
  jsonb_build_object(
    'requestType', request.kind,
    'requestId', request.id,
    'employeeId', request.employee_id,
    'policyId', request.policy_id,
    'workDate', request.work_date,
    'plannedStartAt', request.planned_start_at,
    'plannedEndAt', request.planned_end_at,
    'plannedBreakMinutes', request.planned_break_minutes,
    'plannedMinutes', request.planned_minutes,
    'reason', request.reason,
    'workRuleSnapshot', request.work_rule_snapshot,
    'calendarSnapshot', request.calendar_snapshot
  ),
  'v0.8 migration backfill',
  request.created_at
FROM approval_cases approval_case
JOIN overtime_work_requests request
  ON request.id = approval_case.overtime_work_request_id
ON CONFLICT (approval_case_id, revision) DO NOTHING;--> statement-breakpoint

DO $$
DECLARE
  source_count bigint;
  case_count bigint;
  revision_count bigint;
  mismatch_count bigint;
  review_mismatch_count bigint;
  leave_reservation_mismatch_count bigint;
BEGIN
  SELECT
    (SELECT count(*) FROM attendance_correction_requests)
    + (SELECT count(*) FROM leave_requests)
    + (SELECT count(*) FROM overtime_work_requests)
  INTO source_count;

  SELECT count(*) INTO case_count FROM approval_cases;
  SELECT count(*) INTO revision_count FROM approval_case_revisions;

  IF case_count <> source_count THEN
    RAISE EXCEPTION
      'v0.8 approval backfill count mismatch: source %, cases %',
      source_count,
      case_count;
  END IF;

  IF revision_count <> case_count THEN
    RAISE EXCEPTION
      'v0.8 approval revision count mismatch: cases %, revisions %',
      case_count,
      revision_count;
  END IF;

  SELECT count(*)
  INTO mismatch_count
  FROM approval_cases approval_case
  LEFT JOIN attendance_correction_requests attendance_request
    ON attendance_request.id = approval_case.attendance_correction_request_id
  LEFT JOIN leave_requests leave_request
    ON leave_request.id = approval_case.leave_request_id
  LEFT JOIN overtime_work_requests overtime_request
    ON overtime_request.id = approval_case.overtime_work_request_id
  WHERE approval_case.status::text <> COALESCE(
    attendance_request.status::text,
    leave_request.status::text,
    overtime_request.status::text
  );

  IF mismatch_count <> 0 THEN
    RAISE EXCEPTION
      'v0.8 approval backfill status mismatch: % rows',
      mismatch_count;
  END IF;

  SELECT count(*)
  INTO review_mismatch_count
  FROM approval_cases approval_case
  LEFT JOIN attendance_correction_requests attendance_request
    ON attendance_request.id = approval_case.attendance_correction_request_id
  LEFT JOIN leave_requests leave_request
    ON leave_request.id = approval_case.leave_request_id
  LEFT JOIN overtime_work_requests overtime_request
    ON overtime_request.id = approval_case.overtime_work_request_id
  WHERE approval_case.reviewer_user_id IS DISTINCT FROM COALESCE(
      attendance_request.reviewer_user_id,
      leave_request.reviewer_user_id,
      overtime_request.reviewer_user_id
    )
    OR approval_case.review_comment IS DISTINCT FROM COALESCE(
      attendance_request.review_comment,
      leave_request.review_comment,
      overtime_request.review_comment
    )
    OR approval_case.reviewed_at IS DISTINCT FROM COALESCE(
      attendance_request.reviewed_at,
      leave_request.reviewed_at,
      overtime_request.reviewed_at
    )
    OR approval_case.cancelled_at IS DISTINCT FROM COALESCE(
      attendance_request.cancelled_at,
      leave_request.cancelled_at,
      overtime_request.cancelled_at
    );

  IF review_mismatch_count <> 0 THEN
    RAISE EXCEPTION
      'v0.8 approval backfill review detail mismatch: % rows',
      review_mismatch_count;
  END IF;

  SELECT count(*)
  INTO leave_reservation_mismatch_count
  FROM approval_cases approval_case
  JOIN approval_case_revisions revision
    ON revision.approval_case_id = approval_case.id
   AND revision.revision = approval_case.current_revision
  WHERE approval_case.request_type = 'leave'
    AND (
      (
        SELECT count(*)
        FROM leave_request_days request_day
        WHERE request_day.request_id = approval_case.leave_request_id
      ) <> jsonb_array_length(COALESCE(revision.snapshot->'days', '[]'::jsonb))
      OR COALESCE(
        (
          SELECT sum(request_day.units)
          FROM leave_request_days request_day
          WHERE request_day.request_id = approval_case.leave_request_id
        ),
        0
      ) <> COALESCE(
        (
          SELECT sum((snapshot_day->>'units')::integer)
          FROM jsonb_array_elements(
            COALESCE(revision.snapshot->'days', '[]'::jsonb)
          ) snapshot_day
        ),
        0
      )
    );

  IF leave_reservation_mismatch_count <> 0 THEN
    RAISE EXCEPTION
      'v0.8 approval backfill leave reservation mismatch: % rows',
      leave_reservation_mismatch_count;
  END IF;
END;
$$;
