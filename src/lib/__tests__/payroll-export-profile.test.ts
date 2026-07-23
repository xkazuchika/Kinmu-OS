import { describe, expect, it } from "vitest";

import {
  parsePayrollExportProfileConfig,
  payrollExportFieldCatalog,
  payrollExportProfileConfigSchema,
  PAYROLL_PROFILE_LIMITS,
} from "@/lib/payroll-export-profile";
import type { PayrollExportProfileConfig } from "@/lib/payroll-export-types";

function validConfig(): PayrollExportProfileConfig {
  return {
    schemaVersion: 1,
    encoding: "utf8_bom",
    lineEnding: "crlf",
    fileNamePattern: "payroll-{targetMonth}-r{revision}.csv",
    columns: [
      {
        id: "employee_number",
        header: "従業員番号",
        source: { kind: "field", field: "employee_number" },
        transform: { kind: "text" },
        required: true,
        formulaPolicy: "reject",
      },
      {
        id: "worked_hours",
        header: "実働時間",
        source: { kind: "field", field: "worked_minutes" },
        transform: { kind: "decimal_hours", decimalPlaces: 2, rounding: "half_up" },
        required: true,
        formulaPolicy: "reject",
      },
    ],
  };
}

describe("payroll export profile config", () => {
  it("publishes a typed field catalog with compatible transformations", () => {
    const catalog = payrollExportFieldCatalog();

    expect(catalog.find((field) => field.key === "worked_minutes")).toMatchObject({
      valueType: "minutes",
      compatibleTransforms: expect.arrayContaining(["minutes", "hhmm", "decimal_hours"]),
    });
    expect(catalog.find((field) => field.key === "overtime_difference_minutes")).toMatchObject({
      availability: "v05_or_later",
      nullable: true,
    });
  });

  it("accepts allowlisted sources and transformations", () => {
    expect(parsePayrollExportProfileConfig(validConfig())).toEqual(validConfig());
  });

  it("rejects normalized duplicate headers and incompatible transformations", () => {
    const config = validConfig();
    config.columns[1] = {
      ...config.columns[1],
      header: " 従業員番号 ",
      source: { kind: "field", field: "display_name" },
      transform: { kind: "decimal_hours", decimalPlaces: 2, rounding: "truncate" },
    };
    const result = payrollExportProfileConfigSchema.safeParse(config);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.message)).toEqual(
        expect.arrayContaining([
          "正規化すると同じ列名が重複しています。",
          "氏名にdecimal_hours変換は使用できません。",
        ]),
      );
    }
  });

  it("rejects unknown fields, transforms, formulas, and column references", () => {
    for (const column of [
      {
        ...validConfig().columns[0],
        source: { kind: "field", field: "salary_amount" },
      },
      {
        ...validConfig().columns[0],
        transform: { kind: "javascript", expression: "process.exit()" },
      },
      {
        ...validConfig().columns[0],
        source: { kind: "formula", expression: "worked_minutes / 60" },
      },
      {
        ...validConfig().columns[0],
        source: { kind: "column", columnId: "worked_hours" },
      },
    ]) {
      expect(
        payrollExportProfileConfigSchema.safeParse({ ...validConfig(), columns: [column] }).success,
      ).toBe(false);
    }
  });

  it("enforces schema, file name, fixed value, and column count limits", () => {
    expect(
      payrollExportProfileConfigSchema.safeParse({
        ...validConfig(),
        schemaVersion: 99,
      }).success,
    ).toBe(false);
    expect(
      payrollExportProfileConfigSchema.safeParse({
        ...validConfig(),
        fileNamePattern: "../payroll.csv",
      }).success,
    ).toBe(false);
    expect(
      payrollExportProfileConfigSchema.safeParse({
        ...validConfig(),
        columns: [
          {
            ...validConfig().columns[0],
            source: {
              kind: "fixed",
              value: "x".repeat(PAYROLL_PROFILE_LIMITS.fixedValueLength + 1),
            },
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      payrollExportProfileConfigSchema.safeParse({
        ...validConfig(),
        columns: Array.from({ length: PAYROLL_PROFILE_LIMITS.columnCount + 1 }, (_, index) => ({
          ...validConfig().columns[0],
          id: `column_${index}`,
          header: `列${index}`,
        })),
      }).success,
    ).toBe(false);
  });
});
