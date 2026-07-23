import { describe, expect, it } from "vitest";

import {
  escapeCsvCell,
  generatePayrollCsv,
  minutesToDecimalHours,
  minutesToHhmm,
  payrollCsvDownloadHeaders,
  safeDownloadFileName,
} from "@/lib/payroll-csv";
import type { PayrollExportProfileConfig } from "@/lib/payroll-export-types";

function config(encoding: "utf8_bom" | "cp932" = "utf8_bom"): PayrollExportProfileConfig {
  return {
    schemaVersion: 1,
    encoding,
    lineEnding: "crlf",
    fileNamePattern: "payroll-{targetMonth}.csv",
    columns: [
      {
        id: "code",
        header: "コード",
        source: { kind: "field", field: "external_employee_code" },
        transform: { kind: "text" },
        required: true,
        formulaPolicy: "reject",
      },
      {
        id: "name",
        header: "氏名",
        source: { kind: "field", field: "display_name" },
        transform: { kind: "text" },
        required: true,
        formulaPolicy: "prefix_apostrophe",
      },
      {
        id: "hours",
        header: "実働",
        source: { kind: "field", field: "worked_minutes" },
        transform: { kind: "decimal_hours", decimalPlaces: 2, rounding: "half_up" },
        required: true,
        formulaPolicy: "reject",
      },
    ],
  };
}

describe("payroll CSV generation", () => {
  it("formats signed long hours and decimal rounding without floating-point errors", () => {
    expect(minutesToHhmm(1_501)).toBe("25:01");
    expect(minutesToHhmm(-61)).toBe("-1:01");
    expect(minutesToDecimalHours(1, 2, "half_up")).toBe("0.02");
    expect(minutesToDecimalHours(-1, 2, "half_up")).toBe("-0.02");
    expect(minutesToDecimalHours(1, 2, "truncate")).toBe("0.01");
  });

  it("escapes RFC-style cells, sorts rows, adds a BOM, and produces deterministic bytes", () => {
    expect(escapeCsvCell('姓, "名"\n改行')).toBe('"姓, ""名""\n改行"');
    const rows = [
      {
        employeeId: "2",
        externalEmployeeCode: "B",
        values: { display_name: "山田,花子", worked_minutes: 61 },
      },
      {
        employeeId: "1",
        externalEmployeeCode: "A",
        values: { display_name: "佐藤太郎", worked_minutes: 60 },
      },
    ];
    const first = generatePayrollCsv(config(), rows);
    const second = generatePayrollCsv(config(), rows);

    expect([...first.bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(first.bytes.equals(second.bytes)).toBe(true);
    expect(first.sha256).toBe(second.sha256);
    expect(first.bytes.toString("utf8")).toContain('A,佐藤太郎,1.00\r\nB,"山田,花子",1.02');
  });

  it("prefixes text formulas, does not reject typed negative numbers, and detects CP932 loss", () => {
    const formula = generatePayrollCsv(config(), [
      {
        employeeId: "1",
        externalEmployeeCode: "A",
        values: { display_name: " =SUM(A1:A2)", worked_minutes: -60 },
      },
    ]);
    expect(formula.issues).toMatchObject([{ code: "formula_prefixed", severity: "warning" }]);
    expect(formula.issues.some((issue) => issue.code === "formula_injection")).toBe(false);

    const cp932 = generatePayrollCsv(config("cp932"), [
      {
        employeeId: "1",
        externalEmployeeCode: "A",
        values: { display_name: "絵文字😀", worked_minutes: 60 },
      },
    ]);
    expect(cp932.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "cp932_unrepresentable",
          columnId: "name",
          severity: "error",
        }),
      ]),
    );
  });

  it("creates safe download names and defensive headers", () => {
    const fileName = safeDownloadFileName("../給与-{targetMonth}.csv", { targetMonth: "2026-07" });
    expect(fileName).not.toContain("/");
    expect(payrollCsvDownloadHeaders(fileName)).toMatchObject({
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    });
  });

  it("rejects unavailable legacy fields only when the column is required", () => {
    const legacyConfig = config();
    legacyConfig.columns = [
      {
        id: "leave_units",
        header: "休暇単位",
        source: { kind: "field", field: "leave_units" },
        transform: { kind: "integer" },
        required: true,
        formulaPolicy: "reject",
      },
      {
        id: "holiday_work",
        header: "休日勤務",
        source: { kind: "field", field: "holiday_work_minutes" },
        transform: { kind: "minutes" },
        required: false,
        formulaPolicy: "reject",
      },
    ];
    const result = generatePayrollCsv(legacyConfig, [
      {
        employeeId: "legacy",
        externalEmployeeCode: "L001",
        unavailableFields: ["leave_units", "holiday_work_minutes"],
        values: { holiday_work_minutes: null, leave_units: null },
      },
    ]);

    expect(result.issues).toEqual([
      expect.objectContaining({ code: "unavailable_required", columnId: "leave_units" }),
    ]);
    expect(result.bytes.toString("utf8")).toContain("\r\n,\r\n");
  });

  it("keeps external codes and fixed cell values out of validation issues", () => {
    const privateConfig = config();
    privateConfig.columns = [
      privateConfig.columns[0],
      {
        id: "private_fixed",
        header: "固定区分",
        source: { kind: "fixed", value: "=SECRET-FIXED-CELL" },
        transform: { kind: "text" },
        required: true,
        formulaPolicy: "reject",
      },
    ];
    const result = generatePayrollCsv(privateConfig, [
      {
        employeeId: "private-employee",
        externalEmployeeCode: "=SECRET-EXTERNAL-CODE",
        values: {},
      },
    ]);
    expect(result.issues).toHaveLength(2);
    const serializedIssues = JSON.stringify(result.issues);
    expect(serializedIssues).not.toContain("SECRET-EXTERNAL-CODE");
    expect(serializedIssues).not.toContain("SECRET-FIXED-CELL");
  });
});
