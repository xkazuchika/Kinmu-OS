import { ApprovalCaseConflictError, ApprovalCaseValidationError } from "@/lib/approval-cases";
import { ApprovalRouteConflictError, ApprovalRouteValidationError } from "@/lib/approval-routing";
import {
  AttendanceClosingConflictError,
  AttendanceClosingValidationError,
} from "@/lib/attendance-closing";
import { AuthorizationError } from "@/lib/authorization";
import { CsvImportValidationError } from "@/lib/csv-imports";
import { LeaveLedgerConflictError, LeaveLedgerValidationError } from "@/lib/leave-ledger";
import { LeaveRequestConflictError, LeaveRequestValidationError } from "@/lib/leave-requests";
import { NotificationValidationError } from "@/lib/notifications";
import {
  OvertimePolicyConflictError,
  OvertimePolicyValidationError,
} from "@/lib/overtime-policies";
import {
  OvertimeRequestConflictError,
  OvertimeRequestValidationError,
} from "@/lib/overtime-requests";
import { WorkCalendarConflictError, WorkCalendarValidationError } from "@/lib/work-calendar";
import { ZodError } from "zod";
import {
  PayrollMappingConflictError,
  PayrollMappingValidationError,
} from "@/lib/payroll-employee-mappings";
import { PayrollResourceNotFoundError } from "@/lib/payroll-errors";
import {
  PayrollExportConflictError,
  PayrollExportIntegrityError,
  PayrollExportValidationError,
} from "@/lib/payroll-export-runs";
import { PayrollProfileConfigValidationError } from "@/lib/payroll-export-profile";
import {
  PayrollProfileConflictError,
  PayrollProfileValidationError,
} from "@/lib/payroll-export-profiles";
import { PayrollSourceValidationError } from "@/lib/payroll-source-rows";

export function domainErrorResponse(error: unknown, fallback: string) {
  if (error instanceof AuthorizationError) {
    return Response.json(
      { error: error.message },
      { status: error.message === "認証が必要です。" ? 401 : 403 },
    );
  }
  if (error instanceof PayrollResourceNotFoundError) {
    return Response.json({ error: error.message }, { status: 404 });
  }
  if (
    error instanceof AttendanceClosingConflictError ||
    error instanceof ApprovalCaseConflictError ||
    error instanceof ApprovalRouteConflictError ||
    error instanceof LeaveLedgerConflictError ||
    error instanceof LeaveRequestConflictError ||
    error instanceof OvertimePolicyConflictError ||
    error instanceof OvertimeRequestConflictError ||
    error instanceof WorkCalendarConflictError ||
    error instanceof PayrollMappingConflictError ||
    error instanceof PayrollProfileConflictError ||
    error instanceof PayrollExportConflictError ||
    error instanceof PayrollExportIntegrityError
  ) {
    return Response.json({ error: error.message }, { status: 409 });
  }
  if (error instanceof CsvImportValidationError) {
    return Response.json({ error: error.message, errors: error.errors }, { status: 422 });
  }
  if (error instanceof PayrollProfileConfigValidationError) {
    return Response.json({ error: error.message, errors: error.issues }, { status: 422 });
  }
  if (error instanceof PayrollMappingValidationError) {
    return Response.json({ error: error.message, errors: error.issues }, { status: 422 });
  }
  if (error instanceof PayrollExportValidationError) {
    return Response.json(
      { code: error.code, error: error.message, errors: error.issues },
      { status: 422 },
    );
  }
  if (error instanceof ZodError) {
    return Response.json(
      { error: "入力内容が正しくありません。", errors: error.issues },
      { status: 422 },
    );
  }
  if (
    error instanceof AttendanceClosingValidationError ||
    error instanceof ApprovalCaseValidationError ||
    error instanceof ApprovalRouteValidationError ||
    error instanceof LeaveLedgerValidationError ||
    error instanceof LeaveRequestValidationError ||
    error instanceof NotificationValidationError ||
    error instanceof OvertimePolicyValidationError ||
    error instanceof OvertimeRequestValidationError ||
    error instanceof WorkCalendarValidationError ||
    error instanceof PayrollProfileValidationError ||
    error instanceof PayrollSourceValidationError
  ) {
    return Response.json({ error: error.message }, { status: 422 });
  }
  console.error(fallback, error);
  return Response.json({ error: fallback }, { status: 500 });
}
