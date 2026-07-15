import { describe, expect, it } from "vitest";

import { AuthorizationError, can, requirePermission, type SessionActor } from "@/lib/authorization";

const actor = (role: SessionActor["role"]): SessionActor => ({
  displayName: "テスト利用者",
  expiresAt: new Date("2026-12-31T00:00:00.000Z"),
  organizationId: "organization-id",
  role,
  userId: "user-id",
});

describe("authorization policy", () => {
  it("allows owners and HR administrators to manage employee records", () => {
    expect(can(actor("owner"), "employees:manage")).toBe(true);
    expect(can(actor("hr_admin"), "employees:manage")).toBe(true);
  });

  it("limits employees to their self-service permissions", () => {
    expect(can(actor("employee"), "self:read")).toBe(true);
    expect(can(actor("employee"), "attendance:manage")).toBe(false);
    expect(() => requirePermission(actor("employee"), "reports:read")).toThrow(AuthorizationError);
  });
});
