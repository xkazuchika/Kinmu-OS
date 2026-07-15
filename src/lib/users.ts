import { createHash, randomBytes } from "node:crypto";

import { and, eq, isNull } from "drizzle-orm";

import type { AppDatabase } from "@/lib/db/client";
import { initialSetupLinks, userSessions, users } from "@/lib/db/schema";

const SETUP_LINK_LIFETIME_MS = 48 * 60 * 60 * 1_000;

export type ManagedUserRole = "hr_admin" | "employee" | "owner";

export class UserManagementError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserManagementError";
  }
}

function requiredValue(value: string, label: string) {
  const normalized = value.trim();

  if (!normalized) {
    throw new UserManagementError(`${label} is required.`);
  }

  return normalized;
}

function normalizeEmail(value: string) {
  const email = requiredValue(value, "Email").toLowerCase();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new UserManagementError("Email must be valid.");
  }

  return email;
}

export async function createUserWithSetupLink(
  db: AppDatabase,
  input: Readonly<{
    displayName: string;
    email: string;
    organizationId: string;
    role: ManagedUserRole;
  }>,
) {
  const displayName = requiredValue(input.displayName, "Display name");
  const email = normalizeEmail(input.email);

  return db.transaction(async (transaction) => {
    const [user] = await transaction
      .insert(users)
      .values({
        displayName,
        email,
        organizationId: input.organizationId,
        role: input.role,
        status: "pending_setup",
      })
      .returning();
    const setupToken = randomBytes(32).toString("base64url");

    await transaction.insert(initialSetupLinks).values({
      expiresAt: new Date(Date.now() + SETUP_LINK_LIFETIME_MS),
      organizationId: input.organizationId,
      tokenHash: createHash("sha256").update(setupToken).digest("hex"),
      userId: user.id,
    });

    return { setupToken, user };
  });
}

export async function setUserEnabled(
  db: AppDatabase,
  input: Readonly<{ enabled: boolean; organizationId: string; userId: string }>,
) {
  return db.transaction(async (transaction) => {
    const [user] = await transaction
      .update(users)
      .set({ status: input.enabled ? "active" : "disabled", updatedAt: new Date() })
      .where(and(eq(users.id, input.userId), eq(users.organizationId, input.organizationId)))
      .returning();

    if (!user) {
      throw new UserManagementError("User was not found in this organization.");
    }

    if (!input.enabled) {
      await transaction
        .update(userSessions)
        .set({ revokedAt: new Date() })
        .where(and(eq(userSessions.userId, user.id), isNull(userSessions.revokedAt)));
    }

    return user;
  });
}

export async function setUserRole(
  db: AppDatabase,
  input: Readonly<{ organizationId: string; role: ManagedUserRole; userId: string }>,
) {
  const [user] = await db
    .update(users)
    .set({ role: input.role, updatedAt: new Date() })
    .where(and(eq(users.id, input.userId), eq(users.organizationId, input.organizationId)))
    .returning();

  if (!user) {
    throw new UserManagementError("User was not found in this organization.");
  }

  return user;
}
