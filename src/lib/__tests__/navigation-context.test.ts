import { describe, expect, it } from "vitest";

import { safeReturnTo } from "@/lib/navigation-context";

describe("safeReturnTo", () => {
  it("keeps an authorized internal route and approved list context", () => {
    expect(
      safeReturnTo(
        "/attendance?month=2026-07&status=open&employeeId=employee-1&page=2",
        "hr_admin",
      ),
    ).toBe("/attendance?month=2026-07&status=open&employeeId=employee-1&page=2");
  });

  it("drops unapproved query values and fragments", () => {
    expect(safeReturnTo("/attendance?status=open&token=secret#row-1", "owner")).toBe(
      "/attendance?status=open",
    );
  });

  it.each([
    "https://example.com/attendance",
    "//example.com/attendance",
    "/login",
    "/api/attendance",
    "attendance",
  ])("rejects unsafe or unauthenticated destinations: %s", (value) => {
    expect(safeReturnTo(value, "hr_admin")).toBeUndefined();
  });

  it("rejects a destination that the current role cannot open", () => {
    expect(safeReturnTo("/settings/users", "employee")).toBeUndefined();
  });
});
