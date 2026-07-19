import {
  AttendanceClosingConflictError,
  AttendanceClosingValidationError,
} from "@/lib/attendance-closing";
import { AuthorizationError } from "@/lib/authorization";
import { CsvImportValidationError } from "@/lib/csv-imports";
import { LeaveLedgerConflictError, LeaveLedgerValidationError } from "@/lib/leave-ledger";
import { LeaveRequestConflictError, LeaveRequestValidationError } from "@/lib/leave-requests";
import { WorkCalendarConflictError, WorkCalendarValidationError } from "@/lib/work-calendar";

export function domainErrorResponse(error: unknown, fallback: string) {
  if (error instanceof AuthorizationError) {
    return Response.json(
      { error: error.message },
      { status: error.message === "認証が必要です。" ? 401 : 403 },
    );
  }
  if (
    error instanceof AttendanceClosingConflictError ||
    error instanceof LeaveLedgerConflictError ||
    error instanceof LeaveRequestConflictError ||
    error instanceof WorkCalendarConflictError
  ) {
    return Response.json({ error: error.message }, { status: 409 });
  }
  if (error instanceof CsvImportValidationError) {
    return Response.json({ error: error.message, errors: error.errors }, { status: 422 });
  }
  if (
    error instanceof AttendanceClosingValidationError ||
    error instanceof LeaveLedgerValidationError ||
    error instanceof LeaveRequestValidationError ||
    error instanceof WorkCalendarValidationError
  ) {
    return Response.json({ error: error.message }, { status: 422 });
  }
  console.error(fallback, error);
  return Response.json({ error: fallback }, { status: 500 });
}
