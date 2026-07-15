import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { AttendanceCorrectionReview } from "@/components/attendance-correction-review";
import { listManagedAttendanceCorrections } from "@/lib/attendance-corrections";
import { sessionForToken, SESSION_COOKIE_NAME } from "@/lib/auth";
import { getDatabase } from "@/lib/db/client";
import { listEmployees } from "@/lib/employees";

export default async function AttendanceCorrectionsPage({
  searchParams,
}: {
  searchParams: Promise<{ employeeId?: string; from?: string; status?: string; to?: string }>;
}) {
  const database = getDatabase();
  const cookieStore = await cookies();
  const actor = await sessionForToken(database, cookieStore.get(SESSION_COOKIE_NAME)?.value);
  if (!actor) redirect("/login");
  const filters = await searchParams;
  const status = filters.status ?? "pending";
  const [requests, employees] = await Promise.all([
    listManagedAttendanceCorrections(database, actor, { ...filters, status }),
    listEmployees(database, { organizationId: actor.organizationId, status: "all" }),
  ]);
  return (
    <AttendanceCorrectionReview
      initialEmployees={employees}
      initialRequests={requests.map((request) => ({
        ...request,
        createdAt: request.createdAt.toISOString(),
      }))}
      initialStatus={status}
    />
  );
}
