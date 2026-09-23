import { describe, expect, it } from "vitest";
import {
  approvalActionKind,
  attendanceActionKind,
  reminderClock,
  returnedReminderEligible,
} from "@/lib/action-item-types";
import { canReviewCase } from "@/lib/approval-access";

describe("action item boundaries", () => {
  const now = new Date("2026-09-22T00:00:00Z");
  it("only identifies past open punches and unresolved workdays, never closed periods", () => {
    expect(attendanceActionKind("open_punch", "2026-09-21", "2026-09-22", false)).toBe(
      "open_punch",
    );
    expect(attendanceActionKind("unresolved", "2026-09-21", "2026-09-22", false)).toBe(
      "unresolved_day",
    );
    for (const status of ["non_workday", "leave_full", "absence", "worked", "conflict"])
      expect(attendanceActionKind(status, "2026-09-21", "2026-09-22", false)).toBeNull();
    expect(attendanceActionKind("open_punch", "2026-09-22", "2026-09-22", false)).toBeNull();
    expect(attendanceActionKind("unresolved", "2026-09-21", "2026-09-22", true)).toBeNull();
  });
  it("uses strict overdue and preserves returned state", () => {
    expect(approvalActionKind("pending", now, now, false)).toBeNull();
    expect(approvalActionKind("pending", null, now, false)).toBeNull();
    expect(approvalActionKind("pending", new Date(now.getTime() - 1), now, false)).toBe(
      "overdue_approval",
    );
    expect(approvalActionKind("returned", null, now, false)).toBe("returned_request");
    for (const status of ["approved", "cancelled", "rejected"])
      expect(approvalActionKind(status, new Date(0), now, false)).toBeNull();
    expect(approvalActionKind("returned", null, now, true)).toBeNull();
  });
  it("uses organization local dates and 9am across daylight saving", () => {
    expect(reminderClock(new Date("2026-09-21T23:59:59Z"), "Asia/Tokyo").eligible).toBe(false);
    expect(reminderClock(now, "Asia/Tokyo")).toEqual({ date: "2026-09-22", eligible: true });
    expect(reminderClock(now, "America/New_York")).toEqual({ date: "2026-09-21", eligible: true });
    expect(reminderClock(new Date("2026-11-01T13:59:59Z"), "America/New_York").eligible).toBe(
      false,
    );
    expect(reminderClock(new Date("2026-11-01T14:00:00Z"), "America/New_York").eligible).toBe(true);
    expect(returnedReminderEligible(now, now, "Asia/Tokyo")).toBe(false);
    expect(returnedReminderEligible(new Date("2026-09-21T14:59:59Z"), now, "Asia/Tokyo")).toBe(
      true,
    );
  });
  it("does not offer self review, cross-organization review or unassigned approver access", () => {
    const item = {
      organizationId: "org",
      status: "pending",
      assignedApproverUserId: "reviewer",
      submittedByUserId: "proxy",
    };
    expect(
      canReviewCase(
        { organizationId: "org", role: "approver", userId: "reviewer" },
        item,
        "employee",
      ),
    ).toBe(true);
    for (const userId of ["employee", "proxy", "other"])
      expect(
        canReviewCase({ organizationId: "org", role: "approver", userId }, item, "employee"),
      ).toBe(false);
    expect(
      canReviewCase({ organizationId: "other", role: "owner", userId: "owner" }, item, "employee"),
    ).toBe(false);
  });
});
