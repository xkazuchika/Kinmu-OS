import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createProfile: vi.fn(),
  generateRun: vi.fn(),
  getProfile: vi.fn(),
  inspect: vi.fn(),
  publishProfile: vi.fn(),
  redownload: vi.fn(),
  requireActor: vi.fn(),
  requirePermission: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({ getDatabase: () => ({}) }));
vi.mock("@/lib/authorization", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/authorization")>()),
  requireActor: mocks.requireActor,
  requirePermission: mocks.requirePermission,
}));
vi.mock("@/lib/payroll-export-profiles", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/payroll-export-profiles")>()),
  createPayrollExportProfile: mocks.createProfile,
  getPayrollExportProfile: mocks.getProfile,
  publishPayrollExportProfile: mocks.publishProfile,
}));
vi.mock("@/lib/payroll-export-runs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/payroll-export-runs")>()),
  generatePayrollExportRun: mocks.generateRun,
  inspectPayrollExport: mocks.inspect,
  redownloadPayrollExportRun: mocks.redownload,
}));

import { POST as inspectPayroll } from "@/app/api/payroll-exports/inspect/route";
import {
  GET as getProfile,
  PATCH as patchProfile,
} from "@/app/api/payroll-exports/profiles/[profileId]/route";
import { POST as createProfile } from "@/app/api/payroll-exports/profiles/route";
import { GET as downloadRun } from "@/app/api/payroll-exports/runs/[runId]/download/route";
import { POST as generateRun } from "@/app/api/payroll-exports/runs/route";
import { AuthorizationError, type SessionActor } from "@/lib/authorization";
import { PayrollResourceNotFoundError } from "@/lib/payroll-errors";
import { PayrollExportConflictError } from "@/lib/payroll-export-runs";
import { PayrollProfileConflictError } from "@/lib/payroll-export-profiles";

const owner: SessionActor = {
  displayName: "給与管理者",
  expiresAt: new Date("2027-01-01T00:00:00.000Z"),
  organizationId: "org-a",
  role: "owner",
  userId: "owner-a",
};
const profileId = "00000000-0000-4000-8000-000000000001";
const profileVersionId = "00000000-0000-4000-8000-000000000002";
const runId = "00000000-0000-4000-8000-000000000003";

function jsonRequest(url: string, body: unknown, method = "POST") {
  return new Request(url, {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method,
  });
}

describe("payroll export API boundaries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireActor.mockResolvedValue(owner);
  });

  it("returns 401 without a session and 403 before exposing payroll data to employees", async () => {
    mocks.requireActor.mockRejectedValueOnce(new AuthorizationError("認証が必要です。"));
    const unauthenticated = await getProfile(
      new Request(`http://localhost/api/payroll-exports/profiles/${profileId}`),
      { params: Promise.resolve({ profileId }) },
    );
    expect(unauthenticated.status).toBe(401);

    mocks.requireActor.mockResolvedValueOnce({ ...owner, role: "employee" });
    mocks.requirePermission.mockImplementationOnce(() => {
      throw new AuthorizationError();
    });
    const forbidden = await getProfile(
      new Request(`http://localhost/api/payroll-exports/profiles/${profileId}`),
      { params: Promise.resolve({ profileId }) },
    );
    expect(forbidden.status).toBe(403);
    expect(mocks.getProfile).not.toHaveBeenCalled();
  });

  it("rejects client-supplied organization data and derives the actor in domain calls", async () => {
    const rejected = await createProfile(
      jsonRequest("http://localhost/api/payroll-exports/profiles", {
        config: {},
        name: "給与連携",
        organizationId: "org-b",
      }),
    );
    expect(rejected.status).toBe(422);
    expect(mocks.createProfile).not.toHaveBeenCalled();

    mocks.createProfile.mockResolvedValue({ id: profileId });
    const accepted = await createProfile(
      jsonRequest("http://localhost/api/payroll-exports/profiles", {
        config: {},
        name: "給与連携",
      }),
    );
    expect(accepted.status).toBe(201);
    expect(mocks.createProfile).toHaveBeenCalledWith(expect.anything(), owner, {
      config: {},
      name: "給与連携",
    });
  });

  it("returns a generic 404 for another organization resource and 409 for stale versions", async () => {
    mocks.getProfile.mockRejectedValueOnce(new PayrollResourceNotFoundError());
    const hidden = await getProfile(
      new Request(`http://localhost/api/payroll-exports/profiles/${profileId}`),
      { params: Promise.resolve({ profileId }) },
    );
    expect(hidden.status).toBe(404);
    await expect(hidden.json()).resolves.toEqual({
      error: "指定された給与連携リソースが見つかりません。",
    });

    mocks.publishProfile.mockRejectedValueOnce(new PayrollProfileConflictError());
    const conflict = await patchProfile(
      jsonRequest(
        `http://localhost/api/payroll-exports/profiles/${profileId}`,
        { action: "publish", expectedVersion: 2 },
        "PATCH",
      ),
      { params: Promise.resolve({ profileId }) },
    );
    expect(conflict.status).toBe(409);
  });

  it("validates inspection paging and does not accept oversized values", async () => {
    const response = await inspectPayroll(
      jsonRequest("http://localhost/api/payroll-exports/inspect", {
        month: "2026-07",
        pageSize: 101,
        profileVersionId,
      }),
    );
    expect(response.status).toBe(422);
    expect(mocks.inspect).not.toHaveBeenCalled();
  });

  it("maps changed warning confirmation to 409 and hides another organization download", async () => {
    mocks.generateRun.mockRejectedValueOnce(new PayrollExportConflictError());
    const conflict = await generateRun(
      jsonRequest("http://localhost/api/payroll-exports/runs", {
        confirmedWarningCodes: ["tampered_warning"],
        expectedMappingVersions: {},
        expectedRevision: 1,
        month: "2026-07",
        profileVersionId,
      }),
    );
    expect(conflict.status).toBe(409);

    mocks.redownload.mockRejectedValueOnce(new PayrollResourceNotFoundError());
    const hidden = await downloadRun(
      new Request(`http://localhost/api/payroll-exports/runs/${runId}/download`),
      { params: Promise.resolve({ runId }) },
    );
    expect(hidden.status).toBe(404);
    expect(mocks.redownload).toHaveBeenCalledWith(expect.anything(), owner, runId);
  });
});
