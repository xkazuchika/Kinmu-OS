import { describe, expect, it } from "vitest";

import {
  AttendanceClosingValidationError,
  attendanceMonthRange,
  currentMonthInTimezone,
  isEndedAttendanceMonth,
  validateTargetMonth,
} from "@/lib/attendance-closing";

describe("attendance closing month rules", () => {
  it("validates a calendar month and calculates its half-open date range", () => {
    expect(validateTargetMonth("2026-02")).toBe("2026-02");
    expect(attendanceMonthRange("2026-02")).toEqual({ from: "2026-02-01", to: "2026-03-01" });
    expect(attendanceMonthRange("2026-12")).toEqual({ from: "2026-12-01", to: "2027-01-01" });
    expect(() => validateTargetMonth("2026-13")).toThrow(AttendanceClosingValidationError);
    expect(() => validateTargetMonth("2026-2")).toThrow(AttendanceClosingValidationError);
  });

  it("uses the organization timezone for the current and ended month", () => {
    const instant = new Date("2026-06-30T15:30:00.000Z");
    expect(currentMonthInTimezone("Asia/Tokyo", instant)).toBe("2026-07");
    expect(currentMonthInTimezone("UTC", instant)).toBe("2026-06");
    expect(isEndedAttendanceMonth("2026-06", "Asia/Tokyo", instant)).toBe(true);
    expect(isEndedAttendanceMonth("2026-06", "UTC", instant)).toBe(false);
  });
});
