import { and, eq } from "drizzle-orm";

import { cookieValue, sessionForToken, SESSION_COOKIE_NAME } from "@/lib/auth";
import type { AppDatabase } from "@/lib/db/client";
import { employees } from "@/lib/db/schema";

export type Permission =
  | "audit:read"
  | "attendance:manage"
  | "employees:manage"
  | "reports:read"
  | "self:read"
  | "self:write"
  | "users:manage";

export type SessionActor = NonNullable<Awaited<ReturnType<typeof sessionForToken>>>;

export class AuthorizationError extends Error {
  constructor(message = "この操作を行う権限がありません。") {
    super(message);
    this.name = "AuthorizationError";
  }
}

const permissionsByRole: Readonly<Record<SessionActor["role"], ReadonlySet<Permission>>> = {
  owner: new Set([
    "audit:read",
    "attendance:manage",
    "employees:manage",
    "reports:read",
    "self:read",
    "self:write",
    "users:manage",
  ]),
  hr_admin: new Set([
    "audit:read",
    "attendance:manage",
    "employees:manage",
    "reports:read",
    "self:read",
    "self:write",
    "users:manage",
  ]),
  employee: new Set(["self:read", "self:write"]),
};

export function can(actor: SessionActor, permission: Permission) {
  return permissionsByRole[actor.role].has(permission);
}

export function requirePermission(actor: SessionActor, permission: Permission) {
  if (!can(actor, permission)) {
    throw new AuthorizationError();
  }
}

export async function actorFromRequest(db: AppDatabase, request: Request) {
  return sessionForToken(db, cookieValue(request.headers.get("cookie"), SESSION_COOKIE_NAME));
}

export async function requireActor(db: AppDatabase, request: Request) {
  const actor = await actorFromRequest(db, request);

  if (!actor) {
    throw new AuthorizationError("認証が必要です。");
  }

  return actor;
}

export async function requireEmployeeScope(
  db: AppDatabase,
  actor: SessionActor,
  employeeId: string,
) {
  if (can(actor, "employees:manage")) {
    return;
  }

  const [employee] = await db
    .select({ id: employees.id })
    .from(employees)
    .where(
      and(
        eq(employees.id, employeeId),
        eq(employees.organizationId, actor.organizationId),
        eq(employees.userId, actor.userId),
      ),
    )
    .limit(1);

  if (!employee) {
    throw new AuthorizationError();
  }
}
