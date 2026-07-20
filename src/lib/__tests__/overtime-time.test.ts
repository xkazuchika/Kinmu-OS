import { describe, expect, it } from "vitest";

import {
  localDateTimeToInstant,
  OvertimeRequestValidationError,
  plannedOvertimeRange,
} from "@/lib/overtime-requests";

describe("overtime local time conversion", () => {
  it("converts organization-local time and preserves a next-day work-date owner", () => {
    expect(localDateTimeToInstant("Asia/Tokyo", "2026-08-03", "18:00").toISOString()).toBe(
      "2026-08-03T09:00:00.000Z",
    );
    expect(
      plannedOvertimeRange({
        endTime: "01:00",
        minuteIncrement: 15,
        plannedBreakMinutes: 30,
        startTime: "23:00",
        timezone: "Asia/Tokyo",
        workDate: "2026-08-03",
      }),
    ).toMatchObject({ endDate: "2026-08-04", plannedMinutes: 90, workDate: "2026-08-03" });
  });

  it("rejects nonexistent and ambiguous daylight-saving local times", () => {
    expect(() => localDateTimeToInstant("America/New_York", "2026-03-08", "02:30")).toThrow(
      OvertimeRequestValidationError,
    );
    expect(() => localDateTimeToInstant("America/New_York", "2026-11-01", "01:30")).toThrow("曖昧");
  });
});
