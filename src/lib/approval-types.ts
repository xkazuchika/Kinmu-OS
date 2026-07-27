export const approvalRequestTypes = [
  "attendance_correction",
  "leave",
  "overtime",
  "holiday_work",
] as const;

export type ApprovalRequestType = (typeof approvalRequestTypes)[number];

export const approvalCaseStatuses = [
  "pending",
  "returned",
  "approved",
  "rejected",
  "cancelled",
] as const;

export type ApprovalCaseStatus = (typeof approvalCaseStatuses)[number];

export const approvalRouteReasons = [
  "department_route",
  "delegated",
  "legacy_admin_pool",
  "manual_reassignment",
] as const;

export type ApprovalRouteReason = (typeof approvalRouteReasons)[number];

export type ApprovalRequestReference =
  | {
      requestType: "attendance_correction";
      attendanceCorrectionRequestId: string;
      leaveRequestId?: never;
      overtimeWorkRequestId?: never;
    }
  | {
      requestType: "leave";
      attendanceCorrectionRequestId?: never;
      leaveRequestId: string;
      overtimeWorkRequestId?: never;
    }
  | {
      requestType: "overtime" | "holiday_work";
      attendanceCorrectionRequestId?: never;
      leaveRequestId?: never;
      overtimeWorkRequestId: string;
    };

export type AttendanceCorrectionApprovalSnapshot = {
  attendanceDayId: string | null;
  baseRevision: number;
  employeeId: string;
  entries: Array<{
    kind: "original" | "requested";
    occurredAt: string;
    originalEventId: string | null;
    position: number;
    type: string;
  }>;
  reason: string;
  requestId: string;
  requestType: "attendance_correction";
  workDate: string;
};

export type LeaveApprovalSnapshot = {
  days: Array<{
    calendarSource: string;
    scheduledMinutes: number;
    units: number;
    workDate: string;
  }>;
  employeeId: string;
  leaveTypeCode: string;
  leaveTypeId: string;
  leaveTypeName: string;
  reason: string;
  requestId: string;
  requestType: "leave";
};

export type OvertimeApprovalSnapshot = {
  calendarSnapshot: Record<string, unknown>;
  employeeId: string;
  plannedBreakMinutes: number;
  plannedEndAt: string;
  plannedMinutes: number;
  plannedStartAt: string;
  policyId: string;
  reason: string;
  requestId: string;
  requestType: "overtime" | "holiday_work";
  workDate: string;
  workRuleSnapshot: Record<string, unknown>;
};

export type ApprovalCaseSnapshot =
  AttendanceCorrectionApprovalSnapshot | LeaveApprovalSnapshot | OvertimeApprovalSnapshot;

export type ApprovalCaseRecord = ApprovalRequestReference & {
  assignedApproverUserId: string | null;
  currentRevision: number;
  dueAt: Date | null;
  id: string;
  organizationId: string;
  originalApproverUserId: string | null;
  routeReason: ApprovalRouteReason;
  status: ApprovalCaseStatus;
  submittedByUserId: string;
  submittedDepartmentId: string | null;
  submittedOnBehalf: boolean;
  targetDate: string;
  targetEmployeeId: string;
  version: number;
};

export function approvalRequestReference(
  requestType: ApprovalRequestType,
  requestId: string,
): ApprovalRequestReference {
  switch (requestType) {
    case "attendance_correction":
      return { attendanceCorrectionRequestId: requestId, requestType };
    case "leave":
      return { leaveRequestId: requestId, requestType };
    case "overtime":
    case "holiday_work":
      return { overtimeWorkRequestId: requestId, requestType };
  }
}
