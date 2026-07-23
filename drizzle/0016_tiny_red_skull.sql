CREATE TYPE "public"."payroll_export_encoding" AS ENUM('utf8_bom', 'cp932');--> statement-breakpoint
CREATE TYPE "public"."payroll_export_line_ending" AS ENUM('crlf', 'lf');--> statement-breakpoint
CREATE TYPE "public"."payroll_export_run_kind" AS ENUM('generated', 'regenerated');--> statement-breakpoint
CREATE TYPE "public"."payroll_profile_status" AS ENUM('draft', 'published', 'archived');--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'payroll_profile_created' BEFORE 'csv_imported';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'payroll_profile_changed' BEFORE 'csv_imported';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'payroll_profile_published' BEFORE 'csv_imported';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'payroll_profile_archived' BEFORE 'csv_imported';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'payroll_profile_imported' BEFORE 'csv_imported';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'payroll_profile_exported' BEFORE 'csv_imported';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'payroll_employee_mapping_changed' BEFORE 'csv_imported';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'payroll_employee_mappings_imported' BEFORE 'csv_imported';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'payroll_export_validated' BEFORE 'csv_imported';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'payroll_export_generated' BEFORE 'csv_imported';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'payroll_export_regenerated' BEFORE 'csv_imported';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'payroll_export_downloaded' BEFORE 'csv_imported';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'payroll_export_integrity_failed' BEFORE 'csv_imported';--> statement-breakpoint
CREATE TABLE "payroll_employee_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"external_employee_code" text NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"updated_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payroll_employee_mappings_code_not_blank" CHECK (length(trim("payroll_employee_mappings"."external_employee_code")) > 0),
	CONSTRAINT "payroll_employee_mappings_code_length" CHECK (length("payroll_employee_mappings"."external_employee_code") <= 128),
	CONSTRAINT "payroll_employee_mappings_version_nonnegative" CHECK ("payroll_employee_mappings"."version" >= 0)
);
--> statement-breakpoint
CREATE TABLE "payroll_export_profile_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"schema_version" integer NOT NULL,
	"encoding" "payroll_export_encoding" NOT NULL,
	"line_ending" "payroll_export_line_ending" NOT NULL,
	"config_snapshot" jsonb NOT NULL,
	"config_hash" text NOT NULL,
	"published_by_user_id" uuid NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payroll_export_profile_versions_version_positive" CHECK ("payroll_export_profile_versions"."version" > 0),
	CONSTRAINT "payroll_export_profile_versions_schema_version_positive" CHECK ("payroll_export_profile_versions"."schema_version" > 0),
	CONSTRAINT "payroll_export_profile_versions_config_size" CHECK (octet_length("payroll_export_profile_versions"."config_snapshot"::text) <= 262144),
	CONSTRAINT "payroll_export_profile_versions_hash_format" CHECK ("payroll_export_profile_versions"."config_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "payroll_export_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"draft_config" jsonb NOT NULL,
	"status" "payroll_profile_status" DEFAULT 'draft' NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"created_by_user_id" uuid,
	"updated_by_user_id" uuid,
	"archived_by_user_id" uuid,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payroll_export_profiles_name_not_blank" CHECK (length(trim("payroll_export_profiles"."name")) > 0),
	CONSTRAINT "payroll_export_profiles_name_length" CHECK (length("payroll_export_profiles"."name") <= 120),
	CONSTRAINT "payroll_export_profiles_description_length" CHECK (length("payroll_export_profiles"."description") <= 1000),
	CONSTRAINT "payroll_export_profiles_version_nonnegative" CHECK ("payroll_export_profiles"."version" >= 0),
	CONSTRAINT "payroll_export_profiles_config_size" CHECK (octet_length("payroll_export_profiles"."draft_config"::text) <= 262144),
	CONSTRAINT "payroll_export_profiles_archive_complete" CHECK (("payroll_export_profiles"."status" = 'archived' AND "payroll_export_profiles"."archived_at" IS NOT NULL) OR ("payroll_export_profiles"."status" <> 'archived' AND "payroll_export_profiles"."archived_at" IS NULL AND "payroll_export_profiles"."archived_by_user_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "payroll_export_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"period_id" uuid NOT NULL,
	"attendance_revision_id" uuid NOT NULL,
	"profile_version_id" uuid NOT NULL,
	"kind" "payroll_export_run_kind" DEFAULT 'generated' NOT NULL,
	"source_run_id" uuid,
	"target_month" text NOT NULL,
	"attendance_revision" integer NOT NULL,
	"manifest" jsonb NOT NULL,
	"validation_summary" jsonb NOT NULL,
	"generator_version" integer NOT NULL,
	"row_count" integer NOT NULL,
	"column_count" integer NOT NULL,
	"byte_count" integer NOT NULL,
	"sha256" text NOT NULL,
	"generated_by_user_id" uuid NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payroll_export_runs_month_format" CHECK ("payroll_export_runs"."target_month" ~ '^[0-9]{4}-[0-9]{2}$'),
	CONSTRAINT "payroll_export_runs_attendance_revision_positive" CHECK ("payroll_export_runs"."attendance_revision" > 0),
	CONSTRAINT "payroll_export_runs_generator_version_positive" CHECK ("payroll_export_runs"."generator_version" > 0),
	CONSTRAINT "payroll_export_runs_row_count_nonnegative" CHECK ("payroll_export_runs"."row_count" >= 0),
	CONSTRAINT "payroll_export_runs_column_count_positive" CHECK ("payroll_export_runs"."column_count" > 0),
	CONSTRAINT "payroll_export_runs_byte_count_positive" CHECK ("payroll_export_runs"."byte_count" > 0),
	CONSTRAINT "payroll_export_runs_sha256_format" CHECK ("payroll_export_runs"."sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "payroll_export_runs_manifest_size" CHECK (octet_length("payroll_export_runs"."manifest"::text) <= 1048576),
	CONSTRAINT "payroll_export_runs_regenerated_source" CHECK (("payroll_export_runs"."kind" = 'generated' AND "payroll_export_runs"."source_run_id" IS NULL) OR ("payroll_export_runs"."kind" = 'regenerated' AND "payroll_export_runs"."source_run_id" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "payroll_employee_mappings" ADD CONSTRAINT "payroll_employee_mappings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_employee_mappings" ADD CONSTRAINT "payroll_employee_mappings_profile_id_payroll_export_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."payroll_export_profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_employee_mappings" ADD CONSTRAINT "payroll_employee_mappings_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_employee_mappings" ADD CONSTRAINT "payroll_employee_mappings_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_export_profile_versions" ADD CONSTRAINT "payroll_export_profile_versions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_export_profile_versions" ADD CONSTRAINT "payroll_export_profile_versions_profile_id_payroll_export_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."payroll_export_profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_export_profile_versions" ADD CONSTRAINT "payroll_export_profile_versions_published_by_user_id_users_id_fk" FOREIGN KEY ("published_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_export_profiles" ADD CONSTRAINT "payroll_export_profiles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_export_profiles" ADD CONSTRAINT "payroll_export_profiles_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_export_profiles" ADD CONSTRAINT "payroll_export_profiles_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_export_profiles" ADD CONSTRAINT "payroll_export_profiles_archived_by_user_id_users_id_fk" FOREIGN KEY ("archived_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_export_runs" ADD CONSTRAINT "payroll_export_runs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_export_runs" ADD CONSTRAINT "payroll_export_runs_period_id_attendance_month_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."attendance_month_periods"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_export_runs" ADD CONSTRAINT "payroll_export_runs_attendance_revision_id_attendance_month_revisions_id_fk" FOREIGN KEY ("attendance_revision_id") REFERENCES "public"."attendance_month_revisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_export_runs" ADD CONSTRAINT "payroll_export_runs_profile_version_id_payroll_export_profile_versions_id_fk" FOREIGN KEY ("profile_version_id") REFERENCES "public"."payroll_export_profile_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_export_runs" ADD CONSTRAINT "payroll_export_runs_source_run_id_payroll_export_runs_id_fk" FOREIGN KEY ("source_run_id") REFERENCES "public"."payroll_export_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_export_runs" ADD CONSTRAINT "payroll_export_runs_generated_by_user_id_users_id_fk" FOREIGN KEY ("generated_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_employee_mappings_org_profile_employee_unique" ON "payroll_employee_mappings" USING btree ("organization_id","profile_id","employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_employee_mappings_org_profile_code_unique" ON "payroll_employee_mappings" USING btree ("organization_id","profile_id","external_employee_code");--> statement-breakpoint
CREATE INDEX "payroll_employee_mappings_org_profile_updated_idx" ON "payroll_employee_mappings" USING btree ("organization_id","profile_id","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_export_profile_versions_profile_version_unique" ON "payroll_export_profile_versions" USING btree ("profile_id","version");--> statement-breakpoint
CREATE INDEX "payroll_export_profile_versions_org_profile_published_idx" ON "payroll_export_profile_versions" USING btree ("organization_id","profile_id","published_at");--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_export_profiles_org_name_active_unique" ON "payroll_export_profiles" USING btree ("organization_id","name") WHERE "payroll_export_profiles"."status" <> 'archived';--> statement-breakpoint
CREATE INDEX "payroll_export_profiles_org_status_updated_idx" ON "payroll_export_profiles" USING btree ("organization_id","status","updated_at");--> statement-breakpoint
CREATE INDEX "payroll_export_runs_org_month_generated_idx" ON "payroll_export_runs" USING btree ("organization_id","target_month","generated_at");--> statement-breakpoint
CREATE INDEX "payroll_export_runs_revision_generated_idx" ON "payroll_export_runs" USING btree ("attendance_revision_id","generated_at");--> statement-breakpoint
CREATE INDEX "payroll_export_runs_profile_version_idx" ON "payroll_export_runs" USING btree ("profile_version_id");
--> statement-breakpoint
CREATE FUNCTION enforce_v06_payroll_organization_boundary() RETURNS trigger AS $$
BEGIN
  IF TG_TABLE_NAME = 'payroll_export_profiles' THEN
    IF NEW.created_by_user_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM users actor
      WHERE actor.id = NEW.created_by_user_id
        AND actor.organization_id = NEW.organization_id
    ) THEN
      RAISE EXCEPTION 'payroll profile creator must belong to the profile organization';
    END IF;
    IF NEW.updated_by_user_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM users actor
      WHERE actor.id = NEW.updated_by_user_id
        AND actor.organization_id = NEW.organization_id
    ) THEN
      RAISE EXCEPTION 'payroll profile updater must belong to the profile organization';
    END IF;
    IF NEW.archived_by_user_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM users actor
      WHERE actor.id = NEW.archived_by_user_id
        AND actor.organization_id = NEW.organization_id
    ) THEN
      RAISE EXCEPTION 'payroll profile archiver must belong to the profile organization';
    END IF;
  ELSIF TG_TABLE_NAME = 'payroll_export_profile_versions' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM payroll_export_profiles profile
      JOIN users publisher ON publisher.id = NEW.published_by_user_id
      WHERE profile.id = NEW.profile_id
        AND profile.organization_id = NEW.organization_id
        AND publisher.organization_id = NEW.organization_id
    ) THEN
      RAISE EXCEPTION 'payroll profile version references must belong to its organization';
    END IF;
  ELSIF TG_TABLE_NAME = 'payroll_employee_mappings' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM payroll_export_profiles profile
      JOIN employees employee ON employee.id = NEW.employee_id
      WHERE profile.id = NEW.profile_id
        AND profile.organization_id = NEW.organization_id
        AND employee.organization_id = NEW.organization_id
    ) THEN
      RAISE EXCEPTION 'payroll employee mapping references must belong to its organization';
    END IF;
    IF NEW.updated_by_user_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM users actor
      WHERE actor.id = NEW.updated_by_user_id
        AND actor.organization_id = NEW.organization_id
    ) THEN
      RAISE EXCEPTION 'payroll employee mapping updater must belong to its organization';
    END IF;
  ELSIF TG_TABLE_NAME = 'payroll_export_runs' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM attendance_month_periods period
      JOIN attendance_month_revisions revision ON revision.id = NEW.attendance_revision_id
      JOIN payroll_export_profile_versions profile_version ON profile_version.id = NEW.profile_version_id
      JOIN users generator ON generator.id = NEW.generated_by_user_id
      WHERE period.id = NEW.period_id
        AND period.organization_id = NEW.organization_id
        AND period.target_month = NEW.target_month
        AND revision.period_id = period.id
        AND revision.organization_id = NEW.organization_id
        AND revision.target_month = NEW.target_month
        AND revision.revision = NEW.attendance_revision
        AND profile_version.organization_id = NEW.organization_id
        AND generator.organization_id = NEW.organization_id
    ) THEN
      RAISE EXCEPTION 'payroll export run references must belong to its organization, month, and revision';
    END IF;
    IF NEW.source_run_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM payroll_export_runs source_run
      WHERE source_run.id = NEW.source_run_id
        AND source_run.organization_id = NEW.organization_id
    ) THEN
      RAISE EXCEPTION 'payroll export source run must belong to its organization';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER payroll_export_profiles_organization_boundary
BEFORE INSERT OR UPDATE ON "payroll_export_profiles"
FOR EACH ROW EXECUTE FUNCTION enforce_v06_payroll_organization_boundary();
--> statement-breakpoint
CREATE TRIGGER payroll_export_profile_versions_organization_boundary
BEFORE INSERT OR UPDATE ON "payroll_export_profile_versions"
FOR EACH ROW EXECUTE FUNCTION enforce_v06_payroll_organization_boundary();
--> statement-breakpoint
CREATE TRIGGER payroll_employee_mappings_organization_boundary
BEFORE INSERT OR UPDATE ON "payroll_employee_mappings"
FOR EACH ROW EXECUTE FUNCTION enforce_v06_payroll_organization_boundary();
--> statement-breakpoint
CREATE TRIGGER payroll_export_runs_organization_boundary
BEFORE INSERT OR UPDATE ON "payroll_export_runs"
FOR EACH ROW EXECUTE FUNCTION enforce_v06_payroll_organization_boundary();
--> statement-breakpoint
CREATE FUNCTION prevent_payroll_immutable_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER payroll_export_profile_versions_immutable
BEFORE UPDATE OR DELETE ON "payroll_export_profile_versions"
FOR EACH ROW EXECUTE FUNCTION prevent_payroll_immutable_mutation();
--> statement-breakpoint
CREATE TRIGGER payroll_export_runs_immutable
BEFORE UPDATE OR DELETE ON "payroll_export_runs"
FOR EACH ROW EXECUTE FUNCTION prevent_payroll_immutable_mutation();
--> statement-breakpoint
INSERT INTO "payroll_export_profiles" (
  "organization_id",
  "name",
  "description",
  "draft_config",
  "status"
)
SELECT
  organization.id,
  '汎用給与連携',
  '締め済み勤怠を一人一行で出力する未公開の標準ドラフト',
  '{
    "schemaVersion": 1,
    "encoding": "utf8_bom",
    "lineEnding": "crlf",
    "fileNamePattern": "kinmu-payroll-{targetMonth}-r{revision}.csv",
    "columns": [
      {"id":"external_employee_code","header":"従業員コード","source":{"kind":"field","field":"external_employee_code"},"transform":{"kind":"text"},"required":true,"formulaPolicy":"reject","maxLength":128},
      {"id":"employee_number","header":"Kinmu従業員番号","source":{"kind":"field","field":"employee_number"},"transform":{"kind":"text"},"required":true,"formulaPolicy":"reject"},
      {"id":"display_name","header":"氏名","source":{"kind":"field","field":"display_name"},"transform":{"kind":"text"},"required":true,"formulaPolicy":"reject"},
      {"id":"scheduled_minutes","header":"所定時間（分）","source":{"kind":"field","field":"scheduled_minutes"},"transform":{"kind":"minutes"},"required":true,"formulaPolicy":"reject"},
      {"id":"worked_minutes","header":"実働時間（分）","source":{"kind":"field","field":"worked_minutes"},"transform":{"kind":"minutes"},"required":true,"formulaPolicy":"reject"},
      {"id":"overtime_minutes","header":"残業時間（分）","source":{"kind":"field","field":"overtime_minutes"},"transform":{"kind":"minutes"},"required":true,"formulaPolicy":"reject"},
      {"id":"leave_units","header":"休暇単位","source":{"kind":"field","field":"leave_units"},"transform":{"kind":"integer"},"required":true,"formulaPolicy":"reject"},
      {"id":"absence_days","header":"欠勤日数","source":{"kind":"field","field":"absence_days"},"transform":{"kind":"integer"},"required":true,"formulaPolicy":"reject"}
    ]
  }'::jsonb,
  'draft'
FROM organizations organization
WHERE NOT EXISTS (
  SELECT 1 FROM payroll_export_profiles profile
  WHERE profile.organization_id = organization.id
    AND profile.name = '汎用給与連携'
    AND profile.status <> 'archived'
);
