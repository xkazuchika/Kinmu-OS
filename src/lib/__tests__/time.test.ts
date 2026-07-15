import { describe, expect, it } from "vitest";

import {
  TimeValidationError,
  calculateDailyMinutes,
  validateOrganizationTimezone,
  workDateFor,
} from "@/lib/time";

describe("organization time utilities", () => {
  it("uses the organization's timezone for the work-date boundary", () => {
    const instant = new Date("2026-07-14T15:30:00.000Z");

    expect(workDateFor(instant, "Asia/Tokyo")).toBe("2026-07-15");
    expect(workDateFor(instant, "America/Los_Angeles")).toBe("2026-07-14");
  });

  it("calculates actual work, breaks, and daily overtime in minutes", () => {
    const summary = calculateDailyMinutes({
      clockInAt: new Date("2026-07-15T00:00:00.000Z"),
      clockOutAt: new Date("2026-07-15T10:00:00.000Z"),
      scheduledMinutes: 480,
      breaks: [
        {
          startedAt: new Date("2026-07-15T04:00:00.000Z"),
          endedAt: new Date("2026-07-15T05:00:00.000Z"),
        },
      ],
    });

    expect(summary).toEqual({
      breakMinutes: 60,
      overtimeMinutes: 60,
      scheduledMinutes: 480,
      workedMinutes: 540,
    });
  });

  it("rejects an invalid timezone", () => {
    expect(() => validateOrganizationTimezone("Not/A-Timezone")).toThrow(TimeValidationError);
  });
});
