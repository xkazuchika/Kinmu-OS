import { createHash } from "node:crypto";

import { and, asc, desc, eq, max, sql } from "drizzle-orm";
import { z } from "zod";

import { recordAudit } from "@/lib/audit";
import { requirePermission, type SessionActor } from "@/lib/authorization";
import type { AppDatabase } from "@/lib/db/client";
import {
  payrollExportProfiles,
  payrollExportProfileVersions,
  payrollExportRuns,
} from "@/lib/db/schema";
import {
  parsePayrollExportProfileConfig,
  PayrollProfileConfigValidationError,
} from "@/lib/payroll-export-profile";
import {
  PAYROLL_PROFILE_SCHEMA_VERSION,
  type PayrollExportProfileConfig,
} from "@/lib/payroll-export-types";
import { PayrollResourceNotFoundError } from "@/lib/payroll-errors";

export class PayrollProfileValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PayrollProfileValidationError";
  }
}

export class PayrollProfileConflictError extends Error {
  constructor(
    message = "給与連携プロファイルが更新されています。再読み込みしてやり直してください。",
  ) {
    super(message);
    this.name = "PayrollProfileConflictError";
  }
}

function profileName(value: string) {
  const name = value.trim();
  if (!name || name.length > 120) {
    throw new PayrollProfileValidationError("プロファイル名を1〜120文字で入力してください。");
  }
  return name;
}

function profileDescription(value = "") {
  const description = value.trim();
  if (description.length > 1_000) {
    throw new PayrollProfileValidationError("説明は1000文字以内で入力してください。");
  }
  return description;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([first], [second]) => first.localeCompare(second))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function payrollProfileConfigHash(config: PayrollExportProfileConfig) {
  return createHash("sha256").update(canonicalJson(config), "utf8").digest("hex");
}

function requirePayrollManager(actor: SessionActor) {
  requirePermission(actor, "payroll:manage");
}

async function profileForActor(
  db: Pick<AppDatabase, "select">,
  actor: SessionActor,
  profileId: string,
) {
  const [profile] = await db
    .select()
    .from(payrollExportProfiles)
    .where(
      and(
        eq(payrollExportProfiles.id, profileId),
        eq(payrollExportProfiles.organizationId, actor.organizationId),
      ),
    )
    .limit(1);
  if (!profile) throw new PayrollResourceNotFoundError();
  return profile;
}

export async function listPayrollExportProfiles(db: AppDatabase, actor: SessionActor) {
  requirePayrollManager(actor);
  return db
    .select()
    .from(payrollExportProfiles)
    .where(eq(payrollExportProfiles.organizationId, actor.organizationId))
    .orderBy(asc(payrollExportProfiles.name), desc(payrollExportProfiles.updatedAt));
}

export async function getPayrollExportProfile(
  db: AppDatabase,
  actor: SessionActor,
  profileId: string,
) {
  requirePayrollManager(actor);
  const profile = await profileForActor(db, actor, profileId);
  const versions = await db
    .select()
    .from(payrollExportProfileVersions)
    .where(
      and(
        eq(payrollExportProfileVersions.profileId, profile.id),
        eq(payrollExportProfileVersions.organizationId, actor.organizationId),
      ),
    )
    .orderBy(desc(payrollExportProfileVersions.version));
  return { profile, versions };
}

export async function getGenericPayrollExportDraft(db: AppDatabase, actor: SessionActor) {
  requirePayrollManager(actor);
  const [profile] = await db
    .select()
    .from(payrollExportProfiles)
    .where(
      and(
        eq(payrollExportProfiles.organizationId, actor.organizationId),
        eq(payrollExportProfiles.name, "汎用給与連携"),
      ),
    )
    .orderBy(asc(payrollExportProfiles.createdAt))
    .limit(1);
  return profile ?? null;
}

export async function createPayrollExportProfile(
  db: AppDatabase,
  actor: SessionActor,
  input: Readonly<{
    config: unknown;
    description?: string;
    name: string;
  }>,
) {
  requirePayrollManager(actor);
  const config = parsePayrollExportProfileConfig(input.config);
  return db.transaction(async (transaction) => {
    const [created] = await transaction
      .insert(payrollExportProfiles)
      .values({
        createdByUserId: actor.userId,
        description: profileDescription(input.description),
        draftConfig: config,
        name: profileName(input.name),
        organizationId: actor.organizationId,
        updatedByUserId: actor.userId,
      })
      .returning();
    await recordAudit(transaction, {
      action: "payroll_profile_created",
      actorUserId: actor.userId,
      entityId: created.id,
      entityType: "payroll_export_profile",
      metadata: { status: created.status, version: created.version },
      organizationId: actor.organizationId,
    });
    return created;
  });
}

export async function savePayrollExportProfileDraft(
  db: AppDatabase,
  actor: SessionActor,
  input: Readonly<{
    config: unknown;
    description?: string;
    expectedVersion: number;
    name: string;
    profileId: string;
  }>,
) {
  requirePayrollManager(actor);
  const config = parsePayrollExportProfileConfig(input.config);
  return db.transaction(async (transaction) => {
    await transaction.execute(
      sql`SELECT id FROM ${payrollExportProfiles} WHERE id = ${input.profileId} FOR UPDATE`,
    );
    const current = await profileForActor(transaction, actor, input.profileId);
    if (current.status !== "draft" || current.version !== input.expectedVersion) {
      throw new PayrollProfileConflictError();
    }
    const [updated] = await transaction
      .update(payrollExportProfiles)
      .set({
        description: profileDescription(input.description),
        draftConfig: config,
        name: profileName(input.name),
        updatedAt: new Date(),
        updatedByUserId: actor.userId,
        version: current.version + 1,
      })
      .where(
        and(
          eq(payrollExportProfiles.id, current.id),
          eq(payrollExportProfiles.version, current.version),
          eq(payrollExportProfiles.status, "draft"),
        ),
      )
      .returning();
    if (!updated) throw new PayrollProfileConflictError();
    await recordAudit(transaction, {
      action: "payroll_profile_changed",
      actorUserId: actor.userId,
      entityId: updated.id,
      entityType: "payroll_export_profile",
      metadata: { version: updated.version },
      organizationId: actor.organizationId,
    });
    return updated;
  });
}

export async function createDraftFromPublishedPayrollProfile(
  db: AppDatabase,
  actor: SessionActor,
  input: Readonly<{ expectedVersion: number; profileId: string }>,
) {
  requirePayrollManager(actor);
  const [updated] = await db
    .update(payrollExportProfiles)
    .set({
      status: "draft",
      updatedAt: new Date(),
      updatedByUserId: actor.userId,
      version: input.expectedVersion + 1,
    })
    .where(
      and(
        eq(payrollExportProfiles.id, input.profileId),
        eq(payrollExportProfiles.organizationId, actor.organizationId),
        eq(payrollExportProfiles.status, "published"),
        eq(payrollExportProfiles.version, input.expectedVersion),
      ),
    )
    .returning();
  if (!updated) throw new PayrollProfileConflictError();
  await recordAudit(db, {
    action: "payroll_profile_changed",
    actorUserId: actor.userId,
    entityId: updated.id,
    entityType: "payroll_export_profile",
    metadata: { operation: "new_draft", version: updated.version },
    organizationId: actor.organizationId,
  });
  return updated;
}

export async function publishPayrollExportProfile(
  db: AppDatabase,
  actor: SessionActor,
  input: Readonly<{ expectedVersion: number; profileId: string }>,
) {
  requirePayrollManager(actor);
  return db.transaction(async (transaction) => {
    await transaction.execute(
      sql`SELECT id FROM ${payrollExportProfiles} WHERE id = ${input.profileId} FOR UPDATE`,
    );
    const current = await profileForActor(transaction, actor, input.profileId);
    if (current.status !== "draft" || current.version !== input.expectedVersion) {
      throw new PayrollProfileConflictError();
    }
    const config = parsePayrollExportProfileConfig(current.draftConfig);
    const [{ latestVersion }] = await transaction
      .select({ latestVersion: max(payrollExportProfileVersions.version) })
      .from(payrollExportProfileVersions)
      .where(eq(payrollExportProfileVersions.profileId, current.id));
    const version = (latestVersion ?? 0) + 1;
    const [publishedVersion] = await transaction
      .insert(payrollExportProfileVersions)
      .values({
        configHash: payrollProfileConfigHash(config),
        configSnapshot: config,
        encoding: config.encoding,
        lineEnding: config.lineEnding,
        organizationId: actor.organizationId,
        profileId: current.id,
        publishedByUserId: actor.userId,
        schemaVersion: config.schemaVersion,
        version,
      })
      .returning();
    const [profile] = await transaction
      .update(payrollExportProfiles)
      .set({
        status: "published",
        updatedAt: new Date(),
        updatedByUserId: actor.userId,
        version: current.version + 1,
      })
      .where(
        and(
          eq(payrollExportProfiles.id, current.id),
          eq(payrollExportProfiles.version, current.version),
        ),
      )
      .returning();
    if (!profile) throw new PayrollProfileConflictError();
    await recordAudit(transaction, {
      action: "payroll_profile_published",
      actorUserId: actor.userId,
      entityId: profile.id,
      entityType: "payroll_export_profile",
      metadata: { configHash: publishedVersion.configHash, profileVersion: version },
      organizationId: actor.organizationId,
    });
    return { profile, publishedVersion };
  });
}

export async function duplicatePayrollExportProfile(
  db: AppDatabase,
  actor: SessionActor,
  input: Readonly<{ name: string; profileId: string }>,
) {
  const source = await profileForActor(db, actor, input.profileId);
  return createPayrollExportProfile(db, actor, {
    config: source.draftConfig,
    description: source.description,
    name: input.name,
  });
}

export async function archivePayrollExportProfile(
  db: AppDatabase,
  actor: SessionActor,
  input: Readonly<{ expectedVersion: number; profileId: string }>,
) {
  requirePayrollManager(actor);
  const now = new Date();
  const [profile] = await db
    .update(payrollExportProfiles)
    .set({
      archivedAt: now,
      archivedByUserId: actor.userId,
      status: "archived",
      updatedAt: now,
      updatedByUserId: actor.userId,
      version: input.expectedVersion + 1,
    })
    .where(
      and(
        eq(payrollExportProfiles.id, input.profileId),
        eq(payrollExportProfiles.organizationId, actor.organizationId),
        eq(payrollExportProfiles.version, input.expectedVersion),
      ),
    )
    .returning();
  if (!profile) throw new PayrollProfileConflictError();
  await recordAudit(db, {
    action: "payroll_profile_archived",
    actorUserId: actor.userId,
    entityId: profile.id,
    entityType: "payroll_export_profile",
    metadata: { version: profile.version },
    organizationId: actor.organizationId,
  });
  return profile;
}

const importedProfileSchema = z
  .object({
    schemaVersion: z.literal(PAYROLL_PROFILE_SCHEMA_VERSION),
    profile: z
      .object({
        name: z.string(),
        description: z.string().optional(),
        config: z.unknown(),
      })
      .strict(),
  })
  .strict();

export async function exportPayrollProfileSettings(
  db: AppDatabase,
  actor: SessionActor,
  profileId: string,
) {
  requirePayrollManager(actor);
  const profile = await profileForActor(db, actor, profileId);
  await recordAudit(db, {
    action: "payroll_profile_exported",
    actorUserId: actor.userId,
    entityId: profile.id,
    entityType: "payroll_export_profile",
    metadata: { schemaVersion: PAYROLL_PROFILE_SCHEMA_VERSION },
    organizationId: actor.organizationId,
  });
  return {
    schemaVersion: PAYROLL_PROFILE_SCHEMA_VERSION,
    profile: {
      name: profile.name,
      description: profile.description,
      config: parsePayrollExportProfileConfig(profile.draftConfig),
    },
  };
}

export function previewPayrollProfileImport(input: unknown) {
  const parsed = importedProfileSchema.safeParse(input);
  if (!parsed.success) {
    throw new PayrollProfileValidationError("対応していない給与連携設定JSONです。");
  }
  try {
    return {
      name: profileName(parsed.data.profile.name),
      description: profileDescription(parsed.data.profile.description),
      config: parsePayrollExportProfileConfig(parsed.data.profile.config),
    };
  } catch (error) {
    if (error instanceof PayrollProfileConfigValidationError) throw error;
    throw error;
  }
}

export async function importPayrollProfileSettings(
  db: AppDatabase,
  actor: SessionActor,
  input: unknown,
) {
  const preview = previewPayrollProfileImport(input);
  const profile = await createPayrollExportProfile(db, actor, preview);
  await recordAudit(db, {
    action: "payroll_profile_imported",
    actorUserId: actor.userId,
    entityId: profile.id,
    entityType: "payroll_export_profile",
    metadata: { schemaVersion: PAYROLL_PROFILE_SCHEMA_VERSION },
    organizationId: actor.organizationId,
  });
  return profile;
}

export async function payrollProfileHistory(
  db: AppDatabase,
  actor: SessionActor,
  profileId: string,
) {
  requirePayrollManager(actor);
  await profileForActor(db, actor, profileId);
  const versions = await db
    .select()
    .from(payrollExportProfileVersions)
    .where(eq(payrollExportProfileVersions.profileId, profileId))
    .orderBy(desc(payrollExportProfileVersions.version));
  const runs = await db
    .select({ id: payrollExportRuns.id, profileVersionId: payrollExportRuns.profileVersionId })
    .from(payrollExportRuns)
    .innerJoin(
      payrollExportProfileVersions,
      eq(payrollExportRuns.profileVersionId, payrollExportProfileVersions.id),
    )
    .where(
      and(
        eq(payrollExportProfileVersions.profileId, profileId),
        eq(payrollExportRuns.organizationId, actor.organizationId),
      ),
    );
  return { versions, runs };
}
