import { createHash } from "node:crypto";

import iconv from "iconv-lite";

import type {
  PayrollExportColumn,
  PayrollExportProfileConfig,
  PayrollValidationIssue,
} from "@/lib/payroll-export-types";
import { PAYROLL_GENERATOR_SCHEMA_VERSION } from "@/lib/payroll-export-types";

export type PayrollSourceRow = {
  employeeId: string;
  externalEmployeeCode: string;
  unavailableFields?: string[];
  values: Record<string, unknown>;
};

function integerValue(value: unknown) {
  if (typeof value !== "number" || !Number.isSafeInteger(value))
    throw new Error("整数ではありません。");
  return value;
}

export function minutesToHhmm(minutes: number) {
  const value = integerValue(minutes);
  const sign = value < 0 ? "-" : "";
  const absolute = Math.abs(value);
  return `${sign}${Math.floor(absolute / 60)}:${String(absolute % 60).padStart(2, "0")}`;
}

export function minutesToDecimalHours(
  minutes: number,
  decimalPlaces: number,
  rounding: "half_up" | "truncate",
) {
  const value = BigInt(integerValue(minutes));
  const scale = 10n ** BigInt(decimalPlaces);
  const numerator = value * scale;
  let quotient = numerator / 60n;
  const remainder = numerator % 60n;
  if (rounding === "half_up" && (remainder < 0n ? -remainder : remainder) * 2n >= 60n) {
    quotient += value < 0n ? -1n : 1n;
  }
  const sign = quotient < 0n ? "-" : "";
  const absolute = quotient < 0n ? -quotient : quotient;
  if (decimalPlaces === 0) return `${sign}${absolute}`;
  const digits = absolute.toString().padStart(decimalPlaces + 1, "0");
  return `${sign}${digits.slice(0, -decimalPlaces)}.${digits.slice(-decimalPlaces)}`;
}

export function escapeCsvCell(value: string) {
  return /[",\r\n]/u.test(value) ? `"${value.replace(/"/gu, '""')}"` : value;
}

function sourceValue(column: PayrollExportColumn, row: PayrollSourceRow) {
  if (column.source.kind === "empty") return "";
  if (column.source.kind === "fixed") return column.source.value;
  if (column.source.field === "external_employee_code") return row.externalEmployeeCode;
  return row.values[column.source.field];
}

function transformValue(column: PayrollExportColumn, value: unknown) {
  switch (column.transform.kind) {
    case "text":
      return value === null || value === undefined ? "" : String(value);
    case "integer":
    case "minutes":
      return String(integerValue(value));
    case "hhmm":
      return minutesToHhmm(integerValue(value));
    case "decimal_hours":
      return minutesToDecimalHours(
        integerValue(value),
        column.transform.decimalPlaces!,
        column.transform.rounding!,
      );
    case "date": {
      if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value))
        throw new Error("日付ではありません。");
      return column.transform.dateFormat === "YYYY/MM/DD"
        ? value.replace(/-/gu, "/")
        : column.transform.dateFormat === "YYYYMMDD"
          ? value.replace(/-/gu, "")
          : value;
    }
    case "year_month":
      if (typeof value !== "string" || !/^\d{4}-\d{2}$/u.test(value))
        throw new Error("年月ではありません。");
      return value;
    case "mapped_value": {
      const key = value === null || value === undefined ? "" : String(value);
      const mapped = column.transform.valueMap?.[key];
      if (mapped === undefined) throw new Error("区分対応がありません。");
      return mapped;
    }
  }
}

function formulaCandidate(value: string) {
  return /^[=+\-@]/u.test(value.trimStart());
}

export function safeDownloadFileName(pattern: string, values: Record<string, string | number>) {
  const replaced = pattern.replace(/\{(targetMonth|revision|profileName)\}/gu, (_, key: string) =>
    String(values[key] ?? ""),
  );
  return replaced
    .normalize("NFKC")
    .replace(/[\\/\u0000-\u001f\u007f]/gu, "-")
    .replace(/\.\.+/gu, ".")
    .slice(0, 180);
}

export function generatePayrollCsv(
  config: PayrollExportProfileConfig,
  sourceRows: PayrollSourceRow[],
) {
  const issues: PayrollValidationIssue[] = [];
  const rows = [...sourceRows].sort(
    (first, second) =>
      first.externalEmployeeCode.localeCompare(second.externalEmployeeCode, "en") ||
      first.employeeId.localeCompare(second.employeeId, "en"),
  );
  const previewRows: Array<{
    cells: Array<{ columnId: string; sourceValue: unknown; value: string }>;
    employeeId: string;
    externalEmployeeCode: string;
  }> = [];
  const output = rows.map((row) => {
    const cells: Array<{ columnId: string; sourceValue: unknown; value: string }> = [];
    const values = config.columns.map((column) => {
      if (column.source.kind === "field" && row.unavailableFields?.includes(column.source.field)) {
        if (column.required) {
          issues.push({
            code: "unavailable_required",
            columnId: column.id,
            employeeId: row.employeeId,
            message: "この締めリビジョンには必須フィールドが保存されていません。",
            severity: "error",
          });
        }
        cells.push({ columnId: column.id, sourceValue: null, value: "" });
        return "";
      }
      const raw = sourceValue(column, row);
      let value = "";
      try {
        value = transformValue(column, raw);
      } catch (error) {
        issues.push({
          code: "invalid_value",
          columnId: column.id,
          employeeId: row.employeeId,
          message: error instanceof Error ? error.message : "変換できません。",
          severity: "error",
        });
        cells.push({ columnId: column.id, sourceValue: raw, value: "" });
        return "";
      }
      if (column.required && value === "") {
        issues.push({
          code: "required",
          columnId: column.id,
          employeeId: row.employeeId,
          message: "必須値が空です。",
          severity: "error",
        });
      }
      if (column.maxLength && value.length > column.maxLength) {
        issues.push({
          code: "too_long",
          columnId: column.id,
          employeeId: row.employeeId,
          message: "文字数上限を超えています。",
          severity: "error",
        });
      }
      const textSource = typeof raw === "string";
      if (textSource && formulaCandidate(value)) {
        if (column.formulaPolicy === "reject") {
          issues.push({
            code: "formula_injection",
            columnId: column.id,
            employeeId: row.employeeId,
            message: "数式として解釈される文字列です。",
            severity: "error",
          });
        } else {
          value = `'${value}`;
          issues.push({
            code: "formula_prefixed",
            columnId: column.id,
            employeeId: row.employeeId,
            message: "数式注入防止のため先頭にアポストロフィを追加しました。",
            severity: "warning",
          });
        }
      }
      if (
        config.encoding === "cp932" &&
        iconv.decode(iconv.encode(value, "cp932"), "cp932") !== value
      ) {
        const unsupported = [...value].filter(
          (character) => iconv.decode(iconv.encode(character, "cp932"), "cp932") !== character,
        );
        issues.push({
          code: "cp932_unrepresentable",
          columnId: column.id,
          employeeId: row.employeeId,
          message: `CP932で往復変換できない文字があります: ${unsupported.join("")}`,
          severity: "error",
        });
      }
      cells.push({ columnId: column.id, sourceValue: raw, value });
      return value;
    });
    previewRows.push({
      cells,
      employeeId: row.employeeId,
      externalEmployeeCode: row.externalEmployeeCode,
    });
    return values;
  });
  const lineEnding = config.lineEnding === "crlf" ? "\r\n" : "\n";
  const csv = [config.columns.map((column) => column.header), ...output]
    .map((row) => row.map(escapeCsvCell).join(","))
    .join(lineEnding)
    .concat(lineEnding);
  const bytes =
    config.encoding === "cp932"
      ? iconv.encode(csv, "cp932")
      : Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(csv, "utf8")]);
  return {
    bytes,
    columnCount: config.columns.length,
    generatorVersion: PAYROLL_GENERATOR_SCHEMA_VERSION,
    issues,
    previewRows,
    rowCount: rows.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

export function payrollCsvDownloadHeaders(fileName: string) {
  return {
    "Cache-Control": "private, no-store",
    "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    "Content-Type": "text/csv; charset=binary",
    "X-Content-Type-Options": "nosniff",
  };
}
