ALTER TYPE "public"."notification_kind" ADD VALUE 'action_items_reminder' BEFORE 'overtime_request_submitted';--> statement-breakpoint

CREATE FUNCTION enforce_notification_organization_boundary() RETURNS trigger AS $$
BEGIN
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
    ELSIF NEW.entity_type = 'action_center' THEN
      IF NEW.entity_id <> NEW.recipient_user_id OR NEW.kind::text <> 'action_items_reminder' THEN
        RAISE EXCEPTION 'action reminder must target its recipient';
      END IF;
    ELSE
      RAISE EXCEPTION 'notification target type is not supported';
    END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

DROP TRIGGER notifications_organization_boundary ON notifications;--> statement-breakpoint
CREATE TRIGGER notifications_organization_boundary
BEFORE INSERT OR UPDATE ON notifications
FOR EACH ROW EXECUTE FUNCTION enforce_notification_organization_boundary();
