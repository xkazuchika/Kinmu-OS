import { and, asc, desc, eq, gte, isNull, lt, sql } from "drizzle-orm";

import type { SessionActor } from "@/lib/authorization";
import type { AppDatabase } from "@/lib/db/client";
import {
  attendanceDays,
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

export type PunchType = (typeof attendanceEventType.enumValues)[number];
type QueryDatabase = Pick<AppDatabase, "select">;

export class AttendanceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AttendanceError";
  }
}

function monthRange(month: string) {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new AttendanceError("対象月が正しくありません。");
  const [year, monthNumber] = month.split("-").map(Number);
  const next = new Date(Date.UTC(year, monthNumber, 1));
  return { from: `${month}-01`, to: next.toISOString().slice(0, 10) };
}

export async function getMonthlyAttendance(db: AppDatabase, actor: SessionActor, month: string) {
  const [employee] = await db
    .select({ id: employees.id })
    .from(employees)
    .where(
      and(eq(employees.organizationId, actor.organizationId), eq(employees.userId, actor.userId)),
    )
    .limit(1);
  if (!employee) throw new AttendanceError("従業員情報が紐付いていません。");
  const range = monthRange(month);
  const days = await db
    .select({
      breakMinutes: dailyAttendanceSummaries.breakMinutes,
      id: attendanceDays.id,
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
    .orderBy(desc(attendanceDays.workDate));
  return {
    days,
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
  const events = day
    ? await db
        .select({ occurredAt: attendanceEvents.occurredAt, type: attendanceEvents.type })
        .from(attendanceEvents)
        .where(eq(attendanceEvents.attendanceDayId, day.id))
        .orderBy(asc(attendanceEvents.occurredAt))
    : [];
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
    await transaction.insert(attendanceEvents).values({
      attendanceDayId: day.id,
      employeeId: context.employeeId,
      occurredAt,
      organizationId: actor.organizationId,
      recordedByUserId: actor.userId,
      source: "web",
      type,
    });
    if (type === "clock_out") {
      await transaction
        .update(attendanceDays)
        .set({ status: "complete", updatedAt: new Date() })
        .where(eq(attendanceDays.id, day.id));
      const completedEvents = [...state.events, { occurredAt, type }];
      const breaks: Array<{ endedAt: Date; startedAt: Date }> = [];
      let breakStart: Date | undefined;
      for (const event of completedEvents) {
        if (event.type === "break_start") breakStart = event.occurredAt;
        if (event.type === "break_end" && breakStart) {
          breaks.push({ endedAt: event.occurredAt, startedAt: breakStart });
          breakStart = undefined;
        }
      }
      const minutes = calculateDailyMinutes({
        breaks,
        clockInAt: completedEvents.find((event) => event.type === "clock_in")?.occurredAt,
        clockOutAt: occurredAt,
        scheduledMinutes: day.scheduledMinutes,
      });
      await transaction
        .insert(dailyAttendanceSummaries)
        .values({ attendanceDayId: day.id, ...minutes, status: "complete" })
        .onConflictDoUpdate({
          target: dailyAttendanceSummaries.attendanceDayId,
          set: { ...minutes, computedAt: new Date(), status: "complete" },
        });
    }

    const updatedDay = type === "clock_out" ? { ...day, status: "complete" as const } : day;
    return {
      ...(await stateForDay(transaction, updatedDay)),
      employeeId: context.employeeId,
      workDate: day.workDate,
    };
  });
}
