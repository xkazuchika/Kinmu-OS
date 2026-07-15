export type OrganizationTimezone = string;
export type WorkDate = `${string}-${string}-${string}`;

export type DailyMinutes = Readonly<{
  breakMinutes: number;
  overtimeMinutes: number;
  scheduledMinutes: number;
  workedMinutes: number;
}>;

export class TimeValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TimeValidationError";
  }
}

const datePartFormatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timezone: OrganizationTimezone) {
  const cached = datePartFormatterCache.get(timezone);

  if (cached) {
    return cached;
  }

  try {
    const formatter = new Intl.DateTimeFormat("en-CA", {
      day: "2-digit",
      month: "2-digit",
      timeZone: timezone,
      year: "numeric",
    });
    formatter.format(new Date());
    datePartFormatterCache.set(timezone, formatter);
    return formatter;
  } catch {
    throw new TimeValidationError("Timezone must be an IANA timezone identifier.");
  }
}

export function validateOrganizationTimezone(value: string): OrganizationTimezone {
  if (!value.trim()) {
    throw new TimeValidationError("Timezone is required.");
  }

  formatterFor(value);
  return value;
}

export function workDateFor(instant: Date, timezone: OrganizationTimezone): WorkDate {
  if (Number.isNaN(instant.getTime())) {
    throw new TimeValidationError("A valid instant is required.");
  }

  const parts = formatterFor(timezone).formatToParts(instant);
  const byType = new Map(parts.map((part) => [part.type, part.value]));
  const year = byType.get("year");
  const month = byType.get("month");
  const day = byType.get("day");

  if (!year || !month || !day) {
    throw new TimeValidationError("Could not determine the local work date.");
  }

  return `${year}-${month}-${day}`;
}

export function minutesBetween(startedAt: Date, endedAt: Date): number {
  const difference = endedAt.getTime() - startedAt.getTime();

  if (!Number.isFinite(difference) || difference < 0) {
    throw new TimeValidationError("An end time must not be before its start time.");
  }

  return Math.floor(difference / 60_000);
}

export function calculateDailyMinutes(input: {
  breaks: ReadonlyArray<Readonly<{ endedAt: Date; startedAt: Date }>>;
  clockInAt?: Date;
  clockOutAt?: Date;
  scheduledMinutes: number;
}): DailyMinutes {
  if (!Number.isInteger(input.scheduledMinutes) || input.scheduledMinutes < 0) {
    throw new TimeValidationError("Scheduled minutes must be a non-negative integer.");
  }

  if (!input.clockInAt || !input.clockOutAt) {
    return {
      breakMinutes: 0,
      overtimeMinutes: 0,
      scheduledMinutes: input.scheduledMinutes,
      workedMinutes: 0,
    };
  }

  const elapsedMinutes = minutesBetween(input.clockInAt, input.clockOutAt);
  const breakMinutes = input.breaks.reduce(
    (total, interval) => total + minutesBetween(interval.startedAt, interval.endedAt),
    0,
  );

  if (breakMinutes > elapsedMinutes) {
    throw new TimeValidationError("Break minutes cannot exceed elapsed work time.");
  }

  const workedMinutes = elapsedMinutes - breakMinutes;

  return {
    breakMinutes,
    overtimeMinutes: Math.max(0, workedMinutes - input.scheduledMinutes),
    scheduledMinutes: input.scheduledMinutes,
    workedMinutes,
  };
}
