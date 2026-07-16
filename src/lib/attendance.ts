import { and, asc, desc, eq, gte, isNull, lt, sql } from "drizzle-orm";

import type { SessionActor } from "@/lib/authorization";
import type { AppDatabase } from "@/lib/db/client";
import {
  attendanceDays,
  attendanceCorrectionRequests,
  attendanceEventType,
  attendanceEvents,
  dailyAttendanceSummaries,
  departments,
  employeeDepartments,
  employees,
  organizations,
} from "@/lib/db/schema";
import { assertEmployeeCanPunch } from "@/lib/employees";
import { findEffectiveWorkRule } from "@/lib/db/work-rules";
import { calculateDailyMinutes, workDateFor, type WorkDate } from "@/lib/time";
import {
  assertAttendanceMonthOpen,
  getAttendanceMonthStatus,
  listClosedAttendanceSnapshots,
  lockAttendanceMonth,
} from "@/lib/attendance-closing";

export type PunchType = (typeof attendanceEventType.enumValues)[number];
type QueryDatabase = Pick<AppDatabase, "select">;
type MutationDatabase = Pick<AppDatabase, "delete" | "insert" | "update">;

export type AttendanceEventRecord = {
  correctionRequestId?: string | null;
  id?: string;
  occurredAt: Date;
  source?: string;
  type: PunchType;
};

export class AttendanceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AttendanceError";
  }
}

export function validateAttendanceEventSequence(
  events: ReadonlyArray<AttendanceEventRecord>,
  options: { allowOpenBreak?: boolean } = {},
): PunchType | "none" {
  let state: PunchType | "none" = "none";
  let previousTime = Number.NEGATIVE_INFINITY;

  for (const event of events) {
    if (!attendanceEventType.enumValues.includes(event.type)) {
      throw new AttendanceError("打刻種別が正しくありません。");
    }
    const time = event.occurredAt.getTime();
    if (!Number.isFinite(time)) {
      throw new AttendanceError("打刻時刻が正しくありません。");
    }
    if (time <= previousTime) {
      throw new AttendanceError("打刻時刻は前の記録より後にしてください。");
    }
    if (!nextActions[state].includes(event.type)) {
      throw new AttendanceError("出勤・休憩・退勤の順序が正しくありません。");
    }
    state = event.type;
    previousTime = time;
  }

  if (state === "break_start" && !options.allowOpenBreak) {
    throw new AttendanceError("休憩開始には対応する休憩終了が必要です。");
  }

  return state;
}

export async function effectiveAttendanceEvents(db: QueryDatabase, attendanceDayId: string) {
  return db
    .select({
      correctionRequestId: attendanceEvents.correctionRequestId,
      id: attendanceEvents.id,
      occurredAt: attendanceEvents.occurredAt,
      source: attendanceEvents.source,
      type: attendanceEvents.type,
    })
    .from(attendanceEvents)
    .where(
      and(
        eq(attendanceEvents.attendanceDayId, attendanceDayId),
        isNull(attendanceEvents.supersededByCorrectionRequestId),
      ),
    )
    .orderBy(asc(attendanceEvents.occurredAt));
}

export async function recomputeAttendanceDay(
  db: QueryDatabase & MutationDatabase,
  day: typeof attendanceDays.$inferSelect,
  events: ReadonlyArray<AttendanceEventRecord>,
) {
  const state = validateAttendanceEventSequence(events, { allowOpenBreak: true });
  const completed = state === "clock_out";
  const now = new Date();

  await db
    .update(attendanceDays)
    .set({ status: completed ? "complete" : "open", updatedAt: now })
    .where(eq(attendanceDays.id, day.id));

  if (!completed) {
    await db
      .delete(dailyAttendanceSummaries)
      .where(eq(dailyAttendanceSummaries.attendanceDayId, day.id));
    return { state, status: "open" as const };
  }

  const breaks: Array<{ endedAt: Date; startedAt: Date }> = [];
  let breakStart: Date | undefined;
  for (const event of events) {
    if (event.type === "break_start") breakStart = event.occurredAt;
    if (event.type === "break_end" && breakStart) {
      breaks.push({ endedAt: event.occurredAt, startedAt: breakStart });
      breakStart = undefined;
    }
  }
  const minutes = calculateDailyMinutes({
    breaks,
    clockInAt: events.find((event) => event.type === "clock_in")?.occurredAt,
    clockOutAt: events.find((event) => event.type === "clock_out")?.occurredAt,
    scheduledMinutes: day.scheduledMinutes,
  });
  await db
    .insert(dailyAttendanceSummaries)
    .values({ attendanceDayId: day.id, ...minutes, status: "complete" })
    .onConflictDoUpdate({
      target: dailyAttendanceSummaries.attendanceDayId,
      set: { ...minutes, computedAt: now, status: "complete" },
    });

  return { minutes, state, status: "complete" as const };
}

function monthRange(month: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))
    throw new AttendanceError("対象月が正しくありません。");
  const [year, monthNumber] = month.split("-").map(Number);
  const next = new Date(Date.UTC(year, monthNumber, 1));
  return { from: `${month}-01`, to: next.toISOString().slice(0, 10) };
}

export async function getMonthlyAttendance(db: AppDatabase, actor: SessionActor, month: string) {
  const [employee] = await db
    .select({ id: employees.id, timezone: organizations.timezone })
    .from(employees)
    .innerJoin(organizations, eq(organizations.id, employees.organizationId))
    .where(
      and(eq(employees.organizationId, actor.organizationId), eq(employees.userId, actor.userId)),
    )
    .limit(1);
  if (!employee) throw new AttendanceError("従業員情報が紐付いていません。");
  const closed = await listClosedAttendanceSnapshots(db, actor.organizationId, month);
  if (closed) {
    const days = closed.rows
      .filter((row) => row.employeeId === employee.id)
      .slice()
      .reverse()
      .map((row) => ({
        breakMinutes: row.breakMinutes,
        correction: null,
        events: [],
        id: row.attendanceDayId ?? row.id,
        isCorrected: row.isCorrected,
        overtimeMinutes: row.overtimeMinutes,
        scheduledMinutes: row.scheduledMinutes,
        status: row.status,
        workDate: row.workDate,
        workedMinutes: row.workedMinutes,
      }));
    return {
      closure: closed.state,
      days,
      timezone: employee.timezone,
      totals: days.reduce(
        (total, day) => ({
          overtimeMinutes: total.overtimeMinutes + (day.overtimeMinutes ?? 0),
          scheduledMinutes: total.scheduledMinutes + day.scheduledMinutes,
          workedMinutes: total.workedMinutes + (day.workedMinutes ?? 0),
        }),
        { overtimeMinutes: 0, scheduledMinutes: 0, workedMinutes: 0 },
      ),
    };
  }
  const range = monthRange(month);
  const [dayRows, eventRows, correctionRows] = await Promise.all([
    db
      .select({
        breakMinutes: dailyAttendanceSummaries.breakMinutes,
        id: attendanceDays.id,
        isCorrected: sql<boolean>`exists (
          select 1 from ${attendanceEvents}
          where ${attendanceEvents.attendanceDayId} = ${attendanceDays.id}
            and ${attendanceEvents.correctionRequestId} is not null
            and ${attendanceEvents.supersededByCorrectionRequestId} is null
        )`,
        overtimeMinutes: dailyAttendanceSummaries.overtimeMinutes,
        scheduledMinutes: attendanceDays.scheduledMinutes,
        status: attendanceDays.status,
        workDate: attendanceDays.workDate,
        workedMinutes: dailyAttendanceSummaries.workedMinutes,
      })
      .from(attendanceDays)
      .leftJoin(
        dailyAttendanceSummaries,
        eq(dailyAttendanceSummaries.attendanceDayId, attendanceDays.id),
      )
      .where(
        and(
          eq(attendanceDays.employeeId, employee.id),
          gte(attendanceDays.workDate, range.from),
          lt(attendanceDays.workDate, range.to),
        ),
      )
      .orderBy(desc(attendanceDays.workDate)),
    db
      .select({
        attendanceDayId: attendanceEvents.attendanceDayId,
        id: attendanceEvents.id,
        occurredAt: attendanceEvents.occurredAt,
        type: attendanceEvents.type,
      })
      .from(attendanceEvents)
      .innerJoin(attendanceDays, eq(attendanceDays.id, attendanceEvents.attendanceDayId))
      .where(
        and(
          eq(attendanceDays.employeeId, employee.id),
          gte(attendanceDays.workDate, range.from),
          lt(attendanceDays.workDate, range.to),
          isNull(attendanceEvents.supersededByCorrectionRequestId),
        ),
      )
      .orderBy(asc(attendanceEvents.occurredAt)),
    db
      .select({
        id: attendanceCorrectionRequests.id,
        status: attendanceCorrectionRequests.status,
        workDate: attendanceCorrectionRequests.workDate,
      })
      .from(attendanceCorrectionRequests)
      .where(
        and(
          eq(attendanceCorrectionRequests.employeeId, employee.id),
          gte(attendanceCorrectionRequests.workDate, range.from),
          lt(attendanceCorrectionRequests.workDate, range.to),
        ),
      )
      .orderBy(desc(attendanceCorrectionRequests.createdAt)),
  ]);
  const eventsByDay = new Map<string, typeof eventRows>();
  for (const event of eventRows) {
    const events = eventsByDay.get(event.attendanceDayId) ?? [];
    events.push(event);
    eventsByDay.set(event.attendanceDayId, events);
  }
  const latestCorrectionByDate = new Map<string, (typeof correctionRows)[number]>();
  for (const correction of correctionRows) {
    if (!latestCorrectionByDate.has(correction.workDate)) {
      latestCorrectionByDate.set(correction.workDate, correction);
    }
  }
  const days = dayRows.map((day) => ({
    ...day,
    correction: latestCorrectionByDate.get(day.workDate) ?? null,
    events: (eventsByDay.get(day.id) ?? []).map((event) => ({
      id: event.id,
      occurredAt: event.occurredAt.toISOString(),
      type: event.type,
    })),
  }));
  return {
    closure: await getAttendanceMonthStatus(db, actor.organizationId, month),
    days,
    timezone: employee.timezone,
    totals: days.reduce(
      (total, day) => ({
        overtimeMinutes: total.overtimeMinutes + (day.overtimeMinutes ?? 0),
        scheduledMinutes: total.scheduledMinutes + day.scheduledMinutes,
        workedMinutes: total.workedMinutes + (day.workedMinutes ?? 0),
      }),
      { overtimeMinutes: 0, scheduledMinutes: 0, workedMinutes: 0 },
    ),
  };
}

export async function listManagedAttendance(
  db: AppDatabase,
  input: {
    departmentId?: string;
    employeeId?: string;
    month: string;
    openOnly?: boolean;
    organizationId: string;
  },
) {
  const closed = await listClosedAttendanceSnapshots(db, input.organizationId, input.month);
  if (closed) {
    return closed.rows
      .filter((row) => !input.departmentId || row.departmentId === input.departmentId)
      .filter((row) => !input.employeeId || row.employeeId === input.employeeId)
      .filter((row) => !input.openOnly || row.status === "open")
      .slice()
      .reverse()
      .map((row) => ({
        departmentName: row.departmentName ?? "—",
        displayName: row.displayName,
        employeeId: row.employeeId,
        isCorrected: row.isCorrected,
        overtimeMinutes: row.overtimeMinutes,
        scheduledMinutes: row.scheduledMinutes,
        status: row.status,
        workDate: row.workDate,
        workedMinutes: row.workedMinutes,
      }));
  }
  const range = monthRange(input.month);
  const conditions = [
    eq(attendanceDays.organizationId, input.organizationId),
    gte(attendanceDays.workDate, range.from),
    lt(attendanceDays.workDate, range.to),
    eq(employeeDepartments.isPrimary, true),
    isNull(employeeDepartments.endedOn),
  ];
  if (input.departmentId) conditions.push(eq(departments.id, input.departmentId));
  if (input.employeeId) conditions.push(eq(employees.id, input.employeeId));
  if (input.openOnly) conditions.push(eq(attendanceDays.status, "open"));
  return db
    .select({
      departmentName: departments.name,
      displayName: employees.displayName,
      employeeId: employees.id,
      isCorrected: sql<boolean>`exists (
        select 1 from ${attendanceEvents}
        where ${attendanceEvents.attendanceDayId} = ${attendanceDays.id}
          and ${attendanceEvents.correctionRequestId} is not null
          and ${attendanceEvents.supersededByCorrectionRequestId} is null
      )`,
      overtimeMinutes: dailyAttendanceSummaries.overtimeMinutes,
      scheduledMinutes: attendanceDays.scheduledMinutes,
      status: attendanceDays.status,
      workDate: attendanceDays.workDate,
      workedMinutes: dailyAttendanceSummaries.workedMinutes,
    })
    .from(attendanceDays)
    .innerJoin(employees, eq(employees.id, attendanceDays.employeeId))
    .innerJoin(employeeDepartments, eq(employeeDepartments.employeeId, employees.id))
    .innerJoin(departments, eq(departments.id, employeeDepartments.departmentId))
    .leftJoin(
      dailyAttendanceSummaries,
      eq(dailyAttendanceSummaries.attendanceDayId, attendanceDays.id),
    )
    .where(and(...conditions))
    .orderBy(desc(attendanceDays.workDate), asc(employees.displayName));
}

const nextActions: Record<PunchType | "none", PunchType[]> = {
  break_end: ["break_start", "clock_out"],
  break_start: ["break_end"],
  clock_in: ["break_start", "clock_out"],
  clock_out: [],
  none: ["clock_in"],
};

const stateLabels: Record<PunchType | "none", string> = {
  break_end: "勤務中",
  break_start: "休憩中",
  clock_in: "勤務中",
  clock_out: "退勤済み",
  none: "未出勤",
};

async function attendanceContext(db: AppDatabase, actor: SessionActor, instant: Date) {
  const [context] = await db
    .select({
      employeeId: employees.id,
      leftOn: employees.leftOn,
      status: employees.status,
      timezone: organizations.timezone,
    })
    .from(employees)
    .innerJoin(organizations, eq(organizations.id, employees.organizationId))
    .where(
      and(eq(employees.organizationId, actor.organizationId), eq(employees.userId, actor.userId)),
    )
    .limit(1);

  if (!context) throw new AttendanceError("従業員情報が紐付いていません。");
  const today = workDateFor(instant, context.timezone);
  assertEmployeeCanPunch(context, today);
  return { ...context, today };
}

async function relevantDay(db: QueryDatabase, employeeId: string, today: string) {
  const [openDay] = await db
    .select()
    .from(attendanceDays)
    .where(and(eq(attendanceDays.employeeId, employeeId), eq(attendanceDays.status, "open")))
    .orderBy(desc(attendanceDays.workDate))
    .limit(1);

  if (openDay) return openDay;
  const [todayDay] = await db
    .select()
    .from(attendanceDays)
    .where(and(eq(attendanceDays.employeeId, employeeId), eq(attendanceDays.workDate, today)))
    .limit(1);
  return todayDay;
}

async function stateForDay(db: QueryDatabase, day: typeof attendanceDays.$inferSelect | undefined) {
  const events = day ? await effectiveAttendanceEvents(db, day.id) : [];
  const lastType = events.at(-1)?.type ?? "none";

  return {
    actions: nextActions[lastType],
    events,
    state: lastType,
    stateLabel: stateLabels[lastType],
    workDate: day?.workDate,
  };
}

export async function getAttendanceState(
  db: AppDatabase,
  actor: SessionActor,
  instant = new Date(),
) {
  const context = await attendanceContext(db, actor, instant);
  const day = await relevantDay(db, context.employeeId, context.today);
  return {
    ...(await stateForDay(db, day)),
    employeeId: context.employeeId,
    workDate: day?.workDate ?? context.today,
  };
}

export async function punchAttendance(
  db: AppDatabase,
  actor: SessionActor,
  input: { occurredAt?: Date; type: string },
) {
  if (!attendanceEventType.enumValues.includes(input.type as PunchType)) {
    throw new AttendanceError("打刻種別が正しくありません。");
  }
  const occurredAt = input.occurredAt ?? new Date();
  const context = await attendanceContext(db, actor, occurredAt);

  return db.transaction(async (transaction) => {
    await lockAttendanceMonth(transaction, actor.organizationId, context.today.slice(0, 7));
    await assertAttendanceMonthOpen(transaction, actor.organizationId, context.today);
    await transaction.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`${context.employeeId}:${context.today}`}))`,
    );
    let day = await relevantDay(transaction, context.employeeId, context.today);
    const state = await stateForDay(transaction, day);
    const type = input.type as PunchType;

    if (!state.actions.includes(type)) {
      throw new AttendanceError(
        type === "clock_out" && state.state === "none"
          ? "退勤する前に出勤が必要です。"
          : "現在の勤怠状態ではこの打刻を記録できません。",
      );
    }
    const latest = state.events.at(-1);
    if (latest && occurredAt <= latest.occurredAt) {
      throw new AttendanceError("直前の打刻より後の時刻を記録してください。");
    }
    if (!day) {
      const rule = await findEffectiveWorkRule(transaction, {
        employeeId: context.employeeId,
        organizationId: actor.organizationId,
        workDate: context.today as WorkDate,
      });
      [day] = await transaction
        .insert(attendanceDays)
        .values({
          employeeId: context.employeeId,
          organizationId: actor.organizationId,
          scheduledMinutes: rule?.dailyStandardMinutes ?? 0,
          workDate: context.today,
          workRuleId: rule?.id,
        })
        .returning();
    }
    const [event] = await transaction
      .insert(attendanceEvents)
      .values({
        attendanceDayId: day.id,
        employeeId: context.employeeId,
        occurredAt,
        organizationId: actor.organizationId,
        recordedByUserId: actor.userId,
        source: "web",
        type,
      })
      .returning({
        correctionRequestId: attendanceEvents.correctionRequestId,
        id: attendanceEvents.id,
        occurredAt: attendanceEvents.occurredAt,
        source: attendanceEvents.source,
        type: attendanceEvents.type,
      });
    const events = [...state.events, event];
    await recomputeAttendanceDay(transaction, day, events);
    await transaction
      .update(attendanceDays)
      .set({ revision: sql`${attendanceDays.revision} + 1`, updatedAt: new Date() })
      .where(eq(attendanceDays.id, day.id));

    return {
      ...(await stateForDay(transaction, day)),
      employeeId: context.employeeId,
      workDate: day.workDate,
    };
  });
}
