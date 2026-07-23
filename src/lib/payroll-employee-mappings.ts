import { and, asc, eq, ne, sql } from "drizzle-orm";

import { recordAudit } from "@/lib/audit";
import { requirePermission, type SessionActor } from "@/lib/authorization";
import { parseCsv } from "@/lib/csv-imports";
import type { AppDatabase } from "@/lib/db/client";
import {
  attendanceMonthDaySnapshots,
  employees,
  payrollEmployeeMappings,
  payrollExportProfiles,
} from "@/lib/db/schema";
import type { PayrollEmployeeMappingSnapshot } from "@/lib/payroll-export-types";
import { PayrollResourceNotFoundError } from "@/lib/payroll-errors";

const MAPPING_HEADERS = ["employeeNumber", "externalEmployeeCode"] as const;
const MAX_MAPPING_ROWS = 100;
const MAX_MAPPING_CSV_BYTES = 262_144;
type MappingDatabase = Pick<AppDatabase, "delete" | "execute" | "insert" | "select" | "update">;

export type PayrollMappingCsvIssue = { line: number; message: string };

export class PayrollMappingValidationError extends Error {
  constructor(
    message: string,
    readonly issues: PayrollMappingCsvIssue[] = [],
  ) {
    super(message);
    this.name = "PayrollMappingValidationError";
  }
}

export class PayrollMappingConflictError extends Error {
  constructor(message = "外部従業員コードが更新されています。再読み込みしてやり直してください。") {
    super(message);
    this.name = "PayrollMappingConflictError";
  }
}

function externalCode(value: string) {
  const code = value.trim();
  if (!code || code.length > 128) {
    throw new PayrollMappingValidationError("外部従業員コードを1〜128文字で入力してください。");
  }
  return code;
}

async function requireProfile(
  db: Pick<AppDatabase, "select">,
  actor: SessionActor,
  profileId: string,
) {
  requirePermission(actor, "payroll:manage");
  const [profile] = await db
    .select({ id: payrollExportProfiles.id })
    .from(payrollExportProfiles)
    .where(
      and(
        eq(payrollExportProfiles.id, profileId),
        eq(payrollExportProfiles.organizationId, actor.organizationId),
        ne(payrollExportProfiles.status, "archived"),
      ),
    )
    .limit(1);
  if (!profile) throw new PayrollResourceNotFoundError();
}

export async function listPayrollEmployeeMappings(
  db: MappingDatabase,
  actor: SessionActor,
  profileId: string,
) {
  await requireProfile(db, actor, profileId);
  return db
    .select({
      employeeId: employees.id,
      employeeNumber: employees.employeeNumber,
      externalEmployeeCode: payrollEmployeeMappings.externalEmployeeCode,
      mappingVersion: payrollEmployeeMappings.version,
      displayName: employees.displayName,
      status: employees.status,
    })
    .from(employees)
    .leftJoin(
      payrollEmployeeMappings,
      and(
        eq(payrollEmployeeMappings.employeeId, employees.id),
        eq(payrollEmployeeMappings.profileId, profileId),
        eq(payrollEmployeeMappings.organizationId, actor.organizationId),
      ),
    )
    .where(eq(employees.organizationId, actor.organizationId))
    .orderBy(asc(employees.employeeNumber), asc(employees.id));
}

async function savePayrollEmployeeMappingWithin(
  db: MappingDatabase,
  actor: SessionActor,
  input: Readonly<{
    employeeId: string;
    expectedVersion: number;
    externalEmployeeCode: string | null;
    profileId: string;
  }>,
) {
  await requireProfile(db, actor, input.profileId);
  const [employee] = await db
    .select({ id: employees.id })
    .from(employees)
    .where(
      and(eq(employees.id, input.employeeId), eq(employees.organizationId, actor.organizationId)),
    )
    .limit(1);
  if (!employee) throw new PayrollResourceNotFoundError();
  await db.execute(sql`
      SELECT id FROM ${payrollEmployeeMappings}
      WHERE organization_id = ${actor.organizationId}
        AND profile_id = ${input.profileId}
        AND employee_id = ${input.employeeId}
      FOR UPDATE
    `);
  const [current] = await db
    .select()
    .from(payrollEmployeeMappings)
    .where(
      and(
        eq(payrollEmployeeMappings.organizationId, actor.organizationId),
        eq(payrollEmployeeMappings.profileId, input.profileId),
        eq(payrollEmployeeMappings.employeeId, input.employeeId),
      ),
    )
    .limit(1);
  if ((current?.version ?? 0) !== input.expectedVersion) throw new PayrollMappingConflictError();

  if (input.externalEmployeeCode === null) {
    if (!current) return null;
    const [deleted] = await db
      .delete(payrollEmployeeMappings)
      .where(
        and(
          eq(payrollEmployeeMappings.id, current.id),
          eq(payrollEmployeeMappings.version, current.version),
        ),
      )
      .returning();
    if (!deleted) throw new PayrollMappingConflictError();
    await recordAudit(db, {
      action: "payroll_employee_mapping_changed",
      actorUserId: actor.userId,
      entityId: input.employeeId,
      entityType: "payroll_employee_mapping",
      metadata: { operation: "removed", profileId: input.profileId },
      organizationId: actor.organizationId,
    });
    return null;
  }

  const code = externalCode(input.externalEmployeeCode);
  const [duplicate] = await db
    .select({ id: payrollEmployeeMappings.id })
    .from(payrollEmployeeMappings)
    .where(
      and(
        eq(payrollEmployeeMappings.organizationId, actor.organizationId),
        eq(payrollEmployeeMappings.profileId, input.profileId),
        eq(payrollEmployeeMappings.externalEmployeeCode, code),
        ...(current ? [ne(payrollEmployeeMappings.id, current.id)] : []),
      ),
    )
    .limit(1);
  if (duplicate) {
    throw new PayrollMappingValidationError("同じ外部従業員コードが既に使われています。");
  }
  const [mapping] = current
    ? await db
        .update(payrollEmployeeMappings)
        .set({
          externalEmployeeCode: code,
          updatedAt: new Date(),
          updatedByUserId: actor.userId,
          version: current.version + 1,
        })
        .where(
          and(
            eq(payrollEmployeeMappings.id, current.id),
            eq(payrollEmployeeMappings.version, current.version),
          ),
        )
        .returning()
    : await db
        .insert(payrollEmployeeMappings)
        .values({
          employeeId: input.employeeId,
          externalEmployeeCode: code,
          organizationId: actor.organizationId,
          profileId: input.profileId,
          updatedByUserId: actor.userId,
        })
        .returning();
  if (!mapping) throw new PayrollMappingConflictError();
  await recordAudit(db, {
    action: "payroll_employee_mapping_changed",
    actorUserId: actor.userId,
    entityId: input.employeeId,
    entityType: "payroll_employee_mapping",
    metadata: { operation: current ? "updated" : "created", profileId: input.profileId },
    organizationId: actor.organizationId,
  });
  return mapping;
}

export async function savePayrollEmployeeMapping(
  db: AppDatabase,
  actor: SessionActor,
  input: Readonly<{
    employeeId: string;
    expectedVersion: number;
    externalEmployeeCode: string | null;
    profileId: string;
  }>,
) {
  requirePermission(actor, "payroll:manage");
  return db.transaction((transaction) =>
    savePayrollEmployeeMappingWithin(transaction, actor, input),
  );
}

export function payrollMappingCsvTemplate() {
  return `\uFEFF${MAPPING_HEADERS.join(",")}\r\n`;
}

export async function previewPayrollMappingCsv(
  db: MappingDatabase,
  actor: SessionActor,
  input: Readonly<{ csv: string; profileId: string }>,
) {
  await requireProfile(db, actor, input.profileId);
  if (Buffer.byteLength(input.csv, "utf8") > MAX_MAPPING_CSV_BYTES) {
    throw new PayrollMappingValidationError("CSVのサイズ上限を超えています。");
  }
  const rows = parseCsv(input.csv.replace(/^\uFEFF/u, ""));
  const [headers, ...dataRows] = rows;
  const issues: PayrollMappingCsvIssue[] = [];
  if (
    !headers ||
    headers.length !== 2 ||
    headers.some((header, index) => header !== MAPPING_HEADERS[index])
  ) {
    throw new PayrollMappingValidationError("CSVの見出しがテンプレートと一致しません。", [
      { line: 1, message: `必要な列: ${MAPPING_HEADERS.join(", ")}` },
    ]);
  }
  if (dataRows.length > MAX_MAPPING_ROWS) {
    throw new PayrollMappingValidationError(`CSVは${MAX_MAPPING_ROWS}名までです。`);
  }
  const employeeRows = await listPayrollEmployeeMappings(db, actor, input.profileId);
  const employeeByNumber = new Map(employeeRows.map((row) => [row.employeeNumber, row]));
  const existingEmployeeByCode = new Map(
    employeeRows.flatMap((row) =>
      row.externalEmployeeCode ? [[row.externalEmployeeCode, row.employeeId] as const] : [],
    ),
  );
  const seenEmployees = new Set<string>();
  const seenCodes = new Set<string>();
  const preview = dataRows.map((row, index) => {
    const line = index + 2;
    if (row.length !== 2) issues.push({ line, message: "列数が2列ではありません。" });
    const employeeNumber = row[0]?.trim() ?? "";
    const code = row[1]?.trim() ?? "";
    const employee = employeeByNumber.get(employeeNumber);
    if (!employeeNumber || !code)
      issues.push({ line, message: "従業員番号と外部従業員コードは必須です。" });
    if (!employee) issues.push({ line, message: "組織内に従業員番号が見つかりません。" });
    const existingEmployeeId = existingEmployeeByCode.get(code);
    if (existingEmployeeId && existingEmployeeId !== employee?.employeeId) {
      issues.push({ line, message: "外部従業員コードが別の従業員に設定されています。" });
    }
    if (seenEmployees.has(employeeNumber))
      issues.push({ line, message: "従業員番号がCSV内で重複しています。" });
    if (seenCodes.has(code))
      issues.push({ line, message: "外部従業員コードがCSV内で重複しています。" });
    if (code.length > 128) issues.push({ line, message: "外部従業員コードは128文字までです。" });
    seenEmployees.add(employeeNumber);
    seenCodes.add(code);
    return {
      employeeId: employee?.employeeId,
      employeeNumber,
      expectedVersion: employee?.mappingVersion ?? 0,
      externalEmployeeCode: code,
      line,
    };
  });
  return { issues, preview };
}

export async function commitPayrollMappingCsv(
  db: AppDatabase,
  actor: SessionActor,
  input: Readonly<{ csv: string; profileId: string }>,
) {
  requirePermission(actor, "payroll:manage");
  return db.transaction(async (transaction) => {
    const validation = await previewPayrollMappingCsv(transaction, actor, input);
    if (validation.issues.length) {
      throw new PayrollMappingValidationError("CSVに修正が必要な行があります。", validation.issues);
    }
    for (const row of validation.preview) {
      await savePayrollEmployeeMappingWithin(transaction, actor, {
        employeeId: row.employeeId!,
        expectedVersion: row.expectedVersion,
        externalEmployeeCode: row.externalEmployeeCode,
        profileId: input.profileId,
      });
    }
    await recordAudit(transaction, {
      action: "payroll_employee_mappings_imported",
      actorUserId: actor.userId,
      entityType: "payroll_employee_mapping",
      metadata: { profileId: input.profileId, rowCount: validation.preview.length },
      organizationId: actor.organizationId,
    });
    return validation.preview.length;
  });
}

export async function payrollMappingSnapshotForRevision(
  db: MappingDatabase,
  actor: SessionActor,
  input: Readonly<{ profileId: string; revisionId: string }>,
) {
  await requireProfile(db, actor, input.profileId);
  const rows = await db
    .select({
      displayName: attendanceMonthDaySnapshots.displayName,
      employeeId: attendanceMonthDaySnapshots.employeeId,
      employeeNumber: attendanceMonthDaySnapshots.employeeNumber,
      externalEmployeeCode: payrollEmployeeMappings.externalEmployeeCode,
      mappingVersion: payrollEmployeeMappings.version,
    })
    .from(attendanceMonthDaySnapshots)
    .leftJoin(
      payrollEmployeeMappings,
      and(
        eq(payrollEmployeeMappings.employeeId, attendanceMonthDaySnapshots.employeeId),
        eq(payrollEmployeeMappings.profileId, input.profileId),
        eq(payrollEmployeeMappings.organizationId, actor.organizationId),
      ),
    )
    .where(
      and(
        eq(attendanceMonthDaySnapshots.revisionId, input.revisionId),
        eq(attendanceMonthDaySnapshots.organizationId, actor.organizationId),
      ),
    )
    .orderBy(asc(attendanceMonthDaySnapshots.employeeId));
  const snapshots = new Map<string, PayrollEmployeeMappingSnapshot>();
  const missing: string[] = [];
  const seenEmployeeIds = new Set<string>();
  for (const row of rows) {
    if (seenEmployeeIds.has(row.employeeId)) continue;
    seenEmployeeIds.add(row.employeeId);
    if (!row.externalEmployeeCode || row.mappingVersion === null) {
      missing.push(row.employeeId);
      continue;
    }
    snapshots.set(row.employeeId, {
      displayName: row.displayName,
      employeeId: row.employeeId,
      employeeNumber: row.employeeNumber,
      externalEmployeeCode: row.externalEmployeeCode,
      mappingVersion: row.mappingVersion,
    });
  }
  return { missingEmployeeIds: missing, snapshots: [...snapshots.values()] };
}
