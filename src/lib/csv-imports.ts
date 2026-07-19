import { and, eq } from "drizzle-orm";

import type { AppDatabase } from "@/lib/db/client";
import {
  departments,
  employeeDepartments,
  employees,
  employeeStatus,
  employeeStatusHistory,
  employmentType,
} from "@/lib/db/schema";

export type ImportKind = "departments" | "employees";
export type CsvImportError = { line: number; message: string };

export class CsvImportValidationError extends Error {
  constructor(
    message: string,
    readonly errors: CsvImportError[],
  ) {
    super(message);
    this.name = "CsvImportValidationError";
  }
}

function parseCsv(csv: string) {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let quoted = false;

  for (let index = 0; index < csv.length; index += 1) {
    const character = csv[index];
    if (character === '"') {
      if (quoted && csv[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      row.push(field);
      field = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && csv[index + 1] === "\n") index += 1;
      row.push(field);
      if (row.some((value) => value.length > 0)) rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }
  row.push(field);
  if (row.some((value) => value.length > 0)) rows.push(row);
  if (quoted)
    throw new CsvImportValidationError("CSVの引用符が閉じられていません。", [
      { line: rows.length + 1, message: "引用符を確認してください。" },
    ]);
  return rows;
}

export function csvRecords(csv: string, expectedHeaders: string[]) {
  const [headers, ...rows] = parseCsv(csv.replace(/^\uFEFF/, ""));
  if (!headers || headers.join(",") !== expectedHeaders.join(",")) {
    throw new CsvImportValidationError("CSVの列がテンプレートと一致しません。", [
      { line: 1, message: `必要な列: ${expectedHeaders.join(", ")}` },
    ]);
  }
  return rows.map((row, index) => ({
    line: index + 2,
    value: Object.fromEntries(
      expectedHeaders.map((header, column) => [header, row[column]?.trim() ?? ""]),
    ),
  }));
}

const departmentHeaders = ["code", "name"];
const employeeHeaders = [
  "employeeNumber",
  "familyName",
  "givenName",
  "displayName",
  "contactEmail",
  "departmentCode",
  "joinedOn",
  "employmentType",
  "status",
];

type EmployeeImportPreview = {
  contactEmail: string;
  departmentCode: string;
  departmentId?: string;
  departmentName?: string;
  displayName: string;
  employeeNumber: string;
  employmentType: string;
  familyName: string;
  givenName: string;
  joinedOn: string;
  line: number;
  status: string;
};

export async function previewCsvImport(
  db: AppDatabase,
  input: { csv: string; kind: ImportKind; organizationId: string },
) {
  if (input.kind === "departments") {
    const parsed = csvRecords(input.csv, departmentHeaders);
    const existing = await db
      .select({ code: departments.code, name: departments.name })
      .from(departments)
      .where(eq(departments.organizationId, input.organizationId));
    const codes = new Set(existing.map((row) => row.code));
    const names = new Set(existing.map((row) => row.name));
    const errors: CsvImportError[] = [];
    const preview = parsed.map(({ line, value }) => {
      const code = value.code.toUpperCase();
      const name = value.name;
      if (!code || !name) errors.push({ line, message: "部署コードと部署名は必須です。" });
      if (codes.has(code)) errors.push({ line, message: `部署コード ${code} は重複しています。` });
      if (names.has(name)) errors.push({ line, message: `部署名 ${name} は重複しています。` });
      codes.add(code);
      names.add(name);
      return { code, line, name };
    });
    return { errors, preview };
  }

  const parsed = csvRecords(input.csv, employeeHeaders);
  const activeDepartments = await db
    .select({ code: departments.code, id: departments.id, name: departments.name })
    .from(departments)
    .where(and(eq(departments.organizationId, input.organizationId), eq(departments.active, true)));
  const departmentByCode = new Map(
    activeDepartments.map((department) => [department.code, department]),
  );
  const existing = await db
    .select({ contactEmail: employees.contactEmail, employeeNumber: employees.employeeNumber })
    .from(employees)
    .where(eq(employees.organizationId, input.organizationId));
  const numbers = new Set(existing.map((row) => row.employeeNumber));
  const emails = new Set(existing.flatMap((row) => (row.contactEmail ? [row.contactEmail] : [])));
  const errors: CsvImportError[] = [];
  const preview: EmployeeImportPreview[] = parsed.map(({ line, value }) => {
    const requiredValues = [
      value.employeeNumber,
      value.familyName,
      value.givenName,
      value.displayName,
      value.departmentCode,
      value.joinedOn,
      value.employmentType,
      value.status,
    ];
    if (requiredValues.some((item) => !item))
      errors.push({ line, message: "必須項目が不足しています。" });
    if (numbers.has(value.employeeNumber))
      errors.push({ line, message: `従業員番号 ${value.employeeNumber} は重複しています。` });
    if (value.contactEmail && emails.has(value.contactEmail.toLowerCase()))
      errors.push({ line, message: `メールアドレス ${value.contactEmail} は重複しています。` });
    const department = departmentByCode.get(value.departmentCode.toUpperCase());
    if (!department)
      errors.push({ line, message: `有効な部署 ${value.departmentCode} が見つかりません。` });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value.joinedOn))
      errors.push({ line, message: "入社日はYYYY-MM-DD形式にしてください。" });
    if (!employmentType.enumValues.includes(value.employmentType as never))
      errors.push({ line, message: "雇用区分が正しくありません。" });
    if (!employeeStatus.enumValues.includes(value.status as never))
      errors.push({ line, message: "在籍状態が正しくありません。" });
    numbers.add(value.employeeNumber);
    if (value.contactEmail) emails.add(value.contactEmail.toLowerCase());
    return {
      contactEmail: value.contactEmail.toLowerCase(),
      departmentCode: value.departmentCode,
      departmentId: department?.id,
      departmentName: department?.name,
      displayName: value.displayName,
      employeeNumber: value.employeeNumber,
      employmentType: value.employmentType,
      familyName: value.familyName,
      givenName: value.givenName,
      joinedOn: value.joinedOn,
      line,
      status: value.status,
    };
  });
  return { errors, preview };
}

export async function commitCsvImport(
  db: AppDatabase,
  input: { csv: string; kind: ImportKind; organizationId: string },
) {
  const validation = await previewCsvImport(db, input);
  if (validation.errors.length > 0)
    throw new CsvImportValidationError("CSVに修正が必要な行があります。", validation.errors);

  return db.transaction(async (transaction) => {
    if (input.kind === "departments") {
      const preview = validation.preview as Array<{ code: string; name: string }>;
      const values = preview.map((row) => ({
        code: row.code,
        name: row.name,
        organizationId: input.organizationId,
      }));
      if (values.length > 0) await transaction.insert(departments).values(values);
      return values.length;
    }
    const preview = validation.preview as EmployeeImportPreview[];
    for (const row of preview) {
      const [employee] = await transaction
        .insert(employees)
        .values({
          contactEmail: row.contactEmail || null,
          displayName: row.displayName,
          employeeNumber: row.employeeNumber,
          employmentType: row.employmentType as (typeof employmentType.enumValues)[number],
          familyName: row.familyName,
          givenName: row.givenName,
          joinedOn: row.joinedOn,
          organizationId: input.organizationId,
          status: row.status as (typeof employeeStatus.enumValues)[number],
        })
        .returning();
      await transaction.insert(employeeDepartments).values({
        departmentId: row.departmentId!,
        employeeId: employee.id,
        startedOn: row.joinedOn,
      });
      await transaction.insert(employeeStatusHistory).values({
        effectiveOn: row.joinedOn,
        employeeId: employee.id,
        reason: "CSV取込",
        status: row.status as (typeof employeeStatus.enumValues)[number],
      });
    }
    return preview.length;
  });
}
