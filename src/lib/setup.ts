import { createHash, randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";

import type { AppDatabase } from "@/lib/db/client";
import { initialSetupLinks, organizations, users } from "@/lib/db/schema";
import { TimeValidationError, validateOrganizationTimezone } from "@/lib/time";

const SETUP_LINK_LIFETIME_MS = 48 * 60 * 60 * 1000;
const SETUP_LOCK_ID = 803_110;

export class InitialSetupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InitialSetupError";
  }
}

export type InitialSetupInput = Readonly<{
  organizationName: string;
  ownerEmail: string;
  ownerName: string;
  timezone: string;
}>;

function normalizedRequired(value: string, label: string) {
  const normalized = value.trim();

  if (!normalized) {
    throw new InitialSetupError(`${label} is required.`);
  }

  return normalized;
}

function normalizedEmail(value: string) {
  const email = normalizedRequired(value, "Owner email").toLowerCase();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new InitialSetupError("Owner email must be valid.");
  }

  return email;
}

export async function initializeOrganization(db: AppDatabase, input: InitialSetupInput) {
  const organizationName = normalizedRequired(input.organizationName, "Organization name");
  const ownerName = normalizedRequired(input.ownerName, "Owner name");
  const ownerEmail = normalizedEmail(input.ownerEmail);
  let timezone: string;

  try {
    timezone = validateOrganizationTimezone(input.timezone);
  } catch (error) {
    if (error instanceof TimeValidationError) {
      throw new InitialSetupError(error.message);
    }

    throw error;
  }

  return db.transaction(async (transaction) => {
    await transaction.execute(sql`SELECT pg_advisory_xact_lock(${sql.raw(String(SETUP_LOCK_ID))})`);

    const existingOrganization = await transaction
      .select({ id: organizations.id })
      .from(organizations)
      .limit(1);

    if (existingOrganization.length > 0) {
      throw new InitialSetupError("Initial setup has already been completed.");
    }

    const [organization] = await transaction
      .insert(organizations)
      .values({
        name: organizationName,
        setupCompletedAt: new Date(),
        timezone,
      })
      .returning();
    const [owner] = await transaction
      .insert(users)
      .values({
        displayName: ownerName,
        email: ownerEmail,
        organizationId: organization.id,
        role: "owner",
      })
      .returning();
    const token = randomBytes(32).toString("base64url");
    const tokenHash = createHash("sha256").update(token).digest("hex");

    await transaction.insert(initialSetupLinks).values({
      expiresAt: new Date(Date.now() + SETUP_LINK_LIFETIME_MS),
      organizationId: organization.id,
      tokenHash,
      userId: owner.id,
    });

    return { setupToken: token };
  });
}
