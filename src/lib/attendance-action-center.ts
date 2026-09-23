import { and, asc, eq, inArray, min } from "drizzle-orm";
import { z } from "zod";

import {
  actionKinds,
  approvalActionKind,
  attendanceActionKind,
  isActionManager,
  returnedReminderEligible,
  type ActionActor,
  type ActionItem,
  type ActionPage,
} from "@/lib/action-item-types";
import { canReviewCase, isSelfReview } from "@/lib/approval-access";
import { projectOperationalAttendanceMonth } from "@/lib/attendance-operations";
import { AuthorizationError } from "@/lib/authorization";
import type { AppDatabase } from "@/lib/db/client";
import {
  approvalCases,
  approvalDelegations,
  attendanceDays,
  attendanceMonthPeriods,
  departments,
  employeeDepartments,
  employees,
  leaveRequestDays,
  organizations,
  users,
  workCalendarPatterns,
} from "@/lib/db/schema";
import { workDateFor } from "@/lib/time";

type ReadDb = Pick<AppDatabase, "select">;
export const actionFiltersSchema = z.object({
  month: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
    .optional(),
  kind: z.enum(actionKinds).optional(),
  employeeId: z.uuid().optional(),
  departmentId: z.uuid().optional(),
  page: z.coerce.number().int().min(1).max(1000000).default(1),
});
export type ActionFilters = z.input<typeof actionFiltersSchema>;

// One organization projection is shared across recipients by the daily worker.
export async function loadActionFacts(db: ReadDb, organizationId: string, now: Date) {
  const [
    organizationRows,
    people,
    members,
    departmentRows,
    memberships,
    cases,
    delegations,
    closedRows,
    calendarStart,
    punchStart,
    leaveDays,
  ] = await Promise.all([
    db.select().from(organizations).where(eq(organizations.id, organizationId)),
    db.select().from(employees).where(eq(employees.organizationId, organizationId)),
    db
      .select({
        id: users.id,
        role: users.role,
        status: users.status,
        displayName: users.displayName,
      })
      .from(users)
      .where(eq(users.organizationId, organizationId)),
    db.select().from(departments).where(eq(departments.organizationId, organizationId)),
    db
      .select({
        employeeId: employeeDepartments.employeeId,
        departmentId: employeeDepartments.departmentId,
        startedOn: employeeDepartments.startedOn,
        endedOn: employeeDepartments.endedOn,
      })
      .from(employeeDepartments)
      .innerJoin(employees, eq(employees.id, employeeDepartments.employeeId))
      .where(
        and(eq(employees.organizationId, organizationId), eq(employeeDepartments.isPrimary, true)),
      )
      .orderBy(asc(employeeDepartments.startedOn), asc(employeeDepartments.id)),
    db
      .select()
      .from(approvalCases)
      .where(
        and(
          eq(approvalCases.organizationId, organizationId),
          inArray(approvalCases.status, ["pending", "returned"]),
        ),
      ),
    db
      .select()
      .from(approvalDelegations)
      .where(eq(approvalDelegations.organizationId, organizationId)),
    db
      .select({ month: attendanceMonthPeriods.targetMonth })
      .from(attendanceMonthPeriods)
      .where(
        and(
          eq(attendanceMonthPeriods.organizationId, organizationId),
          eq(attendanceMonthPeriods.status, "closed"),
        ),
      ),
    db
      .select({ date: min(workCalendarPatterns.effectiveFrom) })
      .from(workCalendarPatterns)
      .where(
        and(
          eq(workCalendarPatterns.organizationId, organizationId),
          eq(workCalendarPatterns.status, "active"),
        ),
      ),
    db
      .select({ date: min(attendanceDays.workDate) })
      .from(attendanceDays)
      .where(eq(attendanceDays.organizationId, organizationId)),
    db
      .select({ caseId: approvalCases.id, date: leaveRequestDays.workDate })
      .from(approvalCases)
      .innerJoin(leaveRequestDays, eq(leaveRequestDays.requestId, approvalCases.leaveRequestId))
      .where(
        and(
          eq(approvalCases.organizationId, organizationId),
          inArray(approvalCases.status, ["pending", "returned"]),
        ),
      ),
  ]);
  const organization = organizationRows[0];
  if (!organization) throw new AuthorizationError();
  const today = workDateFor(now, organization.timezone);
  const closed = new Set(closedRows.map((row) => row.month));
  const first = [calendarStart[0]?.date, punchStart[0]?.date]
    .filter((date): date is string => !!date)
    .sort()[0];
  const days: Awaited<ReturnType<typeof projectOperationalAttendanceMonth>> = [];
  if (first) {
    let month = first.slice(0, 7);
    while (month <= today.slice(0, 7)) {
      if (!closed.has(month)) {
        const projected = await projectOperationalAttendanceMonth(db, { month, organizationId });
        days.push(
          ...projected.filter((day) =>
            attendanceActionKind(day.operationalStatus, day.workDate, today, false),
          ),
        );
      }
      const [year, number] = month.split("-").map(Number);
      month = number === 12 ? `${year + 1}-01` : `${year}-${String(number + 1).padStart(2, "0")}`;
    }
  }
  return {
    organization,
    people,
    members,
    departmentRows,
    memberships,
    cases,
    delegations,
    closed,
    days,
    leaveDays,
    now,
    today,
  };
}
export type ActionFacts = Awaited<ReturnType<typeof loadActionFacts>>;

export function actionItemsFor(facts: ActionFacts, actor: ActionActor, daily = false) {
  const member = facts.members.find(
    (user) => user.id === actor.userId && user.status === "active" && user.role === actor.role,
  );
  if (facts.organization.id !== actor.organizationId || !member) throw new AuthorizationError();
  const manager = isActionManager(actor);
  const items: ActionItem[] = [];
  const people = new Map(facts.people.map((person) => [person.id, person]));
  const members = new Map(facts.members.map((user) => [user.id, user]));
  const departmentNames = new Map(facts.departmentRows.map((row) => [row.id, row.name]));
  const memberships = new Map<string, typeof facts.memberships>();
  for (const row of facts.memberships)
    memberships.set(row.employeeId, [...(memberships.get(row.employeeId) ?? []), row]);
  const caseDates = new Map<string, string[]>();
  for (const row of facts.leaveDays)
    caseDates.set(row.caseId, [...(caseDates.get(row.caseId) ?? []), row.date]);
  const pendingByDay = new Map<string, typeof facts.cases>();
  for (const item of facts.cases) {
    if (item.status !== "pending" || !["leave", "attendance_correction"].includes(item.requestType))
      continue;
    for (const date of caseDates.get(item.id) ?? [item.targetDate]) {
      const key = `${item.targetEmployeeId}:${date}`;
      pendingByDay.set(key, [...(pendingByDay.get(key) ?? []), item]);
    }
  }
  const caseHref = (id: string, own: boolean) => `${own ? "/requests" : "/approvals"}/${id}`;
  for (const day of facts.days) {
    const person = people.get(day.employeeId);
    if (!person || (!manager && person.userId !== actor.userId)) continue;
    const kind = attendanceActionKind(
      day.operationalStatus,
      day.workDate,
      facts.today,
      facts.closed.has(day.workDate.slice(0, 7)),
    );
    if (!kind) continue;
    const department = (memberships.get(person.id) ?? [])
      .filter(
        (row) => row.startedOn <= day.workDate && (!row.endedOn || row.endedOn >= day.workDate),
      )
      .at(-1);
    const pending = pendingByDay.get(`${person.id}:${day.workDate}`) ?? [];
    const own = person.userId === actor.userId;
    const query = new URLSearchParams({ month: day.workDate.slice(0, 7), date: day.workDate });
    if (manager) query.set("employeeId", person.id);
    items.push({
      id: `${kind}:${person.id}:${day.workDate}`,
      kind,
      employeeId: person.id,
      employeeName: person.displayName,
      departmentId: department?.departmentId ?? null,
      departmentName: department ? (departmentNames.get(department.departmentId) ?? null) : null,
      date: day.workDate,
      dueAt: null,
      reason: pending.length
        ? "修正・休暇申請が審査待ちです。承認・反映後に解消します。"
        : kind === "open_punch"
          ? "退勤の記録がありません。勤務実績を確認してください。"
          : "勤務予定に対する実績が未解決です。修正・休暇・欠勤の扱いを確認してください。",
      nextOwner: pending.length ? "承認担当者の対応待ち" : own ? "自分" : "本人の対応待ち",
      actionLabel: pending.length ? "審査待ち申請を確認" : "勤務実績を確認",
      href: pending.length
        ? caseHref(pending[0].id, own)
        : `${manager ? "/attendance" : "/attendance/me"}?${query}`,
      related: pending.length
        ? pending.map((item) => ({ label: "審査待ち申請を確認", href: caseHref(item.id, own) }))
        : manager
          ? [
              {
                label: "代理で修正を申請",
                href: `/approvals/proxy?employeeId=${person.id}&date=${day.workDate}`,
              },
              ...(kind === "unresolved_day"
                ? [
                    {
                      label: "欠勤の扱いを確認",
                      href: `/leave/reviews?employeeId=${person.id}&date=${day.workDate}`,
                    },
                    {
                      label: "代理で休暇を申請",
                      href: `/approvals/proxy?employeeId=${person.id}&date=${day.workDate}&kind=leave`,
                    },
                  ]
                : []),
            ]
          : kind === "unresolved_day"
            ? [{ label: "休暇を申請", href: `/leave?date=${day.workDate}` }]
            : [],
    });
  }
  for (const item of facts.cases) {
    const person = people.get(item.targetEmployeeId);
    if (!person) continue;
    const own = person.userId === actor.userId;
    const kind = approvalActionKind(
      item.status,
      item.dueAt,
      facts.now,
      (caseDates.get(item.id) ?? [item.targetDate]).some((date) =>
        facts.closed.has(date.slice(0, 7)),
      ),
    );
    if (
      !kind ||
      (!manager &&
        !own &&
        !(
          actor.role === "approver" &&
          item.assignedApproverUserId === actor.userId &&
          kind === "overdue_approval"
        ))
    )
      continue;
    const assignee = item.assignedApproverUserId ? members.get(item.assignedApproverUserId) : null;
    const eligible =
      !!assignee &&
      assignee.status === "active" &&
      ["owner", "hr_admin", "approver"].includes(assignee.role) &&
      !isSelfReview(assignee.id, item.submittedByUserId, person.userId);
    const delegationActive =
      item.routeReason !== "delegated" ||
      facts.delegations.some(
        (row) =>
          row.departmentId === item.submittedDepartmentId &&
          row.requestType === item.requestType &&
          row.originalApproverUserId === item.originalApproverUserId &&
          row.delegateApproverUserId === item.assignedApproverUserId &&
          row.startsAt <= facts.now &&
          row.endsAt >= facts.now,
      );
    const needsReassignment = (!!item.assignedApproverUserId && !eligible) || !delegationActive;
    if (daily) {
      if (
        kind === "returned_request" &&
        !returnedReminderEligible(item.reviewedAt, facts.now, facts.organization.timezone)
      )
        continue;
      if (
        !manager &&
        kind === "overdue_approval" &&
        (!canReviewCase(actor, item, person.userId) || needsReassignment)
      )
        continue;
    }
    const review = canReviewCase(actor, item, person.userId) && !needsReassignment;
    items.push({
      id: `${kind}:${item.id}`,
      kind,
      employeeId: person.id,
      employeeName: person.displayName,
      departmentId: item.submittedDepartmentId,
      departmentName: item.submittedDepartmentId
        ? (departmentNames.get(item.submittedDepartmentId) ?? null)
        : null,
      date: item.targetDate,
      dueAt: item.dueAt?.toISOString() ?? null,
      reason:
        kind === "returned_request"
          ? "差し戻し理由を確認し、修正して再申請するか取り消してください。"
          : needsReassignment
            ? "担当者の無効化・引継ぎ終了等により再割当が必要です。"
            : "承認期限を過ぎています。",
      nextOwner:
        kind === "returned_request"
          ? own
            ? "自分"
            : item.submittedOnBehalf
              ? "本人・代理作成者の対応待ち"
              : "本人の対応待ち"
          : needsReassignment
            ? "管理者による再割当"
            : (assignee?.displayName ?? "管理者共通"),
      actionLabel:
        kind === "returned_request"
          ? own
            ? "修正・再申請する"
            : "差し戻し申請を確認"
          : needsReassignment && manager
            ? "担当を確認・再割当"
            : review
              ? "申請を審査"
              : "申請を確認",
      href: caseHref(
        item.id,
        own || (manager && item.submittedOnBehalf && item.submittedByUserId === actor.userId),
      ),
      related: [],
    });
  }
  return items.sort(
    (a, b) =>
      actionKinds.indexOf(a.kind) - actionKinds.indexOf(b.kind) ||
      (a.dueAt ?? a.date).localeCompare(b.dueAt ?? b.date) ||
      a.id.localeCompare(b.id),
  );
}

export async function listActionItems(
  db: AppDatabase,
  actor: ActionActor,
  input: ActionFilters = {},
  now = new Date(),
  summaryOnly = false,
): Promise<ActionPage> {
  const filters = actionFiltersSchema.parse(input);
  return db.transaction(
    async (tx) => {
      const facts = await loadActionFacts(tx, actor.organizationId, now);
      const all = actionItemsFor(facts, actor);
      // Resolved cases remain viewable by their current assignee. Keep their filter
      // choices valid when returning after review, but revoke them on reassignment.
      const assigned =
        actor.role === "approver"
          ? await tx
              .select({
                employeeId: approvalCases.targetEmployeeId,
                departmentId: approvalCases.submittedDepartmentId,
              })
              .from(approvalCases)
              .where(
                and(
                  eq(approvalCases.organizationId, actor.organizationId),
                  eq(approvalCases.assignedApproverUserId, actor.userId),
                ),
              )
          : [];
      const assignedPeople = new Set(assigned.map((item) => item.employeeId));
      const employeeOptions = isActionManager(actor)
        ? facts.people.map((p) => ({ id: p.id, name: p.displayName }))
        : [
            ...new Map([
              ...facts.people
                .filter((p) => p.userId === actor.userId || assignedPeople.has(p.id))
                .map((p) => [p.id, { id: p.id, name: p.displayName }] as const),
              ...all.map(
                (item) =>
                  [item.employeeId, { id: item.employeeId, name: item.employeeName }] as const,
              ),
            ]).values(),
          ];
      const ownIds = new Set(
        facts.people.filter((person) => person.userId === actor.userId).map((person) => person.id),
      );
      const visibleDepartments = new Set([
        ...facts.memberships
          .filter((row) => ownIds.has(row.employeeId))
          .map((row) => row.departmentId),
        ...all.map((item) => item.departmentId),
        ...assigned.map((item) => item.departmentId),
      ]);
      const departmentOptions = facts.departmentRows
        .filter((row) => isActionManager(actor) || visibleDepartments.has(row.id))
        .map((row) => ({ id: row.id, name: row.name }));
      if (
        (filters.employeeId && !employeeOptions.some((p) => p.id === filters.employeeId)) ||
        (filters.departmentId && !departmentOptions.some((p) => p.id === filters.departmentId))
      )
        throw new AuthorizationError();
      const filtered = all.filter(
        (item) =>
          (!filters.month || item.date.startsWith(filters.month)) &&
          (!filters.kind || item.kind === filters.kind) &&
          (!filters.employeeId || item.employeeId === filters.employeeId) &&
          (!filters.departmentId || item.departmentId === filters.departmentId),
      );
      const counts = Object.fromEntries(
        actionKinds.map((kind) => [kind, filtered.filter((item) => item.kind === kind).length]),
      ) as ActionPage["counts"];
      const page = Math.min(filters.page, Math.max(1, Math.ceil(filtered.length / 50)));
      return {
        items: summaryOnly ? [] : filtered.slice((page - 1) * 50, page * 50),
        total: filtered.length,
        allTotal: all.length,
        counts,
        page,
        pageSize: 50,
        checkedAt: now.toISOString(),
        timezone: facts.organization.timezone,
        employees: summaryOnly ? [] : employeeOptions,
        departments: summaryOnly ? [] : departmentOptions,
      };
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}
