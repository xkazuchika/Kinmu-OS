import { createHash } from "node:crypto";

import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";

import { assertAttendanceMonthOpen, lockAttendanceMonth } from "@/lib/attendance-closing";
import { recordAudit } from "@/lib/audit";
import type { SessionActor } from "@/lib/authorization";
import { requireEmployeeScope, requirePermission } from "@/lib/authorization";
import { CsvImportValidationError, csvRecords, type CsvImportError } from "@/lib/csv-imports";
import type { AppDatabase } from "@/lib/db/client";
import {
  employees,
  departments,
  employeeDepartments,
  importBatches,
  leaveBalanceAccounts,
  leaveGrantLots,
  leaveRequestDays,
  leaveRequests,
  leaveTransactions,
  leaveTypes,
} from "@/lib/db/schema";
import { validateWorkDate } from "@/lib/work-calendar";

type LedgerDatabase = Pick<AppDatabase, "execute" | "insert" | "select" | "update">;
type LeaveTypeInput = Readonly<{
  active?: boolean;
  code: string;
  consumesBalance: boolean;
  effectiveFrom: string;
  effectiveTo?: string | null;
  name: string;
  paid: boolean;
  requestable: boolean;
}>;

export class LeaveLedgerValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LeaveLedgerValidationError";
  }
}

export class LeaveLedgerConflictError extends Error {
  constructor(message = "休暇残高が更新されています。再読み込みしてやり直してください。") {
    super(message);
    this.name = "LeaveLedgerConflictError";
  }
}

function required(value: string, label: string, maxLength = 200) {
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    throw new LeaveLedgerValidationError(`${label}は1〜${maxLength}文字で入力してください。`);
  }
  return normalized;
}

function positiveUnits(value: number, label = "単位") {
  if (!Number.isInteger(value) || value <= 0) {
    throw new LeaveLedgerValidationError(`${label}は正の半日単位で入力してください。`);
  }
  return value;
}

function normalizeLeaveTypeInput(input: LeaveTypeInput) {
  const effectiveFrom = validateWorkDate(input.effectiveFrom, "有効開始日");
  const effectiveTo = input.effectiveTo ? validateWorkDate(input.effectiveTo, "有効終了日") : null;
  if (effectiveTo && effectiveTo < effectiveFrom) {
    throw new LeaveLedgerValidationError("有効終了日は有効開始日以後にしてください。");
  }
  return {
    active: input.active ?? true,
    code: required(input.code, "コード", 32).toUpperCase(),
    consumesBalance: input.consumesBalance,
    effectiveFrom,
    effectiveTo,
    name: required(input.name, "表示名", 100),
    paid: input.paid,
    requestable: input.requestable,
  };
}

export async function createLeaveType(db: AppDatabase, actor: SessionActor, input: LeaveTypeInput) {
  requirePermission(actor, "leave:manage");
  const values = normalizeLeaveTypeInput(input);
  const [created] = await db
    .insert(leaveTypes)
    .values({ ...values, organizationId: actor.organizationId })
    .returning();
  await recordAudit(db, {
    action: "leave_type_changed",
    actorUserId: actor.userId,
    entityId: created.id,
    entityType: "leave_type",
    metadata: { action: "created", code: created.code },
    organizationId: actor.organizationId,
  });
  return created;
}

export async function updateLeaveType(
  db: AppDatabase,
  actor: SessionActor,
  leaveTypeId: string,
  input: LeaveTypeInput,
) {
  requirePermission(actor, "leave:manage");
  const values = normalizeLeaveTypeInput(input);
  const [existing] = await db
    .select()
    .from(leaveTypes)
    .where(and(eq(leaveTypes.id, leaveTypeId), eq(leaveTypes.organizationId, actor.organizationId)))
    .limit(1);
  if (!existing) throw new LeaveLedgerValidationError("休暇種別を確認できませんでした。");
  const [used] = await db
    .select({ id: leaveRequests.id })
    .from(leaveRequests)
    .where(eq(leaveRequests.leaveTypeId, leaveTypeId))
    .limit(1);
  const [account] = await db
    .select({ id: leaveBalanceAccounts.id })
    .from(leaveBalanceAccounts)
    .where(eq(leaveBalanceAccounts.leaveTypeId, leaveTypeId))
    .limit(1);
  if (
    (used || account) &&
    (values.code !== existing.code ||
      values.paid !== existing.paid ||
      values.consumesBalance !== existing.consumesBalance)
  ) {
    throw new LeaveLedgerValidationError(
      "利用済み休暇種別のコード・有給区分・残高消費区分は変更できません。無効化して新しい種別を作成してください。",
    );
  }
  const [updated] = await db
    .update(leaveTypes)
    .set({ ...values, updatedAt: new Date() })
    .where(and(eq(leaveTypes.id, leaveTypeId), eq(leaveTypes.organizationId, actor.organizationId)))
    .returning();
  await recordAudit(db, {
    action: "leave_type_changed",
    actorUserId: actor.userId,
    entityId: updated.id,
    entityType: "leave_type",
    metadata: { action: updated.active ? "updated" : "deactivated", code: updated.code },
    organizationId: actor.organizationId,
  });
  return updated;
}

export async function deactivateLeaveType(
  db: AppDatabase,
  actor: SessionActor,
  leaveTypeId: string,
) {
  const [existing] = await db
    .select()
    .from(leaveTypes)
    .where(and(eq(leaveTypes.id, leaveTypeId), eq(leaveTypes.organizationId, actor.organizationId)))
    .limit(1);
  if (!existing) throw new LeaveLedgerValidationError("休暇種別を確認できませんでした。");
  return updateLeaveType(db, actor, leaveTypeId, { ...existing, active: false });
}

export async function listLeaveTypes(db: Pick<AppDatabase, "select">, actor: SessionActor) {
  const conditions = [eq(leaveTypes.organizationId, actor.organizationId)];
  if (actor.role === "employee") {
    conditions.push(eq(leaveTypes.active, true), eq(leaveTypes.requestable, true));
  }
  return db
    .select()
    .from(leaveTypes)
    .where(and(...conditions))
    .orderBy(asc(leaveTypes.code));
}

async function requireEmployeeAndType(
  db: LedgerDatabase,
  input: { employeeId: string; leaveTypeId: string; organizationId: string },
) {
  const [row] = await db
    .select({
      consumesBalance: leaveTypes.consumesBalance,
      employeeId: employees.id,
      leaveTypeId: leaveTypes.id,
    })
    .from(employees)
    .innerJoin(
      leaveTypes,
      and(
        eq(leaveTypes.id, input.leaveTypeId),
        eq(leaveTypes.organizationId, input.organizationId),
      ),
    )
    .where(
      and(eq(employees.id, input.employeeId), eq(employees.organizationId, input.organizationId)),
    )
    .limit(1);
  if (!row) throw new LeaveLedgerValidationError("従業員または休暇種別を確認できませんでした。");
  if (!row.consumesBalance) {
    throw new LeaveLedgerValidationError("残高を消費しない休暇種別には付与できません。");
  }
  return row;
}

async function lockOrCreateAccount(
  db: LedgerDatabase,
  input: { employeeId: string; leaveTypeId: string; organizationId: string },
) {
  await db
    .insert(leaveBalanceAccounts)
    .values(input)
    .onConflictDoNothing({
      target: [leaveBalanceAccounts.employeeId, leaveBalanceAccounts.leaveTypeId],
    });
  const rows = await db.execute(sql`
    SELECT *
    FROM ${leaveBalanceAccounts}
    WHERE ${leaveBalanceAccounts.employeeId} = ${input.employeeId}
      AND ${leaveBalanceAccounts.leaveTypeId} = ${input.leaveTypeId}
      AND ${leaveBalanceAccounts.organizationId} = ${input.organizationId}
    FOR UPDATE
  `);
  const account = (rows as unknown as Array<{ id: string; version: number }>)[0];
  if (!account) throw new LeaveLedgerConflictError();
  return account;
}

async function incrementAccountVersion(
  db: LedgerDatabase,
  account: { id: string; version: number },
  expectedVersion?: number,
) {
  if (expectedVersion !== undefined && account.version !== expectedVersion) {
    throw new LeaveLedgerConflictError();
  }
  const [updated] = await db
    .update(leaveBalanceAccounts)
    .set({ updatedAt: new Date(), version: account.version + 1 })
    .where(
      and(
        eq(leaveBalanceAccounts.id, account.id),
        eq(leaveBalanceAccounts.version, account.version),
      ),
    )
    .returning({ version: leaveBalanceAccounts.version });
  if (!updated) throw new LeaveLedgerConflictError();
  return updated.version;
}

async function lotBalances(db: LedgerDatabase, accountId: string, asOf: string) {
  const lots = await db
    .select()
    .from(leaveGrantLots)
    .where(and(eq(leaveGrantLots.accountId, accountId), lte(leaveGrantLots.grantedOn, asOf)))
    .orderBy(asc(leaveGrantLots.expiresOn), asc(leaveGrantLots.grantedOn), asc(leaveGrantLots.id));
  const transactions = await db
    .select()
    .from(leaveTransactions)
    .where(
      and(eq(leaveTransactions.accountId, accountId), lte(leaveTransactions.effectiveOn, asOf)),
    )
    .orderBy(asc(leaveTransactions.effectiveOn), asc(leaveTransactions.createdAt));
  const unitsByLot = new Map<string, number>();
  let unallocatedUnits = 0;
  for (const transaction of transactions) {
    if (transaction.grantLotId) {
      unitsByLot.set(
        transaction.grantLotId,
        (unitsByLot.get(transaction.grantLotId) ?? 0) + transaction.units,
      );
    } else {
      unallocatedUnits += transaction.units;
    }
  }
  return {
    lots: lots.map((lot) => ({
      ...lot,
      expired: Boolean(lot.expiresOn && lot.expiresOn < asOf),
      remainingUnits: unitsByLot.get(lot.id) ?? 0,
    })),
    transactions,
    unallocatedUnits,
  };
}

export async function getLeaveBalance(
  db: LedgerDatabase,
  input: { employeeId: string; leaveTypeId: string; organizationId: string; asOf: string },
) {
  const asOf = validateWorkDate(input.asOf, "基準日");
  const [account] = await db
    .select()
    .from(leaveBalanceAccounts)
    .where(
      and(
        eq(leaveBalanceAccounts.employeeId, input.employeeId),
        eq(leaveBalanceAccounts.leaveTypeId, input.leaveTypeId),
        eq(leaveBalanceAccounts.organizationId, input.organizationId),
      ),
    )
    .limit(1);
  if (!account) {
    return {
      accountId: null,
      availableUnits: 0,
      expiredUnits: 0,
      ledgerUnits: 0,
      nextExpiry: null,
      pendingUnits: 0,
      version: 0,
    };
  }
  const state = await lotBalances(db, account.id, asOf);
  const ledgerUnits =
    state.unallocatedUnits +
    state.lots.filter((lot) => !lot.expired).reduce((sum, lot) => sum + lot.remainingUnits, 0);
  const expiredUnits = state.lots
    .filter((lot) => lot.expired)
    .reduce((sum, lot) => sum + Math.max(0, lot.remainingUnits), 0);
  const pendingRows = await db
    .select({ units: leaveRequestDays.units })
    .from(leaveRequestDays)
    .innerJoin(leaveRequests, eq(leaveRequests.id, leaveRequestDays.requestId))
    .where(
      and(
        eq(leaveRequests.organizationId, input.organizationId),
        eq(leaveRequests.employeeId, input.employeeId),
        eq(leaveRequests.leaveTypeId, input.leaveTypeId),
        eq(leaveRequests.status, "pending"),
      ),
    );
  const pendingUnits = pendingRows.reduce((sum, row) => sum + row.units, 0);
  const nextExpiry =
    state.lots
      .filter((lot) => !lot.expired && lot.expiresOn && lot.remainingUnits > 0)
      .sort((left, right) => left.expiresOn!.localeCompare(right.expiresOn!))[0]?.expiresOn ?? null;
  return {
    accountId: account.id,
    availableUnits: ledgerUnits - pendingUnits,
    expiredUnits,
    ledgerUnits,
    nextExpiry,
    pendingUnits,
    version: account.version,
  };
}

async function grantLeaveInternal(
  db: LedgerDatabase,
  actor: SessionActor,
  input: {
    employeeId: string;
    expectedVersion?: number;
    expiresOn?: string | null;
    grantedOn: string;
    leaveTypeId: string;
    reason: string;
    units: number;
  },
  audit = true,
) {
  const units = positiveUnits(input.units);
  const grantedOn = validateWorkDate(input.grantedOn, "付与日");
  const expiresOn = input.expiresOn ? validateWorkDate(input.expiresOn, "有効期限") : null;
  if (expiresOn && expiresOn < grantedOn) {
    throw new LeaveLedgerValidationError("有効期限は付与日以後にしてください。");
  }
  const reason = required(input.reason, "理由", 500);
  await requireEmployeeAndType(db, { ...input, organizationId: actor.organizationId });
  const account = await lockOrCreateAccount(db, {
    employeeId: input.employeeId,
    leaveTypeId: input.leaveTypeId,
    organizationId: actor.organizationId,
  });
  if (input.expectedVersion !== undefined && account.version !== input.expectedVersion) {
    throw new LeaveLedgerConflictError();
  }
  const [lot] = await db
    .insert(leaveGrantLots)
    .values({
      accountId: account.id,
      createdByUserId: actor.userId,
      employeeId: input.employeeId,
      expiresOn,
      grantedOn,
      grantedUnits: units,
      leaveTypeId: input.leaveTypeId,
      organizationId: actor.organizationId,
      reason,
    })
    .returning();
  const [transaction] = await db
    .insert(leaveTransactions)
    .values({
      accountId: account.id,
      createdByUserId: actor.userId,
      effectiveOn: grantedOn,
      employeeId: input.employeeId,
      grantLotId: lot.id,
      kind: "grant",
      leaveTypeId: input.leaveTypeId,
      organizationId: actor.organizationId,
      reason,
      units,
    })
    .returning();
  const version = await incrementAccountVersion(db, account);
  if (audit) {
    await recordAudit(db, {
      action: "leave_balance_changed",
      actorUserId: actor.userId,
      entityId: transaction.id,
      entityType: "leave_grant",
      metadata: { employeeId: input.employeeId, expiresOn, grantedOn, reason, units },
      organizationId: actor.organizationId,
    });
  }
  return { lot, transaction, version };
}

export async function grantLeave(
  db: AppDatabase,
  actor: SessionActor,
  input: Parameters<typeof grantLeaveInternal>[2],
) {
  requirePermission(actor, "leave:manage");
  const grantedOn = validateWorkDate(input.grantedOn, "付与日");
  return db.transaction(async (transaction) => {
    await lockAttendanceMonth(transaction, actor.organizationId, grantedOn.slice(0, 7));
    await assertAttendanceMonthOpen(transaction, actor.organizationId, grantedOn);
    return grantLeaveInternal(transaction, actor, input);
  });
}

async function allocateFromLots(
  db: LedgerDatabase,
  input: { accountId: string; asOf: string; units: number },
) {
  const state = await lotBalances(db, input.accountId, input.asOf);
  let needed = input.units;
  const allocations: Array<{ grantLotId: string; units: number }> = [];
  for (const lot of state.lots.filter(
    (candidate) => !candidate.expired && candidate.remainingUnits > 0,
  )) {
    const units = Math.min(needed, lot.remainingUnits);
    allocations.push({ grantLotId: lot.id, units });
    needed -= units;
    if (needed === 0) break;
  }
  if (needed > 0) throw new LeaveLedgerValidationError(`休暇残高が${needed}単位不足しています。`);
  return allocations;
}

export async function adjustLeaveBalance(
  db: AppDatabase,
  actor: SessionActor,
  input: {
    effectiveOn: string;
    employeeId: string;
    expectedVersion?: number;
    leaveTypeId: string;
    reason: string;
    units: number;
  },
) {
  requirePermission(actor, "leave:manage");
  if (!Number.isInteger(input.units) || input.units === 0) {
    throw new LeaveLedgerValidationError("調整単位は0以外の半日単位で入力してください。");
  }
  const effectiveOn = validateWorkDate(input.effectiveOn, "調整日");
  const reason = required(input.reason, "理由", 500);
  return db.transaction(async (transaction) => {
    await lockAttendanceMonth(transaction, actor.organizationId, effectiveOn.slice(0, 7));
    await assertAttendanceMonthOpen(transaction, actor.organizationId, effectiveOn);
    await requireEmployeeAndType(transaction, { ...input, organizationId: actor.organizationId });
    const account = await lockOrCreateAccount(transaction, {
      employeeId: input.employeeId,
      leaveTypeId: input.leaveTypeId,
      organizationId: actor.organizationId,
    });
    if (input.expectedVersion !== undefined && input.expectedVersion !== account.version) {
      throw new LeaveLedgerConflictError();
    }
    let allocations: Array<{ grantLotId: string; units: number }>;
    if (input.units > 0) {
      const [lot] = await transaction
        .insert(leaveGrantLots)
        .values({
          accountId: account.id,
          createdByUserId: actor.userId,
          employeeId: input.employeeId,
          grantedOn: effectiveOn,
          grantedUnits: input.units,
          leaveTypeId: input.leaveTypeId,
          organizationId: actor.organizationId,
          reason,
        })
        .returning();
      allocations = [{ grantLotId: lot.id, units: input.units }];
    } else {
      allocations = (
        await allocateFromLots(transaction, {
          accountId: account.id,
          asOf: effectiveOn,
          units: Math.abs(input.units),
        })
      ).map((allocation) => ({ ...allocation, units: -allocation.units }));
    }
    const transactions = await transaction
      .insert(leaveTransactions)
      .values(
        allocations.map((allocation) => ({
          accountId: account.id,
          createdByUserId: actor.userId,
          effectiveOn,
          employeeId: input.employeeId,
          grantLotId: allocation.grantLotId,
          kind: "adjustment" as const,
          leaveTypeId: input.leaveTypeId,
          organizationId: actor.organizationId,
          reason,
          units: allocation.units,
        })),
      )
      .returning();
    const version = await incrementAccountVersion(transaction, account);
    await recordAudit(transaction, {
      action: "leave_balance_changed",
      actorUserId: actor.userId,
      entityId: account.id,
      entityType: "leave_adjustment",
      metadata: { effectiveOn, employeeId: input.employeeId, reason, units: input.units },
      organizationId: actor.organizationId,
    });
    return { transactions, version };
  });
}

export async function consumeLeaveBalance(
  db: LedgerDatabase,
  actor: SessionActor,
  input: {
    accountId: string;
    effectiveOn: string;
    employeeId: string;
    expectedVersion?: number;
    leaveTypeId: string;
    reason: string;
    requestId: string;
    units: number;
  },
) {
  const rows = await db.execute(sql`
    SELECT id, version
    FROM ${leaveBalanceAccounts}
    WHERE ${leaveBalanceAccounts.id} = ${input.accountId}
      AND ${leaveBalanceAccounts.organizationId} = ${actor.organizationId}
      AND ${leaveBalanceAccounts.employeeId} = ${input.employeeId}
      AND ${leaveBalanceAccounts.leaveTypeId} = ${input.leaveTypeId}
    FOR UPDATE
  `);
  const account = (rows as unknown as Array<{ id: string; version: number }>)[0];
  if (
    !account ||
    (input.expectedVersion !== undefined && input.expectedVersion !== account.version)
  ) {
    throw new LeaveLedgerConflictError();
  }
  const allocations = await allocateFromLots(db, {
    accountId: input.accountId,
    asOf: input.effectiveOn,
    units: positiveUnits(input.units),
  });
  const transactions = await db
    .insert(leaveTransactions)
    .values(
      allocations.map((allocation) => ({
        accountId: input.accountId,
        createdByUserId: actor.userId,
        effectiveOn: input.effectiveOn,
        employeeId: input.employeeId,
        grantLotId: allocation.grantLotId,
        kind: "consumption" as const,
        leaveTypeId: input.leaveTypeId,
        organizationId: actor.organizationId,
        reason: input.reason,
        requestId: input.requestId,
        units: -allocation.units,
      })),
    )
    .returning();
  const version = await incrementAccountVersion(db, account);
  return { transactions, version };
}

export async function expireLeaveLots(
  db: AppDatabase,
  actor: SessionActor,
  input: { asOf: string; employeeId: string; leaveTypeId: string },
) {
  requirePermission(actor, "leave:manage");
  const asOf = validateWorkDate(input.asOf, "基準日");
  return db.transaction(async (transaction) => {
    const account = await lockOrCreateAccount(transaction, {
      employeeId: input.employeeId,
      leaveTypeId: input.leaveTypeId,
      organizationId: actor.organizationId,
    });
    const state = await lotBalances(transaction, account.id, asOf);
    const expiring = state.lots.filter((lot) => lot.expired && lot.remainingUnits > 0);
    if (!expiring.length) return { expiredUnits: 0, transactions: [] };
    const transactions = await transaction
      .insert(leaveTransactions)
      .values(
        expiring.map((lot) => ({
          accountId: account.id,
          createdByUserId: actor.userId,
          effectiveOn: asOf,
          employeeId: input.employeeId,
          grantLotId: lot.id,
          kind: "expiry" as const,
          leaveTypeId: input.leaveTypeId,
          organizationId: actor.organizationId,
          reason: `有効期限 ${lot.expiresOn} の到来`,
          units: -lot.remainingUnits,
        })),
      )
      .returning();
    await incrementAccountVersion(transaction, account);
    const expiredUnits = expiring.reduce((sum, lot) => sum + lot.remainingUnits, 0);
    await recordAudit(transaction, {
      action: "leave_balance_changed",
      actorUserId: actor.userId,
      entityId: account.id,
      entityType: "leave_expiry",
      metadata: { asOf, employeeId: input.employeeId, expiredUnits },
      organizationId: actor.organizationId,
    });
    return { expiredUnits, transactions };
  });
}

export async function getEmployeeLeaveLedger(
  db: AppDatabase,
  actor: SessionActor,
  input: { asOf: string; employeeId: string },
) {
  await requireEmployeeScope(db, actor, input.employeeId);
  const types = await db
    .select()
    .from(leaveTypes)
    .where(eq(leaveTypes.organizationId, actor.organizationId))
    .orderBy(asc(leaveTypes.code));
  const balances = await Promise.all(
    types.map(async (leaveType) => ({
      ...(await getLeaveBalance(db, {
        asOf: input.asOf,
        employeeId: input.employeeId,
        leaveTypeId: leaveType.id,
        organizationId: actor.organizationId,
      })),
      leaveType,
    })),
  );
  const transactions = await db
    .select()
    .from(leaveTransactions)
    .where(
      and(
        eq(leaveTransactions.organizationId, actor.organizationId),
        eq(leaveTransactions.employeeId, input.employeeId),
      ),
    )
    .orderBy(desc(leaveTransactions.effectiveOn), desc(leaveTransactions.createdAt));
  const requests = await db
    .select()
    .from(leaveRequests)
    .where(
      and(
        eq(leaveRequests.organizationId, actor.organizationId),
        eq(leaveRequests.employeeId, input.employeeId),
      ),
    )
    .orderBy(desc(leaveRequests.createdAt));
  return { balances, requests, transactions };
}

export async function getOwnLeaveLedger(db: AppDatabase, actor: SessionActor, asOf: string) {
  const [employee] = await db
    .select({ id: employees.id })
    .from(employees)
    .where(
      and(eq(employees.organizationId, actor.organizationId), eq(employees.userId, actor.userId)),
    )
    .limit(1);
  if (!employee) throw new LeaveLedgerValidationError("従業員情報が紐付いていません。");
  return getEmployeeLeaveLedger(db, actor, { asOf, employeeId: employee.id });
}

const grantImportHeaders = [
  "employeeNumber",
  "leaveTypeCode",
  "units",
  "grantedOn",
  "expiresOn",
  "reason",
];

export async function previewLeaveGrantCsv(
  db: Pick<AppDatabase, "select">,
  input: { csv: string; organizationId: string },
) {
  const parsed = csvRecords(input.csv, grantImportHeaders);
  const [employeeRows, typeRows] = await Promise.all([
    db
      .select({
        employeeNumber: employees.employeeNumber,
        id: employees.id,
        status: employees.status,
      })
      .from(employees)
      .where(eq(employees.organizationId, input.organizationId)),
    db
      .select({
        active: leaveTypes.active,
        code: leaveTypes.code,
        consumesBalance: leaveTypes.consumesBalance,
        id: leaveTypes.id,
      })
      .from(leaveTypes)
      .where(eq(leaveTypes.organizationId, input.organizationId)),
  ]);
  const employeeByNumber = new Map(employeeRows.map((row) => [row.employeeNumber, row]));
  const typeByCode = new Map(typeRows.map((row) => [row.code, row]));
  const errors: CsvImportError[] = [];
  const preview = parsed.map(({ line, value }) => {
    const employee = employeeByNumber.get(value.employeeNumber);
    const leaveType = typeByCode.get(value.leaveTypeCode.toUpperCase());
    const units = Number(value.units);
    let grantedOn = value.grantedOn;
    let expiresOn = value.expiresOn || null;
    try {
      grantedOn = validateWorkDate(grantedOn, "付与日");
      if (expiresOn) expiresOn = validateWorkDate(expiresOn, "有効期限");
    } catch {
      errors.push({ line, message: "付与日・有効期限をYYYY-MM-DD形式で入力してください。" });
    }
    if (!employee || employee.status !== "active") {
      errors.push({ line, message: `在籍中の従業員 ${value.employeeNumber} が見つかりません。` });
    }
    if (!leaveType?.active || !leaveType.consumesBalance) {
      errors.push({
        line,
        message: `有効な残高消費休暇 ${value.leaveTypeCode} が見つかりません。`,
      });
    }
    if (!Number.isInteger(units) || units <= 0) {
      errors.push({ line, message: "unitsは正の半日単位で入力してください。" });
    }
    if (expiresOn && grantedOn && expiresOn < grantedOn) {
      errors.push({ line, message: "有効期限は付与日以後にしてください。" });
    }
    if (!value.reason.trim()) errors.push({ line, message: "理由は必須です。" });
    return {
      employeeId: employee?.id,
      employeeNumber: value.employeeNumber,
      expiresOn,
      grantedOn,
      leaveTypeCode: value.leaveTypeCode.toUpperCase(),
      leaveTypeId: leaveType?.id,
      line,
      reason: value.reason.trim(),
      units,
    };
  });
  const fingerprint = createHash("sha256").update(input.csv.replace(/\r\n/g, "\n")).digest("hex");
  const [duplicate] = await db
    .select({ id: importBatches.id })
    .from(importBatches)
    .where(
      and(
        eq(importBatches.organizationId, input.organizationId),
        eq(importBatches.kind, "leave_grant"),
        eq(importBatches.fingerprint, fingerprint),
      ),
    )
    .limit(1);
  if (duplicate) errors.push({ line: 1, message: "同じ内容のCSVはすでに取り込まれています。" });
  return {
    errors,
    fingerprint,
    preview,
    summary: {
      employeeCount: new Set(preview.flatMap((row) => (row.employeeId ? [row.employeeId] : [])))
        .size,
      rowCount: preview.length,
      totalUnits: preview.reduce(
        (sum, row) => sum + (Number.isFinite(row.units) ? row.units : 0),
        0,
      ),
    },
  };
}

export async function commitLeaveGrantCsv(
  db: AppDatabase,
  actor: SessionActor,
  input: { csv: string; fileName?: string },
) {
  requirePermission(actor, "leave:manage");
  const initial = await previewLeaveGrantCsv(db, {
    csv: input.csv,
    organizationId: actor.organizationId,
  });
  if (initial.errors.length) {
    throw new CsvImportValidationError("CSVに修正が必要な行があります。", initial.errors);
  }
  const months = [...new Set(initial.preview.map((row) => row.grantedOn.slice(0, 7)))].sort();
  return db.transaction(async (transaction) => {
    for (const month of months) await lockAttendanceMonth(transaction, actor.organizationId, month);
    const validation = await previewLeaveGrantCsv(transaction, {
      csv: input.csv,
      organizationId: actor.organizationId,
    });
    if (validation.errors.length) {
      throw new CsvImportValidationError("CSVに修正が必要な行があります。", validation.errors);
    }
    for (const row of validation.preview) {
      await assertAttendanceMonthOpen(transaction, actor.organizationId, row.grantedOn);
      await grantLeaveInternal(
        transaction,
        actor,
        {
          employeeId: row.employeeId!,
          expiresOn: row.expiresOn,
          grantedOn: row.grantedOn,
          leaveTypeId: row.leaveTypeId!,
          reason: row.reason,
          units: row.units,
        },
        false,
      );
    }
    const [batch] = await transaction
      .insert(importBatches)
      .values({
        createdByUserId: actor.userId,
        fileName: input.fileName,
        fingerprint: validation.fingerprint,
        kind: "leave_grant",
        organizationId: actor.organizationId,
        resultSummary: validation.summary,
        rowCount: validation.preview.length,
      })
      .returning();
    await recordAudit(transaction, {
      action: "csv_imported",
      actorUserId: actor.userId,
      entityId: batch.id,
      entityType: "leave_grant",
      metadata: validation.summary,
      organizationId: actor.organizationId,
    });
    return { batch, ...validation.summary };
  });
}

export async function listManagedLeaveLedger(
  db: AppDatabase,
  actor: SessionActor,
  filters: {
    departmentId?: string;
    employeeId?: string;
    from?: string;
    leaveTypeId?: string;
    to?: string;
  },
) {
  requirePermission(actor, "leave:manage");
  const conditions = [eq(leaveTransactions.organizationId, actor.organizationId)];
  if (filters.employeeId) conditions.push(eq(leaveTransactions.employeeId, filters.employeeId));
  if (filters.leaveTypeId) conditions.push(eq(leaveTransactions.leaveTypeId, filters.leaveTypeId));
  if (filters.departmentId)
    conditions.push(eq(employeeDepartments.departmentId, filters.departmentId));
  if (filters.from)
    conditions.push(gte(leaveTransactions.effectiveOn, validateWorkDate(filters.from)));
  if (filters.to) conditions.push(lte(leaveTransactions.effectiveOn, validateWorkDate(filters.to)));
  return db
    .select({
      createdAt: leaveTransactions.createdAt,
      effectiveOn: leaveTransactions.effectiveOn,
      employeeId: leaveTransactions.employeeId,
      employeeNumber: employees.employeeNumber,
      departmentCode: departments.code,
      departmentName: departments.name,
      kind: leaveTransactions.kind,
      leaveTypeCode: leaveTypes.code,
      leaveTypeId: leaveTransactions.leaveTypeId,
      leaveTypeName: leaveTypes.name,
      reason: leaveTransactions.reason,
      units: leaveTransactions.units,
    })
    .from(leaveTransactions)
    .innerJoin(employees, eq(employees.id, leaveTransactions.employeeId))
    .innerJoin(leaveTypes, eq(leaveTypes.id, leaveTransactions.leaveTypeId))
    .leftJoin(
      employeeDepartments,
      and(
        eq(employeeDepartments.employeeId, employees.id),
        eq(employeeDepartments.isPrimary, true),
      ),
    )
    .leftJoin(departments, eq(departments.id, employeeDepartments.departmentId))
    .where(and(...conditions))
    .orderBy(desc(leaveTransactions.effectiveOn), desc(leaveTransactions.createdAt));
}
