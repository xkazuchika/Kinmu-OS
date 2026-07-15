import { describe, expect, it } from "vitest";

import {
  AttendanceError,
  validateAttendanceEventSequence,
  type AttendanceEventRecord,
} from "@/lib/attendance";

function event(type: AttendanceEventRecord["type"], hour: number): AttendanceEventRecord {
  return { occurredAt: new Date(Date.UTC(2026, 6, 15, hour)), type };
}

describe("attendance event sequences", () => {
  it("accepts a complete work day and returns its final state", () => {
    expect(
      validateAttendanceEventSequence([
        event("clock_in", 0),
        event("break_start", 3),
        event("break_end", 4),
        event("clock_out", 9),
      ]),
    ).toBe("clock_out");
  });

  it("accepts an open work day without an unmatched break", () => {
    expect(validateAttendanceEventSequence([event("clock_in", 0)])).toBe("clock_in");
    expect(validateAttendanceEventSequence([])).toBe("none");
  });

  it("rejects invalid ordering, duplicate times, and an unmatched break", () => {
    expect(() => validateAttendanceEventSequence([event("clock_out", 9)])).toThrow(AttendanceError);
    expect(() =>
      validateAttendanceEventSequence([event("clock_in", 0), event("clock_out", 0)]),
    ).toThrow("前の記録より後");
    expect(() =>
      validateAttendanceEventSequence([event("clock_in", 0), event("break_start", 3)]),
    ).toThrow("休憩終了");
  });
});
