import { describe, expect, it } from "vitest";

import { reconcileOvertimeMinutes } from "@/lib/overtime-reconciliation";

describe("overtime reconciliation status", () => {
  it.each([
    [
      {
        actualMinutes: 0,
        allowedDeviationMinutes: 15,
        hasApprovedRequest: false,
        requestedMinutes: 0,
      },
      null,
    ],
    [
      {
        actualMinutes: 60,
        allowedDeviationMinutes: 15,
        hasApprovedRequest: false,
        requestedMinutes: 0,
      },
      "unapproved_actual",
    ],
    [
      {
        actualMinutes: 0,
        allowedDeviationMinutes: 15,
        hasApprovedRequest: true,
        requestedMinutes: 60,
      },
      "no_actual",
    ],
    [
      {
        actualMinutes: 60,
        allowedDeviationMinutes: 15,
        hasApprovedRequest: true,
        requestedMinutes: 60,
      },
      "within_request",
    ],
    [
      {
        actualMinutes: 75,
        allowedDeviationMinutes: 15,
        hasApprovedRequest: true,
        requestedMinutes: 60,
      },
      "within_request",
    ],
    [
      {
        actualMinutes: 76,
        allowedDeviationMinutes: 15,
        hasApprovedRequest: true,
        requestedMinutes: 60,
      },
      "exceeded_request",
    ],
    [
      {
        actualMinutes: 44,
        allowedDeviationMinutes: 15,
        hasApprovedRequest: true,
        requestedMinutes: 60,
      },
      "under_request",
    ],
  ] as const)("returns the expected status for %o", (input, expected) => {
    expect(reconcileOvertimeMinutes(input)).toBe(expected);
  });
});
