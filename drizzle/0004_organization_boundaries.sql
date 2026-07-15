CREATE FUNCTION enforce_employee_department_organization() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM employees employee
    JOIN departments department ON department.id = NEW.department_id
    WHERE employee.id = NEW.employee_id
      AND employee.organization_id = department.organization_id
  ) THEN
    RAISE EXCEPTION 'employee and department must belong to the same organization';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER employee_departments_organization_boundary
BEFORE INSERT OR UPDATE ON "employee_departments"
FOR EACH ROW EXECUTE FUNCTION enforce_employee_department_organization();
--> statement-breakpoint
CREATE FUNCTION enforce_work_rule_organization() RETURNS trigger AS $$
BEGIN
  IF NEW.employee_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM employees employee
    WHERE employee.id = NEW.employee_id
      AND employee.organization_id = NEW.organization_id
  ) THEN
    RAISE EXCEPTION 'work rule and employee must belong to the same organization';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER work_rules_organization_boundary
BEFORE INSERT OR UPDATE ON "work_rules"
FOR EACH ROW EXECUTE FUNCTION enforce_work_rule_organization();
--> statement-breakpoint
CREATE FUNCTION enforce_attendance_day_organization() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM employees employee
    WHERE employee.id = NEW.employee_id
      AND employee.organization_id = NEW.organization_id
  ) THEN
    RAISE EXCEPTION 'attendance day and employee must belong to the same organization';
  END IF;
  IF NEW.work_rule_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM work_rules rule
    WHERE rule.id = NEW.work_rule_id
      AND rule.organization_id = NEW.organization_id
      AND (rule.employee_id IS NULL OR rule.employee_id = NEW.employee_id)
  ) THEN
    RAISE EXCEPTION 'attendance day has an incompatible work rule';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER attendance_days_organization_boundary
BEFORE INSERT OR UPDATE ON "attendance_days"
FOR EACH ROW EXECUTE FUNCTION enforce_attendance_day_organization();
--> statement-breakpoint
CREATE FUNCTION enforce_attendance_event_organization() RETURNS trigger AS $$
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
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER attendance_events_organization_boundary
BEFORE INSERT OR UPDATE ON "attendance_events"
FOR EACH ROW EXECUTE FUNCTION enforce_attendance_event_organization();
--> statement-breakpoint
CREATE FUNCTION enforce_audit_log_organization() RETURNS trigger AS $$
BEGIN
  IF NEW.actor_user_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM users actor
    WHERE actor.id = NEW.actor_user_id
      AND actor.organization_id = NEW.organization_id
  ) THEN
    RAISE EXCEPTION 'audit actor must belong to the audit log organization';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER audit_logs_organization_boundary
BEFORE INSERT ON "audit_logs"
FOR EACH ROW EXECUTE FUNCTION enforce_audit_log_organization();
