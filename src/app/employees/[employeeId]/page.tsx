import { cookies } from "next/headers";
import { and, asc, eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";

import { EmployeeEditor, type EditableEmployee } from "@/components/employee-editor";
import { sessionForToken, SESSION_COOKIE_NAME } from "@/lib/auth";
import { can } from "@/lib/authorization";
import { listDepartments } from "@/lib/departments";
import { getDatabase } from "@/lib/db/client";
import { EmployeeManagementError, getEmployeeDetails } from "@/lib/employees";
import { users } from "@/lib/db/schema";

export default async function EmployeeDetailsPage({
  params,
}: {
  params: Promise<{ employeeId: string }>;
}) {
  const database = getDatabase();
  const cookieStore = await cookies();
  const actor = await sessionForToken(database, cookieStore.get(SESSION_COOKIE_NAME)?.value);

  if (!actor) redirect("/login");
  if (!can(actor, "employees:manage")) redirect("/");

  const { employeeId } = await params;

  let result;

  try {
    result = await Promise.all([
      getEmployeeDetails(database, { employeeId, organizationId: actor.organizationId }),
      listDepartments(database, actor.organizationId),
      database
        .select({ displayName: users.displayName, email: users.email, id: users.id })
        .from(users)
        .where(and(eq(users.organizationId, actor.organizationId), eq(users.role, "employee")))
        .orderBy(asc(users.displayName)),
    ]);
  } catch (error) {
    if (error instanceof EmployeeManagementError) notFound();
    throw error;
  }

  const [employee, departments, employeeUsers] = result;
  const editableEmployee: EditableEmployee = {
    contactEmail: employee.contactEmail,
    displayName: employee.displayName,
    employeeNumber: employee.employeeNumber,
    employmentType: employee.employmentType,
    familyName: employee.familyName,
    givenName: employee.givenName,
    phoneNumber: employee.phoneNumber,
    primaryDepartment: employee.primaryDepartment,
    status: employee.status,
    statusHistory: employee.statusHistory,
    userId: employee.userId,
  };

  return (
    <EmployeeEditor
      departments={departments.filter((department) => department.active)}
      employee={editableEmployee}
      employeeId={employeeId}
      employeeUsers={employeeUsers}
    />
  );
}
