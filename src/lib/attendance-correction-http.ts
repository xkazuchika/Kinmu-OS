import {
  AttendanceCorrectionConflictError,
  AttendanceCorrectionValidationError,
} from "@/lib/attendance-corrections";
import { AttendanceClosingConflictError } from "@/lib/attendance-closing";
import { AuthorizationError } from "@/lib/authorization";

export function attendanceCorrectionErrorResponse(error: unknown, fallback: string) {
  if (error instanceof AuthorizationError) {
    return Response.json({ error: error.message }, { status: 403 });
  }
  if (error instanceof AttendanceCorrectionValidationError) {
    return Response.json({ error: error.message }, { status: 422 });
  }
  if (
    error instanceof AttendanceCorrectionConflictError ||
    error instanceof AttendanceClosingConflictError
  ) {
    return Response.json({ error: error.message }, { status: 409 });
  }
  console.error(fallback, error);
  return Response.json({ error: fallback }, { status: 500 });
}
