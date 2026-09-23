import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { writeFile } from "node:fs/promises";
import { eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDatabaseClient } from "@/lib/db/client";
import {
  absenceRecords,
  leaveRequests,
  leaveRequestDays,
  leaveTypes,
  employeeStatusHistory,
  approvalCases,
  approvalDelegations,
  attendanceCorrectionRequests,
  attendanceDays,
  attendanceEvents,
  attendanceMonthPeriods,
  departments,
  employeeDepartments,
  employees,
  notifications,
  organizations,
  users,
  workCalendarPatterns,
  workRules,
} from "@/lib/db/schema";
import { createApprovalCase, syncApprovalCaseStatus } from "@/lib/approval-cases";
import { listActionItems, loadActionFacts, actionItemsFor } from "@/lib/attendance-action-center";
import { runActionReminders } from "@/lib/action-reminders";
import { markNotificationsRead, notificationTarget } from "@/lib/notifications";
import type { SessionActor } from "@/lib/authorization";

const url = process.env.TEST_DATABASE_URL;
const now = new Date("2026-09-22T00:00:00Z");
describe.skipIf(!url)("attendance action center", () => {
  const client = createDatabaseClient(url ?? "postgresql://kinmu:kinmu@127.0.0.1:55439/kinmu_test");
  const db = client.db;
  beforeEach(async () => {
    await db.execute(sql`SET client_min_messages TO WARNING`);
    await db.execute(sql`TRUNCATE organizations CASCADE`);
  });
  afterAll(async () => {
    await db.execute(sql`SET client_min_messages TO WARNING`);
    await db.execute(sql`TRUNCATE organizations CASCADE`);
    await client.close();
  });
  async function fixture(count = 1, start = "2026-09-16") {
    const [org] = await db.insert(organizations).values({ name: "対応検証" }).returning();
    const [owner, approver, personUser] = await db
      .insert(users)
      .values([
        {
          organizationId: org.id,
          displayName: "管理者",
          email: `action-owner+${org.id}@example.com`,
          role: "owner" as const,
          status: "active" as const,
        },
        {
          organizationId: org.id,
          displayName: "承認者",
          email: `action-approver+${org.id}@example.com`,
          role: "approver" as const,
          status: "active" as const,
        },
        {
          organizationId: org.id,
          displayName: "本人",
          email: `action-employee+${org.id}@example.com`,
          role: "employee" as const,
          status: "active" as const,
        },
      ])
      .returning();
    const actor = (user: typeof owner): SessionActor => ({
      organizationId: org.id,
      userId: user.id,
      role: user.role,
      displayName: user.displayName,
      expiresAt: new Date("2027-01-01"),
    });
    const people = await db
      .insert(employees)
      .values(
        Array.from({ length: count }, (_, i) => ({
          organizationId: org.id,
          employeeNumber: `A-${i}`,
          familyName: "検証",
          givenName: `${i}`,
          displayName: `検証 ${i}`,
          joinedOn: start,
          status: "active" as const,
          userId: i === 0 ? personUser.id : null,
        })),
      )
      .returning();
    const [department] = await db
      .insert(departments)
      .values({ organizationId: org.id, code: "ACT", name: "対象部署" })
      .returning();
    await db.insert(employeeDepartments).values(
      people.map((person) => ({
        employeeId: person.id,
        departmentId: department.id,
        startedOn: start,
      })),
    );
    const [rule] = await db
      .insert(workRules)
      .values({
        organizationId: org.id,
        name: "通常",
        effectiveFrom: start,
        scheduledStartTime: "09:00",
        scheduledEndTime: "18:00",
      })
      .returning();
    await db.insert(workCalendarPatterns).values({
      organizationId: org.id,
      effectiveFrom: start,
      status: "active",
      activatedByUserId: owner.id,
      activatedAt: now,
    });
    return {
      org,
      owner,
      approver,
      personUser,
      people,
      department,
      rule,
      ownerActor: actor(owner),
      approverActor: actor(approver),
      employeeActor: actor(personUser),
    };
  }
  async function pending(
    c: Awaited<ReturnType<typeof fixture>>,
    employeeId = c.people[0].id,
    date = "2026-09-16",
  ) {
    const [request] = await db
      .insert(attendanceCorrectionRequests)
      .values({
        organizationId: c.org.id,
        employeeId,
        requestedByUserId: c.personUser.id,
        workDate: date,
        reason: "退勤記録を確認",
      })
      .returning();
    const item = await createApprovalCase(db, {
      organizationId: c.org.id,
      employeeId,
      submittedByUserId: c.personUser.id,
      targetDate: date,
      reference: {
        requestType: "attendance_correction",
        attendanceCorrectionRequestId: request.id,
      },
      snapshot: {
        workDate: date,
        entries: [],
        attendanceDayId: null,
        baseRevision: 0,
        employeeId,
        reason: request.reason,
        requestId: request.id,
        requestType: "attendance_correction",
      },
    });
    await db
      .update(approvalCases)
      .set({ assignedApproverUserId: c.approver.id, dueAt: new Date("2026-09-21T00:00:00Z") })
      .where(eq(approvalCases.id, item.id));
    return { item, request };
  }
  it("keeps old unclosed days, includes pre-calendar punches and excludes today/closed/holidays", async () => {
    const c = await fixture(1, "2026-06-01");
    await db.update(workCalendarPatterns).set({ effectiveFrom: "2026-09-16" });
    const [day] = await db
      .insert(attendanceDays)
      .values({
        organizationId: c.org.id,
        employeeId: c.people[0].id,
        workDate: "2026-06-01",
        workRuleId: c.rule.id,
        scheduledMinutes: 480,
      })
      .returning();
    await db.insert(attendanceEvents).values({
      organizationId: c.org.id,
      employeeId: c.people[0].id,
      attendanceDayId: day.id,
      type: "clock_in",
      occurredAt: new Date("2026-06-01T00:00:00Z"),
      recordedByUserId: c.personUser.id,
    });
    const result = await listActionItems(db, c.employeeActor, {}, now);
    expect(
      result.items.some((item) => item.date === "2026-06-01" && item.kind === "open_punch"),
    ).toBe(true);
    expect(
      result.items.some((item) => item.date === "2026-09-19" || item.date === "2026-09-22"),
    ).toBe(false);
    expect(result.items.filter((item) => item.kind === "unresolved_day")).toHaveLength(4);
    await db
      .insert(attendanceMonthPeriods)
      .values({ organizationId: c.org.id, targetMonth: "2026-06", status: "closed" });
    expect(
      (await listActionItems(db, c.employeeActor, {}, now)).items.some(
        (item) => item.date === "2026-06-01",
      ),
    ).toBe(false);
  });
  it("reuses active calendar, employment history and multi-day leave resolution", async () => {
    const c = await fixture();
    await db
      .update(workCalendarPatterns)
      .set({ status: "draft", activatedAt: null, activatedByUserId: null });
    expect((await listActionItems(db, c.employeeActor, {}, now)).total).toBe(0);
    await db
      .update(workCalendarPatterns)
      .set({ status: "active", activatedAt: now, activatedByUserId: c.owner.id });
    await db.insert(employeeStatusHistory).values([
      { employeeId: c.people[0].id, status: "active", effectiveOn: "2026-09-16" },
      { employeeId: c.people[0].id, status: "terminated", effectiveOn: "2026-09-21" },
    ]);
    const [type] = await db
      .insert(leaveTypes)
      .values({
        organizationId: c.org.id,
        code: "SPECIAL",
        name: "特別休暇",
        effectiveFrom: "2026-01-01",
      })
      .returning();
    const [request] = await db
      .insert(leaveRequests)
      .values({
        organizationId: c.org.id,
        employeeId: c.people[0].id,
        leaveTypeId: type.id,
        requestedByUserId: c.personUser.id,
        reason: "複数日の確認",
        leaveTypeCode: type.code,
        leaveTypeName: type.name,
        paid: false,
        consumesBalance: false,
      })
      .returning();
    const days = ["2026-09-16", "2026-09-17"].map((workDate) => ({
      workDate,
      units: 2,
      scheduledMinutes: 480,
      calendarSource: "weekly_pattern",
    }));
    await db
      .insert(leaveRequestDays)
      .values(days.map((day) => ({ ...day, requestId: request.id })));
    const approval = await createApprovalCase(db, {
      organizationId: c.org.id,
      employeeId: c.people[0].id,
      submittedByUserId: c.personUser.id,
      targetDate: days[0].workDate,
      reference: { requestType: "leave", leaveRequestId: request.id },
      snapshot: {
        days,
        employeeId: c.people[0].id,
        leaveTypeCode: type.code,
        leaveTypeId: type.id,
        leaveTypeName: type.name,
        reason: request.reason,
        requestId: request.id,
        requestType: "leave",
      },
    });
    const pendingDays = (await listActionItems(db, c.employeeActor, {}, now)).items;
    expect(pendingDays).toHaveLength(3);
    expect(pendingDays.filter((row) => row.reason.includes("審査待ち"))).toHaveLength(2);
    await db
      .update(leaveRequests)
      .set({ status: "approved", reviewerUserId: c.owner.id, reviewedAt: now })
      .where(eq(leaveRequests.id, request.id));
    await db
      .update(approvalCases)
      .set({ status: "approved", reviewerUserId: c.owner.id, reviewedAt: now })
      .where(eq(approvalCases.id, approval.id));
    await db.insert(absenceRecords).values({
      organizationId: c.org.id,
      employeeId: c.people[0].id,
      workDate: "2026-09-18",
      reason: "欠勤確認",
      confirmedByUserId: c.owner.id,
    });
    expect(
      (
        await listActionItems(
          db,
          c.employeeActor,
          { departmentId: c.department.id, employeeId: c.people[0].id },
          now,
        )
      ).total,
    ).toBe(0);
  });

  it("scopes rows, counts and filters; recognizes pending fixes and reassignments", async () => {
    const c = await fixture(2);
    const { item } = await pending(c);
    const self = await listActionItems(db, c.employeeActor, {}, now);
    expect(self.items.every((row) => row.employeeId === c.people[0].id)).toBe(true);
    expect(
      self.items.find((row) => row.kind === "unresolved_day" && row.date === "2026-09-16")?.reason,
    ).toContain("審査待ち");
    expect((await listActionItems(db, c.approverActor, {}, now)).items).toHaveLength(1);
    await expect(
      listActionItems(db, c.employeeActor, { employeeId: c.people[1].id }, now),
    ).rejects.toThrow();
    await expect(listActionItems(db, c.employeeActor, { month: "2026-13" }, now)).rejects.toThrow();
    await db
      .update(approvalCases)
      .set({ assignedApproverUserId: c.owner.id })
      .where(eq(approvalCases.id, item.id));
    expect((await listActionItems(db, c.approverActor, {}, now)).total).toBe(0);
    const [other] = await db.insert(organizations).values({ name: "別組織" }).returning();
    await expect(
      listActionItems(db, { ...c.ownerActor, organizationId: other.id }, {}, now),
    ).rejects.toThrow();
  });
  it("removes returned requests on resubmission and blocks same-day reminders", async () => {
    const c = await fixture();
    const { request, item } = await pending(c);
    await syncApprovalCaseStatus(db, {
      organizationId: c.org.id,
      actorUserId: c.owner.id,
      reference: { attendanceCorrectionRequestId: request.id },
      status: "returned",
      reviewComment: "時刻を確認",
      reviewerUserId: c.owner.id,
      reviewedAt: now,
    });
    expect(
      (await listActionItems(db, c.employeeActor, { kind: "returned_request" }, now)).total,
    ).toBe(1);
    const facts = await loadActionFacts(db, c.org.id, now);
    expect(
      actionItemsFor(facts, c.employeeActor, true).some((row) => row.kind === "returned_request"),
    ).toBe(false);
    await db
      .update(approvalCases)
      .set({ reviewedAt: new Date("2026-09-20T00:00:00Z") })
      .where(eq(approvalCases.id, item.id));
    expect(
      actionItemsFor(await loadActionFacts(db, c.org.id, now), c.employeeActor, true).some(
        (row) => row.kind === "returned_request",
      ),
    ).toBe(true);
    await syncApprovalCaseStatus(db, {
      organizationId: c.org.id,
      actorUserId: c.personUser.id,
      reference: { attendanceCorrectionRequestId: request.id },
      status: "pending",
    });
    expect(
      (await listActionItems(db, c.employeeActor, { kind: "returned_request" }, now)).total,
    ).toBe(0);
  });
  it("marks invalid assignees and expired delegations for reassignment without self-review", async () => {
    const c = await fixture();
    const { item } = await pending(c);
    await db.update(users).set({ status: "disabled" }).where(eq(users.id, c.approver.id));
    expect(
      (await listActionItems(db, c.ownerActor, { kind: "overdue_approval" }, now)).items[0]
        .nextOwner,
    ).toContain("再割当");
    await db.update(users).set({ status: "active" }).where(eq(users.id, c.approver.id));
    await db
      .update(approvalCases)
      .set({ routeReason: "delegated", originalApproverUserId: c.owner.id })
      .where(eq(approvalCases.id, item.id));
    await db.insert(approvalDelegations).values({
      organizationId: c.org.id,
      departmentId: c.department.id,
      requestType: "attendance_correction",
      originalApproverUserId: c.owner.id,
      delegateApproverUserId: c.approver.id,
      startsAt: new Date("2026-09-01"),
      endsAt: new Date("2026-09-20"),
      reason: "不在",
      createdByUserId: c.owner.id,
    });
    expect(
      (await listActionItems(db, c.ownerActor, { kind: "overdue_approval" }, now)).items[0]
        .actionLabel,
    ).toContain("再割当");
    expect(
      actionItemsFor(await loadActionFacts(db, c.org.id, now), c.approverActor, true),
    ).toHaveLength(0);
    expect(
      (await listActionItems(db, c.employeeActor, { kind: "overdue_approval" }, now)).items[0]
        .actionLabel,
    ).not.toContain("審査");
  });
  it("deduplicates concurrent/restarted daily runs and preserves read state through migrations", async () => {
    const c = await fixture();
    await pending(c);
    expect((await runActionReminders(db, new Date("2026-09-21T23:59:00Z"))).created).toBe(0);
    await Promise.all([runActionReminders(db, now), runActionReminders(db, now)]);
    const rows = await db
      .select()
      .from(notifications)
      .where(eq(notifications.kind, "action_items_reminder"));
    expect(rows).toHaveLength(3);
    const own = rows.find((row) => row.recipientUserId === c.personUser.id)!;
    await markNotificationsRead(db, c.employeeActor, [own.id]);
    expect((await runActionReminders(db, now)).created).toBe(0);
    await migrate(db, { migrationsFolder: "drizzle" });
    expect(
      (await db.select().from(notifications).where(eq(notifications.id, own.id)))[0].readAt,
    ).not.toBeNull();
    expect((await listActionItems(db, c.employeeActor, {}, now)).total).toBeGreaterThan(0);
    await expect(notificationTarget(db, c.ownerActor, own.id)).rejects.toThrow();
    expect((await notificationTarget(db, c.employeeActor, own.id)).href).toBe("/action-items");
    await db.update(users).set({ role: "employee" }).where(eq(users.id, c.owner.id));
    const ownerNotification = rows.find((row) => row.recipientUserId === c.owner.id)!;
    expect(ownerNotification.summary).not.toContain("検証 0");
    expect(
      (await notificationTarget(db, { ...c.ownerActor, role: "employee" }, ownerNotification.id))
        .href,
    ).toBe("/action-items");
    expect((await listActionItems(db, { ...c.ownerActor, role: "employee" }, {}, now)).total).toBe(
      0,
    );
    const resumed = await runActionReminders(db, new Date("2026-09-25T00:00:00Z"));
    expect(resumed.created).toBe(2);
    expect(
      await db.select().from(notifications).where(eq(notifications.kind, "action_items_reminder")),
    ).toHaveLength(5);
  });
  it("rolls back a failed organization and succeeds after recovery", async () => {
    const c = await fixture();
    await db.update(organizations).set({ name: "失敗対象" }).where(eq(organizations.id, c.org.id));
    await fixture();
    await db.execute(
      sql`CREATE FUNCTION reject_action_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.kind::text = 'action_items_reminder' AND EXISTS (SELECT 1 FROM organizations WHERE id = NEW.organization_id AND name = '失敗対象') THEN RAISE EXCEPTION 'test'; END IF; RETURN NEW; END $$`,
    );
    await db.execute(
      sql`CREATE TRIGGER reject_action_test BEFORE INSERT ON notifications FOR EACH ROW EXECUTE FUNCTION reject_action_test()`,
    );
    try {
      expect((await runActionReminders(db, now)).failed).toBe(1);
      expect(
        await db.select().from(notifications).where(eq(notifications.organizationId, c.org.id)),
      ).toHaveLength(0);
      expect(await db.select().from(notifications)).toHaveLength(2);
    } finally {
      await db.execute(sql`DROP TRIGGER reject_action_test ON notifications`);
      await db.execute(sql`DROP FUNCTION reject_action_test()`);
    }
    expect((await runActionReminders(db, now)).created).toBe(2);
    await db.update(users).set({ status: "disabled" }).where(eq(users.id, c.personUser.id));
    expect((await runActionReminders(db, new Date("2026-09-23T00:00:00Z"))).created).toBe(3);
  });
  it("notifies unassigned managers and waits until the local day after a return", async () => {
    const c = await fixture();
    const { request, item } = await pending(c);
    await db.update(workCalendarPatterns).set({ effectiveFrom: "2026-09-30" });
    await db
      .update(approvalCases)
      .set({ assignedApproverUserId: null })
      .where(eq(approvalCases.id, item.id));
    expect((await runActionReminders(db, now)).created).toBe(1);
    await db.delete(notifications);
    await syncApprovalCaseStatus(db, {
      organizationId: c.org.id,
      actorUserId: c.owner.id,
      reference: { attendanceCorrectionRequestId: request.id },
      status: "returned",
      reviewComment: "確認",
      reviewerUserId: c.owner.id,
      reviewedAt: now,
    });
    expect((await runActionReminders(db, now)).created).toBe(0);
    expect((await runActionReminders(db, new Date("2026-09-23T00:00:00Z"))).created).toBe(2);
  });

  it("keeps resolved assignee filters valid until reassignment", async () => {
    const c = await fixture();
    const { item } = await pending(c);
    await db
      .update(approvalCases)
      .set({ status: "approved", reviewerUserId: c.approver.id, reviewedAt: now })
      .where(eq(approvalCases.id, item.id));
    expect(
      (
        await listActionItems(
          db,
          c.approverActor,
          { employeeId: c.people[0].id, departmentId: c.department.id },
          now,
        )
      ).total,
    ).toBe(0);
    await db
      .update(approvalCases)
      .set({ assignedApproverUserId: c.owner.id })
      .where(eq(approvalCases.id, item.id));
    await expect(
      listActionItems(db, c.approverActor, { employeeId: c.people[0].id }, now),
    ).rejects.toThrow();
  });

  it("adds a newly eligible recipient later the same day and does not duplicate a dual-role digest", async () => {
    const c = await fixture();
    expect((await runActionReminders(db, now)).created).toBe(2);
    const { item } = await pending(c);
    expect((await runActionReminders(db, now)).created).toBe(1);
    await db.update(users).set({ role: "approver" }).where(eq(users.id, c.personUser.id));
    await db
      .update(approvalCases)
      .set({ assignedApproverUserId: c.personUser.id })
      .where(eq(approvalCases.id, item.id));
    expect((await runActionReminders(db, now)).created).toBe(0);
    await db.update(attendanceMonthPeriods).set({ status: "closed" });
    await db
      .insert(attendanceMonthPeriods)
      .values({ organizationId: c.org.id, targetMonth: "2026-09", status: "closed" });
    const [notice] = await db
      .select()
      .from(notifications)
      .where(eq(notifications.recipientUserId, c.owner.id));
    expect((await notificationTarget(db, c.ownerActor, notice.id)).href).toBe("/action-items");
    expect((await listActionItems(db, c.ownerActor, {}, now)).total).toBe(0);
    expect((await runActionReminders(db, new Date("2026-09-23T00:00:00Z"))).created).toBe(0);
  });

  it("handles 100 people and 300 cases, with stable pages and long unclosed history", async () => {
    const c = await fixture(100, "2026-07-01");
    for (const person of c.people)
      for (const month of ["07", "08", "09"]) await pending(c, person.id, `2026-${month}-01`);
    let started = performance.now();
    const page = await listActionItems(db, c.ownerActor, {}, now);
    const listMs = performance.now() - started;
    expect(listMs).toBeLessThan(5000);
    expect(page.items).toHaveLength(50);
    const second = await listActionItems(db, c.ownerActor, { page: 2 }, now);
    expect(second.items.some((row) => page.items.some((first) => first.id === row.id))).toBe(false);
    started = performance.now();
    const summary = await listActionItems(db, c.ownerActor, {}, now, true);
    const summaryMs = performance.now() - started;
    expect(summaryMs).toBeLessThan(5000);
    expect(summary.total).toBe(page.total);
    started = performance.now();
    expect((await runActionReminders(db, now)).failed).toBe(0);
    const workerMs = performance.now() - started;
    expect(workerMs).toBeLessThan(30000);
    await db.update(workCalendarPatterns).set({ effectiveFrom: "2021-01-01" });
    await db.update(employees).set({ joinedOn: "2021-01-01" });
    started = performance.now();
    const historical = await listActionItems(db, c.ownerActor, {}, now);
    const measurements = {
      listMs,
      summaryMs,
      workerMs,
      historyMs: performance.now() - started,
      historyItems: historical.total,
    };
    if (process.env.ACTION_PERFORMANCE_OUTPUT)
      await writeFile(process.env.ACTION_PERFORMANCE_OUTPUT, JSON.stringify(measurements, null, 2));
    expect(historical.total).toBeGreaterThan(page.total);
  }, 120000);
});
