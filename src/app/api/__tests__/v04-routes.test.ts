import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  approveLeaveRequest: vi.fn(),
  createLeaveType: vi.fn(),
  createWorkCalendarDraft: vi.fn(),
  getLeaveReviewDetail: vi.fn(),
  grantLeave: vi.fn(),
  listWorkCalendarSettings: vi.fn(),
  requireActor: vi.fn(),
  requirePermission: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({ getDatabase: () => ({}) }));
vi.mock("@/lib/authorization", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/authorization")>()),
  requireActor: mocks.requireActor,
  requirePermission: mocks.requirePermission,
}));
vi.mock("@/lib/work-calendar", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/work-calendar")>()),
  createWorkCalendarDraft: mocks.createWorkCalendarDraft,
  listWorkCalendarSettings: mocks.listWorkCalendarSettings,
}));
vi.mock("@/lib/leave-ledger", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/leave-ledger")>()),
  createLeaveType: mocks.createLeaveType,
  grantLeave: mocks.grantLeave,
}));
vi.mock("@/lib/leave-requests", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/leave-requests")>()),
  approveLeaveRequest: mocks.approveLeaveRequest,
  getLeaveReviewDetail: mocks.getLeaveReviewDetail,
}));

import { GET as getCalendar, POST as postCalendar } from "@/app/api/calendar/route";
import { POST as postGrant } from "@/app/api/leave/grants/route";
import {
  GET as getLeaveRequest,
  POST as postLeaveRequest,
} from "@/app/api/leave/requests/[requestId]/route";
import { POST as postLeaveType } from "@/app/api/leave/types/route";
import { AuthorizationError, type SessionActor } from "@/lib/authorization";
import { LeaveRequestValidationError } from "@/lib/leave-requests";

const owner: SessionActor = {
  displayName: "管理者",
  expiresAt: new Date("2027-01-01T00:00:00.000Z"),
  organizationId: "org-a",
  role: "owner",
  userId: "owner-a",
};
const employee: SessionActor = { ...owner, role: "employee", userId: "employee-a" };

describe("v0.4 authenticated API boundaries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireActor.mockResolvedValue(owner);
    mocks.listWorkCalendarSettings.mockResolvedValue({ exceptions: [], patterns: [] });
  });

  it("returns 401 without an active session", async () => {
    mocks.requireActor.mockRejectedValue(new AuthorizationError("認証が必要です。"));

    const response = await getCalendar(new Request("http://localhost/api/calendar"));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "認証が必要です。" });
  });

  it("does not accept a client supplied organization ID", async () => {
    mocks.createWorkCalendarDraft.mockResolvedValue({ id: "pattern-a" });

    const response = await postCalendar(
      new Request("http://localhost/api/calendar", {
        body: JSON.stringify({
          action: "create_draft",
          effectiveFrom: "2026-08-01",
          fridayWorkday: true,
          mondayWorkday: true,
          organizationId: "org-b",
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );

    expect(response.status).toBe(201);
    expect(mocks.createWorkCalendarDraft).toHaveBeenCalledWith(
      expect.anything(),
      owner,
      expect.not.objectContaining({ organizationId: "org-b" }),
    );
  });

  it("maps an employee management attempt to a non-disclosing 403", async () => {
    mocks.requireActor.mockResolvedValue(employee);
    mocks.createLeaveType.mockRejectedValue(new AuthorizationError());

    const response = await postLeaveType(
      new Request("http://localhost/api/leave/types", {
        body: JSON.stringify({ action: "create" }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "この操作を行う権限がありません。" });
  });

  it("passes the balance version as a number for optimistic locking", async () => {
    mocks.grantLeave.mockResolvedValue({ version: 8 });

    const response = await postGrant(
      new Request("http://localhost/api/leave/grants", {
        body: JSON.stringify({
          action: "grant",
          employeeId: "employee-a",
          expectedVersion: "7",
          grantedOn: "2026-08-01",
          leaveTypeId: "paid-a",
          reason: "年度付与",
          units: 20,
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );

    expect(response.status).toBe(201);
    expect(mocks.grantLeave).toHaveBeenCalledWith(
      expect.anything(),
      owner,
      expect.objectContaining({ expectedVersion: 7 }),
    );
  });

  it("returns 422 for a tampered request ID without exposing another organization", async () => {
    mocks.getLeaveReviewDetail.mockRejectedValue(
      new LeaveRequestValidationError("休暇申請を確認できませんでした。"),
    );

    const response = await getLeaveRequest(
      new Request("http://localhost/api/leave/requests/org-b-request"),
      { params: Promise.resolve({ requestId: "org-b-request" }) },
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({ error: "休暇申請を確認できませんでした。" });
  });

  it("maps a closed-month approval conflict to 409", async () => {
    mocks.approveLeaveRequest.mockRejectedValue(
      new (await import("@/lib/leave-requests")).LeaveRequestConflictError(),
    );

    const response = await postLeaveRequest(
      new Request("http://localhost/api/leave/requests/request-a", {
        body: JSON.stringify({ action: "approve" }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
      { params: Promise.resolve({ requestId: "request-a" }) },
    );

    expect(response.status).toBe(409);
  });
});
