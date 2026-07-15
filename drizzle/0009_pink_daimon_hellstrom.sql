DROP INDEX "attendance_correction_requests_organization_status_created_index";--> statement-breakpoint
DROP INDEX "attendance_correction_requests_employee_date_index";--> statement-breakpoint
DROP INDEX "attendance_correction_requests_day_index";--> statement-breakpoint
DROP INDEX "attendance_correction_requests_requester_index";--> statement-breakpoint
DROP INDEX "attendance_correction_requests_reviewer_index";--> statement-breakpoint
CREATE INDEX "attendance_corrections_org_status_created_idx" ON "attendance_correction_requests" USING btree ("organization_id","status","created_at");--> statement-breakpoint
CREATE INDEX "attendance_corrections_employee_date_idx" ON "attendance_correction_requests" USING btree ("employee_id","work_date","created_at");--> statement-breakpoint
CREATE INDEX "attendance_corrections_day_idx" ON "attendance_correction_requests" USING btree ("attendance_day_id");--> statement-breakpoint
CREATE INDEX "attendance_corrections_requester_idx" ON "attendance_correction_requests" USING btree ("requested_by_user_id");--> statement-breakpoint
CREATE INDEX "attendance_corrections_reviewer_idx" ON "attendance_correction_requests" USING btree ("reviewer_user_id");