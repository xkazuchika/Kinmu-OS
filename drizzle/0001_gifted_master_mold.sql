CREATE TYPE "public"."employee_status" AS ENUM('scheduled', 'active', 'on_leave', 'terminated');--> statement-breakpoint
CREATE TYPE "public"."employment_type" AS ENUM('full_time', 'part_time', 'contract', 'other');--> statement-breakpoint
CREATE TABLE "departments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employee_departments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"department_id" uuid NOT NULL,
	"is_primary" boolean DEFAULT true NOT NULL,
	"started_on" date NOT NULL,
	"ended_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employee_status_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"status" "employee_status" NOT NULL,
	"effective_on" date NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid,
	"employee_number" text NOT NULL,
	"family_name" text NOT NULL,
	"given_name" text NOT NULL,
	"contact_email" text,
	"phone_number" text,
	"employment_type" "employment_type" DEFAULT 'full_time' NOT NULL,
	"status" "employee_status" DEFAULT 'scheduled' NOT NULL,
	"joined_on" date,
	"left_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_departments" ADD CONSTRAINT "employee_departments_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_departments" ADD CONSTRAINT "employee_departments_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_status_history" ADD CONSTRAINT "employee_status_history_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "departments_organization_code_unique" ON "departments" USING btree ("organization_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "departments_organization_name_unique" ON "departments" USING btree ("organization_id","name");--> statement-breakpoint
CREATE INDEX "employee_departments_employee_index" ON "employee_departments" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "employee_departments_department_index" ON "employee_departments" USING btree ("department_id");--> statement-breakpoint
CREATE INDEX "employee_status_history_employee_date_index" ON "employee_status_history" USING btree ("employee_id","effective_on");--> statement-breakpoint
CREATE UNIQUE INDEX "employees_organization_number_unique" ON "employees" USING btree ("organization_id","employee_number");--> statement-breakpoint
CREATE UNIQUE INDEX "employees_user_unique" ON "employees" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "employees_organization_status_index" ON "employees" USING btree ("organization_id","status");