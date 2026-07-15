import { and, asc, eq, isNull } from "drizzle-orm";

import type { AppDatabase } from "@/lib/db/client";
import { employees, workRules } from "@/lib/db/schema";

export class WorkRuleManagementError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkRuleManagementError";
  }
}

function time(value: string, label: string) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
    throw new WorkRuleManagementError(`${label}はHH:mm形式で入力してください。`);
  }
  return value;
}

function date(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new WorkRuleManagementError("適用開始日を正しく入力してください。");
  }
  return value;
}

function minutes(value: number, label: string, maximum: number) {
  if (!Number.isInteger(value) || value < 0 || value > maximum) {
    throw new WorkRuleManagementError(`${label}を0〜${maximum}分で入力してください。`);
  }
  return value;
}

export async function createWorkRule(
  db: AppDatabase,
  input: {
    dailyStandardMinutes: number;
    effectiveFrom: string;
    employeeId?: string;
    name: string;
    organizationId: string;
    scheduledBreakMinutes: number;
    scheduledEndTime: string;
    scheduledStartTime: string;
  },
) {
  const name = input.name.trim();
  if (!name || name.length > 100) throw new WorkRuleManagementError("ルール名を入力してください。");
  if (input.employeeId) {
    const [employee] = await db
      .select({ id: employees.id })
      .from(employees)
      .where(
        and(eq(employees.id, input.employeeId), eq(employees.organizationId, input.organizationId)),
      )
      .limit(1);
    if (!employee) throw new WorkRuleManagementError("同じ組織の従業員を選択してください。");
  }
  const effectiveFrom = date(input.effectiveFrom);
  const duplicateConditions = [
    eq(workRules.organizationId, input.organizationId),
    eq(workRules.effectiveFrom, effectiveFrom),
  ];
  duplicateConditions.push(
    input.employeeId ? eq(workRules.employeeId, input.employeeId) : isNull(workRules.employeeId),
  );
  const [duplicate] = await db
    .select({ id: workRules.id })
    .from(workRules)
    .where(and(...duplicateConditions))
    .limit(1);
  if (duplicate)
    throw new WorkRuleManagementError("同じ対象・適用開始日の勤務ルールがすでにあります。");

  const [rule] = await db
    .insert(workRules)
    .values({
      dailyStandardMinutes: minutes(input.dailyStandardMinutes, "1日の所定労働時間", 1_440),
      effectiveFrom,
      employeeId: input.employeeId,
      name,
      organizationId: input.organizationId,
      scheduledBreakMinutes: minutes(input.scheduledBreakMinutes, "所定休憩", 720),
      scheduledEndTime: time(input.scheduledEndTime, "所定終了時刻"),
      scheduledStartTime: time(input.scheduledStartTime, "所定開始時刻"),
    })
    .returning();
  return rule;
}

export function listWorkRules(db: AppDatabase, organizationId: string) {
  return db
    .select({
      dailyStandardMinutes: workRules.dailyStandardMinutes,
      effectiveFrom: workRules.effectiveFrom,
      employeeId: workRules.employeeId,
      id: workRules.id,
      name: workRules.name,
      scheduledBreakMinutes: workRules.scheduledBreakMinutes,
      scheduledEndTime: workRules.scheduledEndTime,
      scheduledStartTime: workRules.scheduledStartTime,
    })
    .from(workRules)
    .where(eq(workRules.organizationId, organizationId))
    .orderBy(asc(workRules.effectiveFrom));
}
