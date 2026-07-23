import { and, desc, eq, getTableColumns, sql } from "drizzle-orm";

import { recordAudit } from "@/lib/audit";
import { requirePermission, type SessionActor } from "@/lib/authorization";
import {
  generatePayrollCsv,
  payrollCsvDownloadHeaders,
  safeDownloadFileName,
} from "@/lib/payroll-csv";
import type { AppDatabase } from "@/lib/db/client";
import {
  attendanceMonthPeriods,
  attendanceMonthRevisions,
  payrollExportProfiles,
  payrollExportProfileVersions,
  payrollExportRuns,
  users,
} from "@/lib/db/schema";
import { payrollMappingSnapshotForRevision } from "@/lib/payroll-employee-mappings";
import { parsePayrollExportProfileConfig } from "@/lib/payroll-export-profile";
import { buildPayrollSourceRows } from "@/lib/payroll-source-rows";
import {
  PAYROLL_GENERATOR_SCHEMA_VERSION,
  type PayrollValidationIssue,
  type PayrollValidationSummary,
} from "@/lib/payroll-export-types";
import { PayrollResourceNotFoundError } from "@/lib/payroll-errors";

type PayrollRunDatabase = Pick<AppDatabase, "delete" | "execute" | "insert" | "select" | "update">;

export class PayrollExportValidationError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly issues: PayrollValidationIssue[] = [],
  ) {
    super(message);
    this.name = "PayrollExportValidationError";
  }
}

export class PayrollExportConflictError extends Error {
  constructor(message = "給与連携の条件が更新されています。再検査してやり直してください。") {
    super(message);
    this.name = "PayrollExportConflictError";
  }
}

export class PayrollExportIntegrityError extends Error {
  constructor(message = "保存済みの出力と再生成したファイルのハッシュが一致しません。") {
    super(message);
    this.name = "PayrollExportIntegrityError";
  }
}

function summarizeIssues(issues: PayrollValidationIssue[]): PayrollValidationSummary {
  const issueCounts: Record<string, number> = {};
  for (const issue of issues) issueCounts[issue.code] = (issueCounts[issue.code] ?? 0) + 1;
  return {
    errorCount: issues.filter((issue) => issue.severity === "error").length,
    issueCounts,
    warningCount: issues.filter((issue) => issue.severity === "warning").length,
  };
}

async function exportContext(
  db: PayrollRunDatabase,
  actor: SessionActor,
  input: Readonly<{ month: string; profileVersionId: string; revisionId?: string }>,
) {
  requirePermission(actor, "payroll:manage");
  const [period] = await db
    .select()
    .from(attendanceMonthPeriods)
    .where(
      and(
        eq(attendanceMonthPeriods.organizationId, actor.organizationId),
        eq(attendanceMonthPeriods.targetMonth, input.month),
      ),
    )
    .limit(1);
  if (!period || period.status !== "closed" || period.currentRevision === null) {
    throw new PayrollExportValidationError(
      "給与連携には月次締めが必要です。",
      "attendance_month_not_closed",
    );
  }
  const revisionConditions = [
    eq(attendanceMonthRevisions.periodId, period.id),
    eq(attendanceMonthRevisions.organizationId, actor.organizationId),
  ];
  if (input.revisionId) revisionConditions.push(eq(attendanceMonthRevisions.id, input.revisionId));
  else revisionConditions.push(eq(attendanceMonthRevisions.revision, period.currentRevision));
  const [revision] = await db
    .select()
    .from(attendanceMonthRevisions)
    .where(and(...revisionConditions))
    .limit(1);
  if (!revision) {
    throw new PayrollResourceNotFoundError();
  }
  const [profileVersion] = await db
    .select({
      configSnapshot: payrollExportProfileVersions.configSnapshot,
      id: payrollExportProfileVersions.id,
      profileId: payrollExportProfileVersions.profileId,
      profileName: payrollExportProfiles.name,
      profileStatus: payrollExportProfiles.status,
      version: payrollExportProfileVersions.version,
    })
    .from(payrollExportProfileVersions)
    .innerJoin(
      payrollExportProfiles,
      eq(payrollExportProfileVersions.profileId, payrollExportProfiles.id),
    )
    .where(
      and(
        eq(payrollExportProfileVersions.id, input.profileVersionId),
        eq(payrollExportProfileVersions.organizationId, actor.organizationId),
        eq(payrollExportProfiles.organizationId, actor.organizationId),
      ),
    )
    .limit(1);
  if (!profileVersion || profileVersion.profileStatus === "archived") {
    throw new PayrollResourceNotFoundError();
  }
  return {
    isLatestRevision: revision.revision === period.currentRevision && revision.reopenedAt === null,
    period,
    profileVersion: {
      ...profileVersion,
      configSnapshot: parsePayrollExportProfileConfig(profileVersion.configSnapshot),
    },
    revision,
  };
}

async function inspectPayrollExportWithin(
  db: PayrollRunDatabase,
  actor: SessionActor,
  input: Readonly<{
    month: string;
    page?: number;
    pageSize?: number;
    profileVersionId: string;
    revisionId?: string;
  }>,
) {
  const context = await exportContext(db, actor, input);
  const mappingResult = await payrollMappingSnapshotForRevision(db, actor, {
    profileId: context.profileVersion.profileId,
    revisionId: context.revision.id,
  });
  const sourceRows = await buildPayrollSourceRows(db, actor, {
    mappings: mappingResult.snapshots,
    revisionId: context.revision.id,
  });
  const generated = generatePayrollCsv(context.profileVersion.configSnapshot, sourceRows);
  const missingIssues: PayrollValidationIssue[] = mappingResult.missingEmployeeIds.map(
    (employeeId) => ({
      code: "mapping_missing",
      employeeId,
      message: "外部従業員コードが設定されていません。",
      severity: "error",
    }),
  );
  const oldRevisionIssues: PayrollValidationIssue[] = context.isLatestRevision
    ? []
    : [
        {
          code: "old_revision",
          message: "最新ではない締めリビジョンです。",
          severity: "warning",
        },
      ];
  const issues = [...missingIssues, ...oldRevisionIssues, ...generated.issues];
  const pageSize = Math.min(Math.max(input.pageSize ?? 25, 1), 100);
  const page = Math.max(input.page ?? 1, 1);
  const offset = (page - 1) * pageSize;
  return {
    context,
    generated,
    issues,
    mappings: mappingResult.snapshots,
    page,
    pageCount: Math.max(1, Math.ceil(generated.previewRows.length / pageSize)),
    pageSize,
    previewRows: generated.previewRows.slice(offset, offset + pageSize),
    sourceRows,
    summary: summarizeIssues(issues),
    totalRows: generated.rowCount,
  };
}

export async function inspectPayrollExport(
  db: AppDatabase,
  actor: SessionActor,
  input: Readonly<{
    month: string;
    page?: number;
    pageSize?: number;
    profileVersionId: string;
    revisionId?: string;
  }>,
) {
  const inspection = await inspectPayrollExportWithin(db, actor, input);
  await recordAudit(db, {
    action: "payroll_export_validated",
    actorUserId: actor.userId,
    entityId: inspection.context.profileVersion.id,
    entityType: "payroll_export_validation",
    metadata: {
      attendanceRevision: inspection.context.revision.revision,
      errorCount: inspection.summary.errorCount,
      profileId: inspection.context.profileVersion.profileId,
      profileVersion: inspection.context.profileVersion.version,
      profileVersionId: inspection.context.profileVersion.id,
      result: inspection.summary.errorCount === 0 ? "passed" : "failed",
      rowCount: inspection.totalRows,
      targetMonth: input.month,
      warningCount: inspection.summary.warningCount,
    },
    organizationId: actor.organizationId,
  });
  return inspection;
}

function warningCodes(issues: PayrollValidationIssue[]) {
  return [
    ...new Set(issues.filter((issue) => issue.severity === "warning").map((issue) => issue.code)),
  ].sort();
}

export async function generatePayrollExportRun(
  db: AppDatabase,
  actor: SessionActor,
  input: Readonly<{
    allowOldRevision?: boolean;
    confirmedWarningCodes: string[];
    expectedMappingVersions: Record<string, number>;
    expectedRevision: number;
    month: string;
    profileVersionId: string;
    revisionId?: string;
    sourceRunId?: string;
  }>,
) {
  requirePermission(actor, "payroll:manage");
  return db.transaction(async (transaction) => {
    await transaction.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${actor.organizationId}:${input.month}`}, 0))`,
    );
    const inspection = await inspectPayrollExportWithin(transaction, actor, input);
    if (inspection.context.revision.revision !== input.expectedRevision) {
      throw new PayrollExportConflictError();
    }
    if (!inspection.context.isLatestRevision && !input.allowOldRevision) {
      throw new PayrollExportValidationError(
        "旧締めリビジョンからの新規生成には明示的な確認が必要です。",
        "old_revision_confirmation_required",
      );
    }
    const currentMappingVersions = Object.fromEntries(
      inspection.mappings.map((mapping) => [mapping.employeeId, mapping.mappingVersion]),
    );
    const currentEntries = Object.entries(currentMappingVersions).sort(([first], [second]) =>
      first.localeCompare(second),
    );
    const expectedEntries = Object.entries(input.expectedMappingVersions).sort(
      ([first], [second]) => first.localeCompare(second),
    );
    if (JSON.stringify(currentEntries) !== JSON.stringify(expectedEntries)) {
      throw new PayrollExportConflictError();
    }
    if (inspection.summary.errorCount > 0) {
      throw new PayrollExportValidationError(
        "給与連携CSVを生成できないエラーがあります。",
        "validation_failed",
        inspection.issues,
      );
    }
    const expectedWarnings = warningCodes(inspection.issues);
    const confirmedWarnings = [...new Set(input.confirmedWarningCodes)].sort();
    if (JSON.stringify(expectedWarnings) !== JSON.stringify(confirmedWarnings)) {
      throw new PayrollExportConflictError(
        "警告内容が変わっています。再検査して確認してください。",
      );
    }
    if (input.sourceRunId) {
      const [sourceRun] = await transaction
        .select({ id: payrollExportRuns.id })
        .from(payrollExportRuns)
        .where(
          and(
            eq(payrollExportRuns.id, input.sourceRunId),
            eq(payrollExportRuns.organizationId, actor.organizationId),
          ),
        )
        .limit(1);
      if (!sourceRun) throw new PayrollResourceNotFoundError();
      const [sameSourceRun] = await transaction
        .select({ id: payrollExportRuns.id })
        .from(payrollExportRuns)
        .where(
          and(
            eq(payrollExportRuns.id, input.sourceRunId),
            eq(payrollExportRuns.attendanceRevisionId, inspection.context.revision.id),
            eq(payrollExportRuns.profileVersionId, inspection.context.profileVersion.id),
          ),
        )
        .limit(1);
      if (!sameSourceRun) {
        throw new PayrollExportValidationError(
          "元runと締めリビジョンまたはプロファイル版が一致しません。",
          "source_run_condition_mismatch",
        );
      }
    }
    const fileName = safeDownloadFileName(
      inspection.context.profileVersion.configSnapshot.fileNamePattern,
      {
        profileName: inspection.context.profileVersion.profileName,
        revision: inspection.context.revision.revision,
        targetMonth: input.month,
      },
    );
    const manifest = {
      attendanceRevision: inspection.context.revision.revision,
      attendanceRevisionId: inspection.context.revision.id,
      config: inspection.context.profileVersion.configSnapshot,
      confirmedWarningCodes: confirmedWarnings,
      fileName,
      generatorVersion: PAYROLL_GENERATOR_SCHEMA_VERSION,
      mappings: inspection.mappings,
      profileId: inspection.context.profileVersion.profileId,
      profileVersion: inspection.context.profileVersion.version,
      profileVersionId: inspection.context.profileVersion.id,
      schemaVersion: 1,
      targetMonth: input.month,
    } as const;
    const [run] = await transaction
      .insert(payrollExportRuns)
      .values({
        attendanceRevision: inspection.context.revision.revision,
        attendanceRevisionId: inspection.context.revision.id,
        byteCount: inspection.generated.bytes.length,
        columnCount: inspection.generated.columnCount,
        generatedByUserId: actor.userId,
        generatorVersion: PAYROLL_GENERATOR_SCHEMA_VERSION,
        kind: input.sourceRunId ? "regenerated" : "generated",
        manifest,
        organizationId: actor.organizationId,
        periodId: inspection.context.period.id,
        profileVersionId: inspection.context.profileVersion.id,
        rowCount: inspection.generated.rowCount,
        sha256: inspection.generated.sha256,
        sourceRunId: input.sourceRunId,
        targetMonth: input.month,
        validationSummary: inspection.summary,
      })
      .returning();
    await recordAudit(transaction, {
      action: input.sourceRunId ? "payroll_export_regenerated" : "payroll_export_generated",
      actorUserId: actor.userId,
      entityId: run.id,
      entityType: "payroll_export_run",
      metadata: {
        attendanceRevision: run.attendanceRevision,
        byteCount: run.byteCount,
        columnCount: run.columnCount,
        confirmedWarningCodes: manifest.confirmedWarningCodes,
        profileId: manifest.profileId,
        profileVersion: inspection.context.profileVersion.version,
        profileVersionId: manifest.profileVersionId,
        rowCount: run.rowCount,
        sha256: run.sha256,
        targetMonth: run.targetMonth,
        warningCount: inspection.summary.warningCount,
      },
      organizationId: actor.organizationId,
    });
    return {
      bytes: inspection.generated.bytes,
      fileName,
      headers: payrollCsvDownloadHeaders(fileName),
      run,
    };
  });
}

export async function redownloadPayrollExportRun(
  db: AppDatabase,
  actor: SessionActor,
  runId: string,
) {
  requirePermission(actor, "payroll:manage");
  const [run] = await db
    .select()
    .from(payrollExportRuns)
    .where(
      and(
        eq(payrollExportRuns.id, runId),
        eq(payrollExportRuns.organizationId, actor.organizationId),
      ),
    )
    .limit(1);
  if (!run) throw new PayrollResourceNotFoundError();
  if (run.generatorVersion !== PAYROLL_GENERATOR_SCHEMA_VERSION) {
    await recordAudit(db, {
      action: "payroll_export_integrity_failed",
      actorUserId: actor.userId,
      entityId: run.id,
      entityType: "payroll_export_run",
      metadata: {
        attendanceRevision: run.attendanceRevision,
        generatorVersion: run.generatorVersion,
        profileId: run.manifest.profileId,
        reason: "unsupported_generator",
        targetMonth: run.targetMonth,
      },
      organizationId: actor.organizationId,
    });
    throw new PayrollExportIntegrityError("このrunに対応する互換生成器がありません。");
  }
  const sourceRows = await buildPayrollSourceRows(db, actor, {
    mappings: run.manifest.mappings,
    revisionId: run.attendanceRevisionId,
  });
  const generated = generatePayrollCsv(run.manifest.config, sourceRows);
  if (
    generated.sha256 !== run.sha256 ||
    generated.bytes.length !== run.byteCount ||
    generated.rowCount !== run.rowCount ||
    generated.columnCount !== run.columnCount
  ) {
    await recordAudit(db, {
      action: "payroll_export_integrity_failed",
      actorUserId: actor.userId,
      entityId: run.id,
      entityType: "payroll_export_run",
      metadata: {
        actualSha256: generated.sha256,
        attendanceRevision: run.attendanceRevision,
        expectedSha256: run.sha256,
        profileId: run.manifest.profileId,
        reason: "hash_mismatch",
        targetMonth: run.targetMonth,
      },
      organizationId: actor.organizationId,
    });
    throw new PayrollExportIntegrityError();
  }
  await recordAudit(db, {
    action: "payroll_export_downloaded",
    actorUserId: actor.userId,
    entityId: run.id,
    entityType: "payroll_export_run",
    metadata: {
      attendanceRevision: run.attendanceRevision,
      hashMatched: true,
      profileId: run.manifest.profileId,
      profileVersion: run.manifest.profileVersion,
      sha256: run.sha256,
      targetMonth: run.targetMonth,
    },
    organizationId: actor.organizationId,
  });
  const fileName =
    run.manifest.fileName ??
    safeDownloadFileName(run.manifest.config.fileNamePattern, {
      profileName: "payroll",
      revision: run.attendanceRevision,
      targetMonth: run.targetMonth,
    });
  return { bytes: generated.bytes, fileName, headers: payrollCsvDownloadHeaders(fileName), run };
}

export async function listPayrollExportRuns(db: AppDatabase, actor: SessionActor, month?: string) {
  requirePermission(actor, "payroll:manage");
  const conditions = [eq(payrollExportRuns.organizationId, actor.organizationId)];
  if (month) conditions.push(eq(payrollExportRuns.targetMonth, month));
  const runs = await db
    .select({
      ...getTableColumns(payrollExportRuns),
      generatedByName: users.displayName,
    })
    .from(payrollExportRuns)
    .innerJoin(users, eq(payrollExportRuns.generatedByUserId, users.id))
    .where(and(...conditions))
    .orderBy(desc(payrollExportRuns.generatedAt));
  const periods = await db
    .select()
    .from(attendanceMonthPeriods)
    .where(eq(attendanceMonthPeriods.organizationId, actor.organizationId));
  const currentRevisionByMonth = new Map(
    periods.map((period) => [period.targetMonth, period.currentRevision]),
  );
  return runs.map((run) => ({
    ...run,
    isLatestRevision: currentRevisionByMonth.get(run.targetMonth) === run.attendanceRevision,
  }));
}

export async function getPayrollExportRun(db: AppDatabase, actor: SessionActor, runId: string) {
  requirePermission(actor, "payroll:manage");
  const [run] = await db
    .select({
      ...getTableColumns(payrollExportRuns),
      generatedByName: users.displayName,
    })
    .from(payrollExportRuns)
    .innerJoin(users, eq(payrollExportRuns.generatedByUserId, users.id))
    .where(
      and(
        eq(payrollExportRuns.id, runId),
        eq(payrollExportRuns.organizationId, actor.organizationId),
      ),
    )
    .limit(1);
  if (!run) throw new PayrollResourceNotFoundError();
  const [period] = await db
    .select({ currentRevision: attendanceMonthPeriods.currentRevision })
    .from(attendanceMonthPeriods)
    .where(
      and(
        eq(attendanceMonthPeriods.id, run.periodId),
        eq(attendanceMonthPeriods.organizationId, actor.organizationId),
      ),
    )
    .limit(1);
  return { ...run, isLatestRevision: period?.currentRevision === run.attendanceRevision };
}

export async function getPayrollExportMonthState(
  db: AppDatabase,
  actor: SessionActor,
  month: string,
) {
  requirePermission(actor, "payroll:manage");
  const [period] = await db
    .select()
    .from(attendanceMonthPeriods)
    .where(
      and(
        eq(attendanceMonthPeriods.organizationId, actor.organizationId),
        eq(attendanceMonthPeriods.targetMonth, month),
      ),
    )
    .limit(1);
  const runs = await db
    .select()
    .from(payrollExportRuns)
    .where(
      and(
        eq(payrollExportRuns.organizationId, actor.organizationId),
        eq(payrollExportRuns.targetMonth, month),
      ),
    )
    .orderBy(desc(payrollExportRuns.generatedAt));
  const latestRuns = runs.filter((run) => run.attendanceRevision === period?.currentRevision);
  return {
    latestRun: latestRuns[0] ?? null,
    latestRunCount: latestRuns.length,
    oldRevisionRunCount: runs.length - latestRuns.length,
    status:
      period?.status !== "closed"
        ? "month_open"
        : latestRuns.length > 0
          ? "generated"
          : "not_generated",
  } as const;
}
