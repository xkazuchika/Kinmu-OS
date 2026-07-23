import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";

import { AuthorizationError, type SessionActor } from "@/lib/authorization";
import { createDatabaseClient } from "@/lib/db/client";
import { organizations, users } from "@/lib/db/schema";
import {
  archivePayrollExportProfile,
  createDraftFromPublishedPayrollProfile,
  createPayrollExportProfile,
  duplicatePayrollExportProfile,
  exportPayrollProfileSettings,
  getPayrollExportProfile,
  importPayrollProfileSettings,
  listPayrollExportProfiles,
  PayrollProfileConflictError,
  payrollProfileHistory,
  previewPayrollProfileImport,
  publishPayrollExportProfile,
  savePayrollExportProfileDraft,
} from "@/lib/payroll-export-profiles";
import type { PayrollExportProfileConfig } from "@/lib/payroll-export-types";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

const config: PayrollExportProfileConfig = {
  schemaVersion: 1,
  encoding: "utf8_bom",
  lineEnding: "crlf",
  fileNamePattern: "payroll-{targetMonth}-r{revision}.csv",
  columns: [
    {
      id: "employee_number",
      header: "従業員番号",
      source: { kind: "field", field: "employee_number" },
      transform: { kind: "text" },
      required: true,
      formulaPolicy: "reject",
    },
  ],
};

describeDatabase("payroll export profile lifecycle", () => {
  const client = createDatabaseClient(
    databaseUrl ?? "postgresql://kinmu:kinmu@127.0.0.1:5432/kinmu_test",
  );

  beforeEach(async () => {
    await client.db.execute(sql`TRUNCATE TABLE organizations CASCADE`);
  });

  afterAll(async () => {
    await client.db.execute(sql`TRUNCATE TABLE organizations CASCADE`);
    await client.close();
  });

  async function fixture(label: string, role: SessionActor["role"] = "owner") {
    const [organization] = await client.db
      .insert(organizations)
      .values({ name: `${label}組織` })
      .returning();
    const [user] = await client.db
      .insert(users)
      .values({
        displayName: `${label}利用者`,
        email: `${label.toLowerCase()}@example.com`,
        organizationId: organization.id,
        role,
        status: "active",
      })
      .returning();
    const actor: SessionActor = {
      displayName: user.displayName,
      expiresAt: new Date("2027-01-01T00:00:00.000Z"),
      organizationId: organization.id,
      role,
      userId: user.id,
    };
    return { actor, organization, user };
  }

  it("creates, saves with optimistic locking, and publishes immutable sequential versions", async () => {
    const { actor } = await fixture("LIFECYCLE");
    const created = await createPayrollExportProfile(client.db, actor, {
      config,
      description: "給与ソフト連携用",
      name: "給与連携A",
    });
    const saved = await savePayrollExportProfileDraft(client.db, actor, {
      config: { ...config, encoding: "cp932" },
      description: created.description,
      expectedVersion: created.version,
      name: created.name,
      profileId: created.id,
    });

    await expect(
      savePayrollExportProfileDraft(client.db, actor, {
        config,
        expectedVersion: created.version,
        name: created.name,
        profileId: created.id,
      }),
    ).rejects.toBeInstanceOf(PayrollProfileConflictError);

    const first = await publishPayrollExportProfile(client.db, actor, {
      expectedVersion: saved.version,
      profileId: created.id,
    });
    expect(first.publishedVersion).toMatchObject({ encoding: "cp932", version: 1 });
    expect(first.publishedVersion.configHash).toMatch(/^[0-9a-f]{64}$/);

    const nextDraft = await createDraftFromPublishedPayrollProfile(client.db, actor, {
      expectedVersion: first.profile.version,
      profileId: created.id,
    });
    const second = await publishPayrollExportProfile(client.db, actor, {
      expectedVersion: nextDraft.version,
      profileId: created.id,
    });
    expect(second.publishedVersion.version).toBe(2);

    const detail = await getPayrollExportProfile(client.db, actor, created.id);
    expect(detail.versions.map((version) => version.version)).toEqual([2, 1]);
  });

  it("duplicates, archives without deleting history, and lists only its organization", async () => {
    const first = await fixture("FIRST");
    const second = await fixture("SECOND");
    const source = await createPayrollExportProfile(client.db, first.actor, {
      config,
      name: "給与連携元",
    });
    const published = await publishPayrollExportProfile(client.db, first.actor, {
      expectedVersion: source.version,
      profileId: source.id,
    });
    const duplicate = await duplicatePayrollExportProfile(client.db, first.actor, {
      name: "給与連携複製",
      profileId: source.id,
    });
    await createPayrollExportProfile(client.db, second.actor, {
      config,
      name: "他組織給与連携",
    });
    const archived = await archivePayrollExportProfile(client.db, first.actor, {
      expectedVersion: published.profile.version,
      profileId: source.id,
    });

    expect(archived.status).toBe("archived");
    expect(
      (await listPayrollExportProfiles(client.db, first.actor)).map((profile) => profile.id),
    ).toEqual(expect.arrayContaining([source.id, duplicate.id]));
    expect(await payrollProfileHistory(client.db, first.actor, source.id)).toMatchObject({
      versions: [{ version: 1 }],
    });
  });

  it("exports only versioned settings and imports them as a new draft", async () => {
    const { actor } = await fixture("TRANSFER");
    const source = await createPayrollExportProfile(client.db, actor, {
      config,
      description: "移出入テスト",
      name: "移出元",
    });
    const exported = await exportPayrollProfileSettings(client.db, actor, source.id);

    expect(JSON.stringify(exported)).not.toContain(actor.organizationId);
    expect(JSON.stringify(exported)).not.toContain(actor.userId);
    const imported = await importPayrollProfileSettings(client.db, actor, {
      ...exported,
      profile: { ...exported.profile, name: "取込先" },
    });
    expect(imported).toMatchObject({ name: "取込先", status: "draft", version: 0 });
    expect(() => previewPayrollProfileImport({ ...exported, schemaVersion: 99 })).toThrow(
      "対応していない給与連携設定JSON",
    );
  });

  it("denies employees and does not expose another organization's profile", async () => {
    const owner = await fixture("OWNER");
    const employee = await fixture("EMPLOYEE", "employee");
    const profile = await createPayrollExportProfile(client.db, owner.actor, {
      config,
      name: "非公開プロファイル",
    });

    await expect(listPayrollExportProfiles(client.db, employee.actor)).rejects.toBeInstanceOf(
      AuthorizationError,
    );
    await expect(
      getPayrollExportProfile(client.db, employee.actor, profile.id),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });
});
