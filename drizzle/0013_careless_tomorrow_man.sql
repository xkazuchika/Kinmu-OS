ALTER TABLE "import_batches" ADD COLUMN "result_summary" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_status_details_valid" CHECK (("leave_requests"."status" = 'pending' AND "leave_requests"."reviewer_user_id" IS NULL AND "leave_requests"."reviewed_at" IS NULL AND "leave_requests"."cancelled_at" IS NULL) OR ("leave_requests"."status" = 'approved' AND "leave_requests"."reviewer_user_id" IS NOT NULL AND "leave_requests"."reviewed_at" IS NOT NULL AND "leave_requests"."cancelled_at" IS NULL) OR ("leave_requests"."status" = 'rejected' AND "leave_requests"."reviewer_user_id" IS NOT NULL AND "leave_requests"."reviewed_at" IS NOT NULL AND length(trim("leave_requests"."review_comment")) > 0 AND "leave_requests"."cancelled_at" IS NULL) OR ("leave_requests"."status" = 'cancelled' AND "leave_requests"."reviewer_user_id" IS NULL AND "leave_requests"."reviewed_at" IS NULL AND "leave_requests"."cancelled_at" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "leave_transactions" ADD CONSTRAINT "leave_transactions_references_valid" CHECK (("leave_transactions"."kind" = 'grant' AND "leave_transactions"."grant_lot_id" IS NOT NULL AND "leave_transactions"."request_id" IS NULL AND "leave_transactions"."original_transaction_id" IS NULL) OR ("leave_transactions"."kind" = 'adjustment' AND "leave_transactions"."request_id" IS NULL AND "leave_transactions"."original_transaction_id" IS NULL) OR ("leave_transactions"."kind" = 'consumption' AND "leave_transactions"."grant_lot_id" IS NOT NULL AND "leave_transactions"."request_id" IS NOT NULL AND "leave_transactions"."original_transaction_id" IS NULL) OR ("leave_transactions"."kind" = 'reversal' AND "leave_transactions"."original_transaction_id" IS NOT NULL) OR ("leave_transactions"."kind" = 'expiry' AND "leave_transactions"."grant_lot_id" IS NOT NULL AND "leave_transactions"."request_id" IS NULL AND "leave_transactions"."original_transaction_id" IS NULL));
--> statement-breakpoint
CREATE FUNCTION enforce_v04_organization_boundary() RETURNS trigger AS $$
BEGIN
  IF TG_TABLE_NAME = 'work_calendar_patterns' THEN
    IF NEW.created_by_user_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM users actor
      WHERE actor.id = NEW.created_by_user_id
        AND actor.organization_id = NEW.organization_id
    ) THEN
      RAISE EXCEPTION 'calendar creator must belong to the calendar organization';
    END IF;
    IF NEW.activated_by_user_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM users actor
      WHERE actor.id = NEW.activated_by_user_id
        AND actor.organization_id = NEW.organization_id
    ) THEN
      RAISE EXCEPTION 'calendar activator must belong to the calendar organization';
    END IF;
  ELSIF TG_TABLE_NAME = 'work_calendar_date_exceptions' THEN
    IF NEW.employee_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM employees employee
      WHERE employee.id = NEW.employee_id
        AND employee.organization_id = NEW.organization_id
    ) THEN
      RAISE EXCEPTION 'calendar exception employee must belong to the calendar organization';
    END IF;
    IF NEW.created_by_user_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM users actor
      WHERE actor.id = NEW.created_by_user_id
        AND actor.organization_id = NEW.organization_id
    ) THEN
      RAISE EXCEPTION 'calendar exception creator must belong to the calendar organization';
    END IF;
  ELSIF TG_TABLE_NAME = 'leave_balance_accounts' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM employees employee
      JOIN leave_types leave_type ON leave_type.id = NEW.leave_type_id
      WHERE employee.id = NEW.employee_id
        AND employee.organization_id = NEW.organization_id
        AND leave_type.organization_id = NEW.organization_id
    ) THEN
      RAISE EXCEPTION 'leave account employee and type must belong to the account organization';
    END IF;
  ELSIF TG_TABLE_NAME = 'leave_requests' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM employees employee
      JOIN leave_types leave_type ON leave_type.id = NEW.leave_type_id
      JOIN users requester ON requester.id = NEW.requested_by_user_id
      WHERE employee.id = NEW.employee_id
        AND employee.organization_id = NEW.organization_id
        AND employee.user_id = requester.id
        AND requester.organization_id = NEW.organization_id
        AND leave_type.organization_id = NEW.organization_id
    ) THEN
      RAISE EXCEPTION 'leave request employee, requester, and type must belong to the request organization';
    END IF;
    IF NEW.reviewer_user_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM users reviewer
      WHERE reviewer.id = NEW.reviewer_user_id
        AND reviewer.organization_id = NEW.organization_id
    ) THEN
      RAISE EXCEPTION 'leave reviewer must belong to the request organization';
    END IF;
  ELSIF TG_TABLE_NAME = 'leave_grant_lots' THEN
    IF NOT EXISTS (
      SELECT 1 FROM leave_balance_accounts account
      WHERE account.id = NEW.account_id
        AND account.organization_id = NEW.organization_id
        AND account.employee_id = NEW.employee_id
        AND account.leave_type_id = NEW.leave_type_id
    ) THEN
      RAISE EXCEPTION 'leave grant must match its account organization, employee, and type';
    END IF;
    IF NEW.created_by_user_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM users actor
      WHERE actor.id = NEW.created_by_user_id
        AND actor.organization_id = NEW.organization_id
    ) THEN
      RAISE EXCEPTION 'leave grant creator must belong to the grant organization';
    END IF;
  ELSIF TG_TABLE_NAME = 'leave_transactions' THEN
    IF NOT EXISTS (
      SELECT 1 FROM leave_balance_accounts account
      WHERE account.id = NEW.account_id
        AND account.organization_id = NEW.organization_id
        AND account.employee_id = NEW.employee_id
        AND account.leave_type_id = NEW.leave_type_id
    ) THEN
      RAISE EXCEPTION 'leave transaction must match its account organization, employee, and type';
    END IF;
    IF NEW.grant_lot_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM leave_grant_lots lot
      WHERE lot.id = NEW.grant_lot_id
        AND lot.account_id = NEW.account_id
        AND lot.organization_id = NEW.organization_id
    ) THEN
      RAISE EXCEPTION 'leave transaction grant lot must belong to its account';
    END IF;
    IF NEW.request_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM leave_requests request
      WHERE request.id = NEW.request_id
        AND request.organization_id = NEW.organization_id
        AND request.employee_id = NEW.employee_id
        AND request.leave_type_id = NEW.leave_type_id
    ) THEN
      RAISE EXCEPTION 'leave transaction request must match its organization, employee, and type';
    END IF;
    IF NEW.original_transaction_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM leave_transactions original
      WHERE original.id = NEW.original_transaction_id
        AND original.account_id = NEW.account_id
        AND original.organization_id = NEW.organization_id
    ) THEN
      RAISE EXCEPTION 'leave transaction original must belong to its account';
    END IF;
    IF NEW.created_by_user_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM users actor
      WHERE actor.id = NEW.created_by_user_id
        AND actor.organization_id = NEW.organization_id
    ) THEN
      RAISE EXCEPTION 'leave transaction creator must belong to the transaction organization';
    END IF;
  ELSIF TG_TABLE_NAME = 'absence_records' THEN
    IF NOT EXISTS (
      SELECT 1 FROM employees employee
      WHERE employee.id = NEW.employee_id
        AND employee.organization_id = NEW.organization_id
    ) THEN
      RAISE EXCEPTION 'absence employee must belong to the absence organization';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM users actor
      WHERE actor.id = NEW.confirmed_by_user_id
        AND actor.organization_id = NEW.organization_id
    ) THEN
      RAISE EXCEPTION 'absence confirmer must belong to the absence organization';
    END IF;
    IF NEW.revoked_by_user_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM users actor
      WHERE actor.id = NEW.revoked_by_user_id
        AND actor.organization_id = NEW.organization_id
    ) THEN
      RAISE EXCEPTION 'absence revoker must belong to the absence organization';
    END IF;
  ELSIF TG_TABLE_NAME = 'import_batches' THEN
    IF NOT EXISTS (
      SELECT 1 FROM users actor
      WHERE actor.id = NEW.created_by_user_id
        AND actor.organization_id = NEW.organization_id
    ) THEN
      RAISE EXCEPTION 'import creator must belong to the import organization';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER work_calendar_patterns_organization_boundary
BEFORE INSERT OR UPDATE ON "work_calendar_patterns"
FOR EACH ROW EXECUTE FUNCTION enforce_v04_organization_boundary();
--> statement-breakpoint
CREATE TRIGGER work_calendar_date_exceptions_organization_boundary
BEFORE INSERT OR UPDATE ON "work_calendar_date_exceptions"
FOR EACH ROW EXECUTE FUNCTION enforce_v04_organization_boundary();
--> statement-breakpoint
CREATE TRIGGER leave_balance_accounts_organization_boundary
BEFORE INSERT OR UPDATE ON "leave_balance_accounts"
FOR EACH ROW EXECUTE FUNCTION enforce_v04_organization_boundary();
--> statement-breakpoint
CREATE TRIGGER leave_requests_organization_boundary
BEFORE INSERT OR UPDATE ON "leave_requests"
FOR EACH ROW EXECUTE FUNCTION enforce_v04_organization_boundary();
--> statement-breakpoint
CREATE TRIGGER leave_grant_lots_organization_boundary
BEFORE INSERT OR UPDATE ON "leave_grant_lots"
FOR EACH ROW EXECUTE FUNCTION enforce_v04_organization_boundary();
--> statement-breakpoint
CREATE TRIGGER leave_transactions_organization_boundary
BEFORE INSERT ON "leave_transactions"
FOR EACH ROW EXECUTE FUNCTION enforce_v04_organization_boundary();
--> statement-breakpoint
CREATE TRIGGER absence_records_organization_boundary
BEFORE INSERT OR UPDATE ON "absence_records"
FOR EACH ROW EXECUTE FUNCTION enforce_v04_organization_boundary();
--> statement-breakpoint
CREATE TRIGGER import_batches_organization_boundary
BEFORE INSERT ON "import_batches"
FOR EACH ROW EXECUTE FUNCTION enforce_v04_organization_boundary();
--> statement-breakpoint
CREATE FUNCTION prevent_leave_ledger_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'leave ledger rows are append-only';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER leave_grant_lots_append_only
BEFORE UPDATE OR DELETE ON "leave_grant_lots"
FOR EACH ROW EXECUTE FUNCTION prevent_leave_ledger_mutation();
--> statement-breakpoint
CREATE TRIGGER leave_transactions_append_only
BEFORE UPDATE OR DELETE ON "leave_transactions"
FOR EACH ROW EXECUTE FUNCTION prevent_leave_ledger_mutation();
--> statement-breakpoint
CREATE FUNCTION enforce_leave_request_transition() RETURNS trigger AS $$
BEGIN
  IF OLD.status <> NEW.status AND OLD.status <> 'pending' THEN
    RAISE EXCEPTION 'a reviewed or cancelled leave request is final';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER leave_requests_final_state
BEFORE UPDATE ON "leave_requests"
FOR EACH ROW EXECUTE FUNCTION enforce_leave_request_transition();
--> statement-breakpoint
INSERT INTO "work_calendar_patterns" (
  "organization_id",
  "effective_from",
  "status",
  "monday_workday",
  "tuesday_workday",
  "wednesday_workday",
  "thursday_workday",
  "friday_workday",
  "saturday_workday",
  "sunday_workday"
)
SELECT
  organization.id,
  CURRENT_DATE,
  'draft',
  true,
  true,
  true,
  true,
  true,
  false,
  false
FROM organizations organization
ON CONFLICT (organization_id, effective_from) DO NOTHING;
