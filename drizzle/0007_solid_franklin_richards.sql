CREATE TYPE "public"."attendance_correction_entry_kind" AS ENUM('original', 'requested');--> statement-breakpoint
CREATE TYPE "public"."attendance_correction_status" AS ENUM('pending', 'approved', 'rejected', 'cancelled');--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'attendance_correction_requested' BEFORE 'csv_imported';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'attendance_correction_cancelled' BEFORE 'csv_imported';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'attendance_correction_approved' BEFORE 'csv_imported';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'attendance_correction_rejected' BEFORE 'csv_imported';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'attendance_correction_applied' BEFORE 'csv_imported';--> statement-breakpoint
CREATE TABLE "attendance_correction_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"original_event_id" uuid,
	"kind" "attendance_correction_entry_kind" NOT NULL,
	"position" integer NOT NULL,
	"type" "attendance_event_type" NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attendance_correction_entries_position_nonnegative" CHECK ("attendance_correction_entries"."position" >= 0)
);
--> statement-breakpoint
CREATE TABLE "attendance_correction_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"attendance_day_id" uuid,
	"requested_by_user_id" uuid NOT NULL,
	"reviewer_user_id" uuid,
	"work_date" date NOT NULL,
	"reason" text NOT NULL,
	"status" "attendance_correction_status" DEFAULT 'pending' NOT NULL,
	"base_revision" integer DEFAULT 0 NOT NULL,
	"review_comment" text,
	"reviewed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attendance_correction_requests_reason_not_blank" CHECK (length(trim("attendance_correction_requests"."reason")) > 0),
	CONSTRAINT "attendance_correction_requests_base_revision_nonnegative" CHECK ("attendance_correction_requests"."base_revision" >= 0)
);
--> statement-breakpoint
ALTER TABLE "attendance_days" ADD COLUMN "revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "attendance_events" ADD COLUMN "correction_request_id" uuid;--> statement-breakpoint
ALTER TABLE "attendance_events" ADD COLUMN "superseded_by_correction_request_id" uuid;--> statement-breakpoint
ALTER TABLE "attendance_correction_entries" ADD CONSTRAINT "attendance_correction_entries_request_id_attendance_correction_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."attendance_correction_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_correction_entries" ADD CONSTRAINT "attendance_correction_entries_original_event_id_attendance_events_id_fk" FOREIGN KEY ("original_event_id") REFERENCES "public"."attendance_events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_correction_requests" ADD CONSTRAINT "attendance_correction_requests_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_correction_requests" ADD CONSTRAINT "attendance_correction_requests_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_correction_requests" ADD CONSTRAINT "attendance_correction_requests_attendance_day_id_attendance_days_id_fk" FOREIGN KEY ("attendance_day_id") REFERENCES "public"."attendance_days"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_correction_requests" ADD CONSTRAINT "attendance_correction_requests_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_correction_requests" ADD CONSTRAINT "attendance_correction_requests_reviewer_user_id_users_id_fk" FOREIGN KEY ("reviewer_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_correction_entries_request_kind_position_unique" ON "attendance_correction_entries" USING btree ("request_id","kind","position");--> statement-breakpoint
CREATE INDEX "attendance_correction_entries_original_event_index" ON "attendance_correction_entries" USING btree ("original_event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_correction_requests_pending_unique" ON "attendance_correction_requests" USING btree ("employee_id","work_date") WHERE "attendance_correction_requests"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "attendance_correction_requests_organization_status_created_index" ON "attendance_correction_requests" USING btree ("organization_id","status","created_at");--> statement-breakpoint
CREATE INDEX "attendance_correction_requests_employee_date_index" ON "attendance_correction_requests" USING btree ("employee_id","work_date","created_at");--> statement-breakpoint
CREATE INDEX "attendance_correction_requests_day_index" ON "attendance_correction_requests" USING btree ("attendance_day_id");--> statement-breakpoint
CREATE INDEX "attendance_correction_requests_requester_index" ON "attendance_correction_requests" USING btree ("requested_by_user_id");--> statement-breakpoint
CREATE INDEX "attendance_correction_requests_reviewer_index" ON "attendance_correction_requests" USING btree ("reviewer_user_id");--> statement-breakpoint
ALTER TABLE "attendance_events" ADD CONSTRAINT "attendance_events_correction_request_id_attendance_correction_requests_id_fk" FOREIGN KEY ("correction_request_id") REFERENCES "public"."attendance_correction_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_events" ADD CONSTRAINT "attendance_events_superseded_by_correction_request_id_attendance_correction_requests_id_fk" FOREIGN KEY ("superseded_by_correction_request_id") REFERENCES "public"."attendance_correction_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attendance_events_correction_request_index" ON "attendance_events" USING btree ("correction_request_id");--> statement-breakpoint
CREATE INDEX "attendance_events_superseded_request_index" ON "attendance_events" USING btree ("superseded_by_correction_request_id");--> statement-breakpoint
CREATE INDEX "attendance_events_active_day_time_index" ON "attendance_events" USING btree ("attendance_day_id","occurred_at") WHERE "attendance_events"."superseded_by_correction_request_id" is null;--> statement-breakpoint
CREATE FUNCTION enforce_attendance_correction_request_organization() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM employees employee
    WHERE employee.id = NEW.employee_id
      AND employee.organization_id = NEW.organization_id
  ) THEN
    RAISE EXCEPTION 'attendance correction request and employee must belong to the same organization';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM users requester
    WHERE requester.id = NEW.requested_by_user_id
      AND requester.organization_id = NEW.organization_id
  ) THEN
    RAISE EXCEPTION 'attendance correction requester must belong to the same organization';
  END IF;
  IF NEW.reviewer_user_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM users reviewer
    WHERE reviewer.id = NEW.reviewer_user_id
      AND reviewer.organization_id = NEW.organization_id
  ) THEN
    RAISE EXCEPTION 'attendance correction reviewer must belong to the same organization';
  END IF;
  IF NEW.attendance_day_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM attendance_days day
    WHERE day.id = NEW.attendance_day_id
      AND day.organization_id = NEW.organization_id
      AND day.employee_id = NEW.employee_id
      AND day.work_date = NEW.work_date
  ) THEN
    RAISE EXCEPTION 'attendance correction request must match its attendance day';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER attendance_correction_requests_organization_boundary
BEFORE INSERT OR UPDATE ON "attendance_correction_requests"
FOR EACH ROW EXECUTE FUNCTION enforce_attendance_correction_request_organization();--> statement-breakpoint
CREATE FUNCTION enforce_attendance_correction_entry_reference() RETURNS trigger AS $$
BEGIN
  IF NEW.original_event_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM attendance_correction_requests request
    JOIN attendance_events event ON event.id = NEW.original_event_id
    JOIN attendance_days day ON day.id = event.attendance_day_id
    WHERE request.id = NEW.request_id
      AND event.organization_id = request.organization_id
      AND event.employee_id = request.employee_id
      AND day.work_date = request.work_date
  ) THEN
    RAISE EXCEPTION 'attendance correction entry must reference an event from the same employee work date';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER attendance_correction_entries_reference_boundary
BEFORE INSERT OR UPDATE ON "attendance_correction_entries"
FOR EACH ROW EXECUTE FUNCTION enforce_attendance_correction_entry_reference();--> statement-breakpoint
CREATE OR REPLACE FUNCTION enforce_attendance_event_organization() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM attendance_days day
    WHERE day.id = NEW.attendance_day_id
      AND day.organization_id = NEW.organization_id
      AND day.employee_id = NEW.employee_id
  ) THEN
    RAISE EXCEPTION 'attendance event must match its attendance day organization and employee';
  END IF;
  IF NEW.correction_request_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM attendance_correction_requests request
    JOIN attendance_days day ON day.id = NEW.attendance_day_id
    WHERE request.id = NEW.correction_request_id
      AND request.organization_id = NEW.organization_id
      AND request.employee_id = NEW.employee_id
      AND request.work_date = day.work_date
  ) THEN
    RAISE EXCEPTION 'attendance event correction request must match its employee work date';
  END IF;
  IF NEW.superseded_by_correction_request_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM attendance_correction_requests request
    JOIN attendance_days day ON day.id = NEW.attendance_day_id
    WHERE request.id = NEW.superseded_by_correction_request_id
      AND request.organization_id = NEW.organization_id
      AND request.employee_id = NEW.employee_id
      AND request.work_date = day.work_date
  ) THEN
    RAISE EXCEPTION 'superseding correction request must match its employee work date';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
