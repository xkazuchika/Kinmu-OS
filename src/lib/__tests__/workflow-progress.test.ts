import { describe, expect, it } from "vitest";

import { initialSetupProgress, monthlyWorkflowProgress } from "@/lib/workflow-progress";

describe("workflow progress", () => {
  it("selects the first incomplete setup step without hiding later work", () => {
    const result = initialSetupProgress({
      calendarReady: false,
      leaveReady: false,
      organizationReady: true,
      overtimePolicyReady: false,
      peopleReady: true,
      workRuleReady: false,
    });

    expect(result.current?.id).toBe("work-rule");
    expect(result.completedCount).toBe(2);
    expect(result.steps.find((step) => step.id === "calendar")?.status).toBe("not_started");
  });

  it("shows monthly blockers before closing", () => {
    const result = monthlyWorkflowProgress({
      closingStatus: "open",
      openDays: 2,
      payrollPublished: false,
      pendingCorrections: 1,
      pendingLeaveRequests: 0,
      pendingOvertimeRequests: 0,
      unresolvedDays: 3,
    });

    expect(result.current?.id).toBe("open-days");
    expect(result.steps.find((step) => step.id === "closing")?.status).toBe("not_started");
  });

  it("does not make payroll required without a published profile", () => {
    const result = monthlyWorkflowProgress({
      closingStatus: "closed",
      openDays: 0,
      payrollPublished: false,
      pendingCorrections: 0,
      pendingLeaveRequests: 0,
      pendingOvertimeRequests: 0,
      unresolvedDays: 0,
    });

    expect(result.totalCount).toBe(4);
    expect(result.completedCount).toBe(4);
    expect(result.steps.find((step) => step.id === "payroll")?.status).toBe("not_applicable");
  });
});
