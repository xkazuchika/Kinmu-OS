import { createHash } from "node:crypto";

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";

import { createDatabaseClient } from "@/lib/db/client";
import { initialSetupLinks, organizations, users } from "@/lib/db/schema";
import { activateSetupLink, sessionForToken } from "@/lib/auth";
import { InitialSetupError, initializeOrganization } from "@/lib/setup";
import { createUserWithSetupLink, setUserEnabled } from "@/lib/users";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase("initializeOrganization", () => {
  const client = createDatabaseClient(
    databaseUrl ?? "postgresql://kinmu:kinmu@127.0.0.1:5432/kinmu_test",
  );

  beforeEach(async () => {
    await client.db.execute(sql`TRUNCATE TABLE organizations CASCADE`);
  });

  afterAll(async () => {
    await client.close();
  });

  it("creates one organization, its owner, and a hashed setup link", async () => {
    const result = await initializeOrganization(client.db, {
      organizationName: "勤怠株式会社",
      ownerEmail: "OWNER@example.com",
      ownerName: "管理 花子",
      timezone: "Asia/Tokyo",
    });
    const [organization] = await client.db.select().from(organizations);
    const [owner] = await client.db.select().from(users);
    const [setupLink] = await client.db.select().from(initialSetupLinks);

    expect(organization).toMatchObject({
      name: "勤怠株式会社",
      setupCompletedAt: expect.any(Date),
      timezone: "Asia/Tokyo",
    });
    expect(owner).toMatchObject({
      email: "owner@example.com",
      role: "owner",
      status: "pending_setup",
    });
    expect(setupLink.tokenHash).toBe(createHash("sha256").update(result.setupToken).digest("hex"));
  });

  it("rejects a second initial setup", async () => {
    const input = {
      organizationName: "勤怠株式会社",
      ownerEmail: "owner@example.com",
      ownerName: "管理 花子",
      timezone: "Asia/Tokyo",
    };

    await initializeOrganization(client.db, input);

    await expect(initializeOrganization(client.db, input)).rejects.toBeInstanceOf(
      InitialSetupError,
    );
    const organizationsAfter = await client.db
      .select()
      .from(organizations)
      .where(eq(organizations.name, input.organizationName));

    expect(organizationsAfter).toHaveLength(1);
  });

  it("issues a time-limited link, activates the user, then revokes access when disabled", async () => {
    const { setupToken: ownerSetupToken } = await initializeOrganization(client.db, {
      organizationName: "勤怠株式会社",
      ownerEmail: "owner@example.com",
      ownerName: "管理 花子",
      timezone: "Asia/Tokyo",
    });
    const [organization] = await client.db.select().from(organizations);
    const issued = await createUserWithSetupLink(client.db, {
      displayName: "労務 太郎",
      email: "hr@example.com",
      organizationId: organization.id,
      role: "hr_admin",
    });
    const [setupLink] = await client.db
      .select()
      .from(initialSetupLinks)
      .where(eq(initialSetupLinks.userId, issued.user.id));
    const session = await activateSetupLink(client.db, issued.setupToken, "a-long-enough-password");

    expect(setupLink.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect((await sessionForToken(client.db, session.token))?.userId).toBe(issued.user.id);

    await setUserEnabled(client.db, {
      enabled: false,
      organizationId: organization.id,
      userId: issued.user.id,
    });

    await expect(sessionForToken(client.db, session.token)).resolves.toBeUndefined();
    await expect(
      activateSetupLink(client.db, ownerSetupToken, "another-long-password"),
    ).resolves.toMatchObject({ token: expect.any(String) });

    const reenabled = await setUserEnabled(client.db, {
      enabled: true,
      organizationId: organization.id,
      userId: issued.user.id,
    });

    expect(reenabled.status).toBe("active");
  });
});
