import { and, asc, eq, ne, or } from "drizzle-orm";

import type { AppDatabase } from "@/lib/db/client";
import { departments } from "@/lib/db/schema";

export class DepartmentManagementError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DepartmentManagementError";
  }
}

function normalizeDepartment(input: { code: string; name: string }) {
  const code = input.code.trim().toUpperCase();
  const name = input.name.trim();

  if (!code || code.length > 32) {
    throw new DepartmentManagementError("部署コードは1〜32文字で入力してください。");
  }

  if (!name || name.length > 100) {
    throw new DepartmentManagementError("部署名は1〜100文字で入力してください。");
  }

  return { code, name };
}

async function assertUniqueDepartment(
  db: AppDatabase,
  input: { code: string; departmentId?: string; name: string; organizationId: string },
) {
  const duplicateCondition = or(eq(departments.code, input.code), eq(departments.name, input.name));
  const where = input.departmentId
    ? and(
        eq(departments.organizationId, input.organizationId),
        ne(departments.id, input.departmentId),
        duplicateCondition,
      )
    : and(eq(departments.organizationId, input.organizationId), duplicateCondition);
  const [duplicate] = await db
    .select({ id: departments.id })
    .from(departments)
    .where(where)
    .limit(1);

  if (duplicate) {
    throw new DepartmentManagementError("同じ部署コードまたは部署名がすでに使われています。");
  }
}

export function listDepartments(db: AppDatabase, organizationId: string) {
  return db
    .select({
      active: departments.active,
      code: departments.code,
      id: departments.id,
      name: departments.name,
      updatedAt: departments.updatedAt,
    })
    .from(departments)
    .where(eq(departments.organizationId, organizationId))
    .orderBy(asc(departments.code));
}

export async function createDepartment(
  db: AppDatabase,
  input: { code: string; name: string; organizationId: string },
) {
  const normalized = normalizeDepartment(input);
  await assertUniqueDepartment(db, { ...normalized, organizationId: input.organizationId });

  const [department] = await db
    .insert(departments)
    .values({ ...normalized, organizationId: input.organizationId })
    .returning();

  return department;
}

export async function updateDepartment(
  db: AppDatabase,
  input: {
    active?: boolean;
    code?: string;
    departmentId: string;
    name?: string;
    organizationId: string;
  },
) {
  const [current] = await db
    .select()
    .from(departments)
    .where(
      and(
        eq(departments.id, input.departmentId),
        eq(departments.organizationId, input.organizationId),
      ),
    )
    .limit(1);

  if (!current) {
    throw new DepartmentManagementError("部署が見つかりません。");
  }

  const normalized = normalizeDepartment({
    code: input.code ?? current.code,
    name: input.name ?? current.name,
  });
  await assertUniqueDepartment(db, {
    ...normalized,
    departmentId: current.id,
    organizationId: input.organizationId,
  });

  const [department] = await db
    .update(departments)
    .set({
      ...normalized,
      active: input.active ?? current.active,
      updatedAt: new Date(),
    })
    .where(eq(departments.id, current.id))
    .returning();

  return department;
}

export async function requireActiveDepartment(
  db: AppDatabase,
  input: { departmentId: string; organizationId: string },
) {
  const [department] = await db
    .select({ id: departments.id })
    .from(departments)
    .where(
      and(
        eq(departments.id, input.departmentId),
        eq(departments.organizationId, input.organizationId),
        eq(departments.active, true),
      ),
    )
    .limit(1);

  if (!department) {
    throw new DepartmentManagementError("主所属には有効な部署を選択してください。");
  }

  return department;
}
