import { createHash, randomBytes } from "node:crypto";

import { hash, verify } from "@node-rs/argon2";
import { and, eq, gt, isNull } from "drizzle-orm";

import type { AppDatabase } from "@/lib/db/client";
import { initialSetupLinks, userCredentials, userSessions, users } from "@/lib/db/schema";
import { loadEnvironment } from "@/lib/env";

const SESSION_LIFETIME_SECONDS = 7 * 24 * 60 * 60;

export const SESSION_COOKIE_NAME = "kinmu_session";

export class AuthenticationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthenticationError";
  }
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function validatePassword(password: string) {
  if (password.length < 12) {
    throw new AuthenticationError("パスワードは12文字以上にしてください。");
  }
}

export async function hashPassword(password: string) {
  validatePassword(password);

  return hash(password, {
    algorithm: 2,
    memoryCost: 19_456,
    parallelism: 1,
    timeCost: 2,
  });
}

export async function verifyPassword(passwordHash: string, password: string) {
  if (!passwordHash.startsWith("$argon2id$")) {
    return false;
  }

  return verify(passwordHash, password);
}

export async function createSession(db: AppDatabase, userId: string) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_LIFETIME_SECONDS * 1_000);

  await db.insert(userSessions).values({
    expiresAt,
    tokenHash: hashToken(token),
    userId,
  });

  return { expiresAt, token };
}

export async function activateSetupLink(db: AppDatabase, setupToken: string, password: string) {
  const passwordHash = await hashPassword(password);

  return db.transaction(async (transaction) => {
    const [link] = await transaction
      .update(initialSetupLinks)
      .set({ usedAt: new Date() })
      .where(
        and(
          eq(initialSetupLinks.tokenHash, hashToken(setupToken)),
          gt(initialSetupLinks.expiresAt, new Date()),
          isNull(initialSetupLinks.usedAt),
        ),
      )
      .returning({ userId: initialSetupLinks.userId });

    if (!link) {
      throw new AuthenticationError("設定リンクが無効または期限切れです。");
    }

    const [user] = await transaction
      .select({ status: users.status })
      .from(users)
      .where(eq(users.id, link.userId))
      .limit(1);

    if (!user || user.status === "disabled") {
      throw new AuthenticationError("この利用者は無効化されています。");
    }

    await transaction
      .insert(userCredentials)
      .values({ passwordHash, userId: link.userId })
      .onConflictDoUpdate({
        target: userCredentials.userId,
        set: { passwordHash, passwordUpdatedAt: new Date() },
      });
    await transaction
      .update(users)
      .set({ status: "active", updatedAt: new Date() })
      .where(eq(users.id, link.userId));

    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + SESSION_LIFETIME_SECONDS * 1_000);

    await transaction.insert(userSessions).values({
      expiresAt,
      tokenHash: hashToken(token),
      userId: link.userId,
    });

    return { expiresAt, token };
  });
}

export async function authenticateWithPassword(db: AppDatabase, email: string, password: string) {
  const candidates = await db
    .select({
      organizationId: users.organizationId,
      passwordHash: userCredentials.passwordHash,
      status: users.status,
      userId: users.id,
    })
    .from(users)
    .innerJoin(userCredentials, eq(userCredentials.userId, users.id))
    .where(eq(users.email, email.trim().toLowerCase()))
    .limit(2);
  const candidate = candidates.at(0);

  if (
    candidates.length !== 1 ||
    !candidate ||
    candidate.status !== "active" ||
    !(await verifyPassword(candidate.passwordHash, password))
  ) {
    throw new AuthenticationError("メールアドレスまたはパスワードが正しくありません。");
  }

  const session = await createSession(db, candidate.userId);

  return { ...session, organizationId: candidate.organizationId, userId: candidate.userId };
}

export async function revokeSession(db: AppDatabase, token: string | undefined) {
  if (!token) {
    return;
  }

  await db
    .update(userSessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(userSessions.tokenHash, hashToken(token)), isNull(userSessions.revokedAt)));
}

export async function sessionForToken(db: AppDatabase, token: string | undefined) {
  if (!token) {
    return undefined;
  }

  const [session] = await db
    .select({
      displayName: users.displayName,
      expiresAt: userSessions.expiresAt,
      organizationId: users.organizationId,
      role: users.role,
      userId: users.id,
    })
    .from(userSessions)
    .innerJoin(users, eq(users.id, userSessions.userId))
    .where(
      and(
        eq(userSessions.tokenHash, hashToken(token)),
        gt(userSessions.expiresAt, new Date()),
        isNull(userSessions.revokedAt),
        eq(users.status, "active"),
      ),
    )
    .limit(1);

  return session;
}

function usesSecureCookies() {
  return loadEnvironment().appUrl.protocol === "https:";
}

export function sessionCookie(token: string, expiresAt: Date, secure = usesSecureCookies()) {
  const attributes = [
    `${SESSION_COOKIE_NAME}=${token}`,
    "HttpOnly",
    "Path=/",
    "SameSite=Lax",
    `Max-Age=${Math.floor((expiresAt.getTime() - Date.now()) / 1_000)}`,
  ];

  if (secure) {
    attributes.push("Secure");
  }

  return attributes.join("; ");
}

export function expiredSessionCookie(secure = usesSecureCookies()) {
  const attributes = [`${SESSION_COOKIE_NAME}=`, "HttpOnly", "Path=/", "SameSite=Lax", "Max-Age=0"];

  if (secure) {
    attributes.push("Secure");
  }

  return attributes.join("; ");
}

export function cookieValue(cookieHeader: string | null, name: string) {
  if (!cookieHeader) {
    return undefined;
  }

  return cookieHeader
    .split(";")
    .map((part) => part.trim().split("=", 2))
    .find(([key]) => key === name)?.[1];
}
