ALTER TYPE "public"."audit_action" ADD VALUE 'work_calendar_changed' BEFORE 'csv_imported';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'work_calendar_activated' BEFORE 'csv_imported';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'leave_type_changed' BEFORE 'csv_imported';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'leave_balance_changed' BEFORE 'csv_imported';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'leave_requested' BEFORE 'csv_imported';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'leave_request_cancelled' BEFORE 'csv_imported';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'leave_request_approved' BEFORE 'csv_imported';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'leave_request_rejected' BEFORE 'csv_imported';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'absence_changed' BEFORE 'csv_imported';