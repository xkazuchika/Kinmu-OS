import { and, asc, desc, eq, ilike, isNull, ne, or } from "drizzle-orm";

import type { AppDatabase } from "@/lib/db/client";
import {
  departments,
  employeeDepartments,
  employees,
  employeeStatus,
  employeeStatusHistory,
  employmentType,
  users,
} from "@/lib/db/schema";
import { DepartmentManagementError } from "@/lib/departments";

type EmployeeStatus = (typeof employeeStatus.enumValues)[number];
type EmploymentType = (typeof employmentType.enumValues)[number];

export class EmployeeManagementError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmployeeManagementError";
  }
}

function required(value: string, label: string, maxLength = 100) {
  const normalized = value.trim();

  if (!normalized || normalized.length > maxLength) {
    throw new EmployeeManagementError(`${label}は1〜${maxLength}文字で入力してください。`);
  }

  return normalized;
}

function optionalEmail(value: string | undefined) {
  const email = value?.trim().toLowerCase();

  if (!email) return undefined;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new EmployeeManagementError("連絡用メールアドレスの形式が正しくありません。");
  }

  return email;
}

function validDate(value: string, label: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new EmployeeManagementError(`${label}を正しい日付で入力してください。`);
  }

  return value;
}

export async function createEmployee(
  db: AppDatabase,
  input: {
    contactEmail?: string;
    departmentId: string;
    displayName: string;
    employeeNumber: string;
    employmentType: string;
    familyName: string;
    givenName: string;
    joinedOn: string;
    organizationId: string;
    status: string;
  },
) {
  const employeeNumber = required(input.employeeNumber, "従業員番号", 32);
  const familyName = required(input.familyName, "姓");
  const givenName = required(input.givenName, "名");
  const displayName = required(input.displayName, "表示名");
  const joinedOn = validDate(input.joinedOn, "入社日");

  if (!employmentType.enumValues.includes(input.employmentType as EmploymentType)) {
    throw new EmployeeManagementError("雇用区分を選択してください。");
  }
  if (!employeeStatus.enumValues.includes(input.status as EmployeeStatus)) {
    throw new EmployeeManagementError("在籍状態を選択してください。");
  }

  return db.transaction(async (transaction) => {
    const [department] = await transaction
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

    const [duplicate] = await transaction
      .select({ id: employees.id })
      .from(employees)
      .where(
        and(
          eq(employees.organizationId, input.organizationId),
          eq(employees.employeeNumber, employeeNumber),
        ),
      )
      .limit(1);

    if (duplicate) {
      throw new EmployeeManagementError("同じ従業員番号がすでに使われています。");
    }

    const [employee] = await transaction
      .insert(employees)
      .values({
        contactEmail: optionalEmail(input.contactEmail),
        displayName,
        employeeNumber,
        employmentType: input.employmentType as EmploymentType,
        familyName,
        givenName,
        joinedOn,
        organizationId: input.organizationId,
        status: input.status as EmployeeStatus,
      })
      .returning();

    await transaction.insert(employeeDepartments).values({
      departmentId: department.id,
      employeeId: employee.id,
      isPrimary: true,
      startedOn: joinedOn,
    });
    await transaction.insert(employeeStatusHistory).values({
      effectiveOn: joinedOn,
      employeeId: employee.id,
      reason: "初回登録",
      status: input.status as EmployeeStatus,
    });

    return employee;
  });
}

export function listEmployees(
  db: AppDatabase,
  input: { departmentId?: string; organizationId: string; query?: string; status?: string },
) {
  const conditions = [
    eq(employees.organizationId, input.organizationId),
    eq(employeeDepartments.isPrimary, true),
    isNull(employeeDepartments.endedOn),
  ];
  const query = input.query?.trim();

  if (query) {
    conditions.push(
      or(
        ilike(employees.employeeNumber, `%${query}%`),
        ilike(employees.familyName, `%${query}%`),
        ilike(employees.givenName, `%${query}%`),
        ilike(employees.displayName, `%${query}%`),
      )!,
    );
  }
  if (input.departmentId) conditions.push(eq(departments.id, input.departmentId));
  if (employeeStatus.enumValues.includes(input.status as EmployeeStatus)) {
    conditions.push(eq(employees.status, input.status as EmployeeStatus));
  } else if (input.status !== "all") {
    conditions.push(ne(employees.status, "terminated"));
  }

  return db
    .select({
      departmentId: departments.id,
      departmentName: departments.name,
      displayName: employees.displayName,
      employeeNumber: employees.employeeNumber,
      employmentType: employees.employmentType,
      familyName: employees.familyName,
      givenName: employees.givenName,
      id: employees.id,
      joinedOn: employees.joinedOn,
      status: employees.status,
    })
    .from(employees)
    .innerJoin(employeeDepartments, eq(employeeDepartments.employeeId, employees.id))
    .innerJoin(departments, eq(departments.id, employeeDepartments.departmentId))
    .where(and(...conditions))
    .orderBy(asc(employees.employeeNumber));
}

export async function getEmployeeDetails(
  db: AppDatabase,
  input: { employeeId: string; organizationId: string },
) {
  const [employee] = await db
    .select()
    .from(employees)
    .where(
      and(eq(employees.id, input.employeeId), eq(employees.organizationId, input.organizationId)),
    )
    .limit(1);

  if (!employee) throw new EmployeeManagementError("従業員が見つかりません。");

  const [primaryDepartment] = await db
    .select({
      departmentId: departments.id,
      departmentName: departments.name,
      startedOn: employeeDepartments.startedOn,
    })
    .from(employeeDepartments)
    .innerJoin(departments, eq(departments.id, employeeDepartments.departmentId))
    .where(
      and(
        eq(employeeDepartments.employeeId, employee.id),
        eq(employeeDepartments.isPrimary, true),
        isNull(employeeDepartments.endedOn),
      ),
    )
    .limit(1);
  const statusHistory = await db
    .select({
      effectiveOn: employeeStatusHistory.effectiveOn,
      id: employeeStatusHistory.id,
      reason: employeeStatusHistory.reason,
      status: employeeStatusHistory.status,
    })
    .from(employeeStatusHistory)
    .where(eq(employeeStatusHistory.employeeId, employee.id))
    .orderBy(desc(employeeStatusHistory.effectiveOn));

  return { ...employee, primaryDepartment, statusHistory };
}

function previousDate(value: string) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

export async function updateEmployeeRecord(
  db: AppDatabase,
  input: {
    contactEmail?: string;
    departmentEffectiveOn?: string;
    departmentId?: string;
    displayName?: string;
    employeeId: string;
    employmentType?: string;
    familyName?: string;
    givenName?: string;
    organizationId: string;
    phoneNumber?: string;
    userId?: string | null;
  },
) {
  return db.transaction(async (transaction) => {
    const [current] = await transaction
      .select()
      .from(employees)
      .where(
        and(eq(employees.id, input.employeeId), eq(employees.organizationId, input.organizationId)),
      )
      .limit(1);

    if (!current) throw new EmployeeManagementError("従業員が見つかりません。");
    if (
      input.employmentType &&
      !employmentType.enumValues.includes(input.employmentType as EmploymentType)
    ) {
      throw new EmployeeManagementError("雇用区分を選択してください。");
    }
    if (input.userId) {
      const [user] = await transaction
        .select({ id: users.id })
        .from(users)
        .where(
          and(
            eq(users.id, input.userId),
            eq(users.organizationId, input.organizationId),
            eq(users.role, "employee"),
          ),
        )
        .limit(1);

      if (!user) {
        throw new EmployeeManagementError("同じ組織の従業員利用者を選択してください。");
      }
      const [linkedEmployee] = await transaction
        .select({ id: employees.id })
        .from(employees)
        .where(and(eq(employees.userId, user.id), ne(employees.id, current.id)))
        .limit(1);
      if (linkedEmployee) {
        throw new EmployeeManagementError("この利用者は別の従業員に紐付いています。");
      }
    }

    const [employee] = await transaction
      .update(employees)
      .set({
        contactEmail:
          input.contactEmail === undefined
            ? current.contactEmail
            : optionalEmail(input.contactEmail),
        displayName:
          input.displayName === undefined
            ? current.displayName
            : required(input.displayName, "表示名"),
        employmentType:
          (input.employmentType as EmploymentType | undefined) ?? current.employmentType,
        familyName:
          input.familyName === undefined ? current.familyName : required(input.familyName, "姓"),
        givenName:
          input.givenName === undefined ? current.givenName : required(input.givenName, "名"),
        phoneNumber:
          input.phoneNumber === undefined ? current.phoneNumber : input.phoneNumber.trim() || null,
        userId: input.userId === undefined ? current.userId : input.userId,
        updatedAt: new Date(),
      })
      .where(eq(employees.id, current.id))
      .returning();

    if (input.departmentId) {
      const [currentAssignment] = await transaction
        .select()
        .from(employeeDepartments)
        .where(
          and(
            eq(employeeDepartments.employeeId, current.id),
            eq(employeeDepartments.isPrimary, true),
            isNull(employeeDepartments.endedOn),
          ),
        )
        .limit(1);

      if (currentAssignment?.departmentId !== input.departmentId) {
        const effectiveOn = validDate(input.departmentEffectiveOn ?? "", "所属変更の適用日");
        const [department] = await transaction
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
        if (currentAssignment && effectiveOn <= currentAssignment.startedOn) {
          throw new EmployeeManagementError("所属変更日は現在の所属開始日より後にしてください。");
        }
        if (currentAssignment) {
          await transaction
            .update(employeeDepartments)
            .set({ endedOn: previousDate(effectiveOn) })
            .where(eq(employeeDepartments.id, currentAssignment.id));
        }
        await transaction.insert(employeeDepartments).values({
          departmentId: department.id,
          employeeId: current.id,
          isPrimary: true,
          startedOn: effectiveOn,
        });
      }
    }

    return employee;
  });
}

export async function getSelfProfile(
  db: AppDatabase,
  input: { organizationId: string; userId: string },
) {
  const [profile] = await db
    .select({
      contactEmail: employees.contactEmail,
      departmentId: departments.id,
      departmentName: departments.name,
      displayName: employees.displayName,
      employeeNumber: employees.employeeNumber,
      employmentType: employees.employmentType,
      familyName: employees.familyName,
      givenName: employees.givenName,
      id: employees.id,
      phoneNumber: employees.phoneNumber,
      status: employees.status,
    })
    .from(employees)
    .innerJoin(employeeDepartments, eq(employeeDepartments.employeeId, employees.id))
    .innerJoin(departments, eq(departments.id, employeeDepartments.departmentId))
    .where(
      and(
        eq(employees.organizationId, input.organizationId),
        eq(employees.userId, input.userId),
        eq(employeeDepartments.isPrimary, true),
        isNull(employeeDepartments.endedOn),
      ),
    )
    .limit(1);

  return profile;
}

export async function updateSelfContact(
  db: AppDatabase,
  input: { contactEmail?: string; employeeId: string; phoneNumber?: string },
) {
  const [employee] = await db
    .update(employees)
    .set({
      contactEmail: optionalEmail(input.contactEmail),
      phoneNumber: input.phoneNumber?.trim() || null,
      updatedAt: new Date(),
    })
    .where(eq(employees.id, input.employeeId))
    .returning();

  if (!employee) throw new EmployeeManagementError("従業員が見つかりません。");
  return employee;
}

const allowedStatusTransitions: Record<EmployeeStatus, ReadonlySet<EmployeeStatus>> = {
  active: new Set(["on_leave", "terminated"]),
  on_leave: new Set(["active", "terminated"]),
  scheduled: new Set(["active", "terminated"]),
  terminated: new Set(),
};

export async function changeEmployeeStatus(
  db: AppDatabase,
  input: {
    effectiveOn: string;
    employeeId: string;
    organizationId: string;
    reason: string;
    status: string;
  },
) {
  if (!employeeStatus.enumValues.includes(input.status as EmployeeStatus)) {
    throw new EmployeeManagementError("変更後の在籍状態を選択してください。");
  }
  const effectiveOn = validDate(input.effectiveOn, "状態変更の適用日");
  const reason = required(input.reason, "変更理由", 500);

  return db.transaction(async (transaction) => {
    const [employee] = await transaction
      .select()
      .from(employees)
      .where(
        and(eq(employees.id, input.employeeId), eq(employees.organizationId, input.organizationId)),
      )
      .limit(1);

    if (!employee) throw new EmployeeManagementError("従業員が見つかりません。");
    const nextStatus = input.status as EmployeeStatus;
    if (!allowedStatusTransitions[employee.status].has(nextStatus)) {
      throw new EmployeeManagementError("この在籍状態への変更はできません。");
    }
    const [latestHistory] = await transaction
      .select({ effectiveOn: employeeStatusHistory.effectiveOn })
      .from(employeeStatusHistory)
      .where(eq(employeeStatusHistory.employeeId, employee.id))
      .orderBy(desc(employeeStatusHistory.effectiveOn))
      .limit(1);
    if (latestHistory && effectiveOn <= latestHistory.effectiveOn) {
      throw new EmployeeManagementError("適用日は直前の在籍状態より後の日付にしてください。");
    }

    const [updated] = await transaction
      .update(employees)
      .set({
        leftOn: nextStatus === "terminated" ? effectiveOn : employee.leftOn,
        status: nextStatus,
        updatedAt: new Date(),
      })
      .where(eq(employees.id, employee.id))
      .returning();
    await transaction.insert(employeeStatusHistory).values({
      effectiveOn,
      employeeId: employee.id,
      reason,
      status: nextStatus,
    });

    return updated;
  });
}

export function assertEmployeeCanPunch(
  employee: Pick<typeof employees.$inferSelect, "leftOn" | "status">,
  workDate: string,
) {
  validDate(workDate, "勤務日");

  if (employee.status === "terminated" || (employee.leftOn && workDate > employee.leftOn)) {
    throw new EmployeeManagementError("退職日後は打刻できません。");
  }
  if (employee.status !== "active") {
    throw new EmployeeManagementError("在籍中の従業員だけが打刻できます。");
  }
}
