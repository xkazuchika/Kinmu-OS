import { z } from "zod";

import {
  PAYROLL_PROFILE_SCHEMA_VERSION,
  type PayrollExportProfileConfig,
  type PayrollTransformKind,
} from "@/lib/payroll-export-types";

export const PAYROLL_PROFILE_LIMITS = {
  columnCount: 60,
  columnHeaderLength: 120,
  columnIdLength: 64,
  configBytes: 262_144,
  fileNamePatternLength: 180,
  fixedValueLength: 1_000,
  mappedValueCount: 100,
  mappedValueKeyLength: 128,
  mappedValueLength: 500,
} as const;

export type PayrollFieldValueType = "text" | "integer" | "minutes" | "date" | "year_month" | "enum";

export type PayrollExportField = {
  key: string;
  label: string;
  description: string;
  valueType: PayrollFieldValueType;
  nullable: boolean;
  availability: "all_revisions" | "v04_or_later" | "v05_or_later";
};

export const PAYROLL_EXPORT_FIELDS = [
  {
    key: "external_employee_code",
    label: "外部従業員コード",
    description: "プロファイルごとに対応付けた給与ソフト側の従業員コード",
    valueType: "text",
    nullable: true,
    availability: "all_revisions",
  },
  {
    key: "employee_id",
    label: "Kinmu従業員ID",
    description: "Kinmu-OS内の不変な従業員ID",
    valueType: "text",
    nullable: false,
    availability: "all_revisions",
  },
  {
    key: "employee_number",
    label: "従業員番号",
    description: "締め時点の従業員番号",
    valueType: "text",
    nullable: false,
    availability: "all_revisions",
  },
  {
    key: "display_name",
    label: "氏名",
    description: "締め時点の表示名",
    valueType: "text",
    nullable: false,
    availability: "all_revisions",
  },
  {
    key: "department_code",
    label: "部署コード",
    description: "締め時点の主所属部署コード",
    valueType: "text",
    nullable: true,
    availability: "all_revisions",
  },
  {
    key: "department_name",
    label: "部署名",
    description: "締め時点の主所属部署名",
    valueType: "text",
    nullable: true,
    availability: "all_revisions",
  },
  {
    key: "target_month",
    label: "対象年月",
    description: "締めリビジョンの対象年月",
    valueType: "year_month",
    nullable: false,
    availability: "all_revisions",
  },
  {
    key: "attendance_revision",
    label: "締めリビジョン",
    description: "出力元となる月次締めの版番号",
    valueType: "integer",
    nullable: false,
    availability: "all_revisions",
  },
  {
    key: "scheduled_minutes",
    label: "所定時間",
    description: "月次の所定労働時間合計（分）",
    valueType: "minutes",
    nullable: false,
    availability: "all_revisions",
  },
  {
    key: "worked_minutes",
    label: "実働時間",
    description: "月次の実働時間合計（分）",
    valueType: "minutes",
    nullable: true,
    availability: "all_revisions",
  },
  {
    key: "break_minutes",
    label: "休憩時間",
    description: "月次の休憩時間合計（分）",
    valueType: "minutes",
    nullable: true,
    availability: "all_revisions",
  },
  {
    key: "overtime_minutes",
    label: "残業時間",
    description: "月次の残業時間合計（分）",
    valueType: "minutes",
    nullable: true,
    availability: "all_revisions",
  },
  {
    key: "holiday_work_minutes",
    label: "休日勤務時間",
    description: "休日出勤申請に対応する実働時間合計（分）",
    valueType: "minutes",
    nullable: true,
    availability: "v05_or_later",
  },
  {
    key: "leave_units",
    label: "休暇単位",
    description: "月次の休暇取得単位合計（半日を1単位として集計）",
    valueType: "integer",
    nullable: false,
    availability: "v04_or_later",
  },
  {
    key: "leave_scheduled_minutes",
    label: "休暇時間",
    description: "月次の休暇対象所定時間合計（分）",
    valueType: "minutes",
    nullable: false,
    availability: "v04_or_later",
  },
  {
    key: "absence_days",
    label: "欠勤日数",
    description: "欠勤記録がある日数",
    valueType: "integer",
    nullable: false,
    availability: "v04_or_later",
  },
  {
    key: "overtime_requested_minutes",
    label: "申請残業時間",
    description: "残業・休日出勤の申請時間合計（分）",
    valueType: "minutes",
    nullable: true,
    availability: "v05_or_later",
  },
  {
    key: "overtime_actual_minutes",
    label: "申請対象実績時間",
    description: "残業申請と照合した実績時間合計（分）",
    valueType: "minutes",
    nullable: true,
    availability: "v05_or_later",
  },
  {
    key: "overtime_difference_minutes",
    label: "残業申請差異",
    description: "申請時間と実績時間の差異合計（分）",
    valueType: "minutes",
    nullable: true,
    availability: "v05_or_later",
  },
  {
    key: "overtime_reconciliation_status",
    label: "残業照合状態",
    description: "残業申請と実績の月次照合状態",
    valueType: "enum",
    nullable: true,
    availability: "v05_or_later",
  },
] as const satisfies readonly PayrollExportField[];

const payrollFieldByKey: ReadonlyMap<string, PayrollExportField> = new Map(
  PAYROLL_EXPORT_FIELDS.map((field) => [field.key, field]),
);

const simpleTransformSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("text") }).strict(),
  z.object({ kind: z.literal("integer") }).strict(),
  z.object({ kind: z.literal("minutes") }).strict(),
  z.object({ kind: z.literal("hhmm") }).strict(),
  z
    .object({
      kind: z.literal("decimal_hours"),
      decimalPlaces: z.number().int().min(0).max(6),
      rounding: z.enum(["half_up", "truncate"]),
    })
    .strict(),
  z
    .object({
      kind: z.literal("date"),
      dateFormat: z.enum(["YYYY-MM-DD", "YYYY/MM/DD", "YYYYMMDD"]),
    })
    .strict(),
  z.object({ kind: z.literal("year_month") }).strict(),
  z
    .object({
      kind: z.literal("mapped_value"),
      valueMap: z
        .record(
          z.string().max(PAYROLL_PROFILE_LIMITS.mappedValueKeyLength),
          z.string().max(PAYROLL_PROFILE_LIMITS.mappedValueLength),
        )
        .refine((value) => Object.keys(value).length > 0, "区分対応には1件以上の対応値が必要です。")
        .refine(
          (value) => Object.keys(value).length <= PAYROLL_PROFILE_LIMITS.mappedValueCount,
          `区分対応は${PAYROLL_PROFILE_LIMITS.mappedValueCount}件までです。`,
        ),
    })
    .strict(),
]);

const sourceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("field"), field: z.string().min(1).max(80) }).strict(),
  z
    .object({
      kind: z.literal("fixed"),
      value: z.string().max(PAYROLL_PROFILE_LIMITS.fixedValueLength),
    })
    .strict(),
  z.object({ kind: z.literal("empty") }).strict(),
]);

const columnSchema = z
  .object({
    id: z
      .string()
      .min(1)
      .max(PAYROLL_PROFILE_LIMITS.columnIdLength)
      .regex(/^[a-z][a-z0-9_]*$/, "列IDは英小文字から始まる英数字と_で指定してください。"),
    header: z.string().trim().min(1).max(PAYROLL_PROFILE_LIMITS.columnHeaderLength),
    source: sourceSchema,
    transform: simpleTransformSchema,
    required: z.boolean(),
    formulaPolicy: z.enum(["reject", "prefix_apostrophe"]),
    maxLength: z.number().int().positive().max(10_000).optional(),
  })
  .strict();

const compatibleTransforms: Record<PayrollFieldValueType, readonly PayrollTransformKind[]> = {
  text: ["text", "mapped_value"],
  integer: ["text", "integer", "minutes", "mapped_value"],
  minutes: ["text", "integer", "minutes", "hhmm", "decimal_hours"],
  date: ["text", "date"],
  year_month: ["text", "year_month"],
  enum: ["text", "mapped_value"],
};

export function normalizePayrollColumnName(value: string) {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("ja-JP");
}

export const payrollExportProfileConfigSchema = z
  .object({
    schemaVersion: z.literal(PAYROLL_PROFILE_SCHEMA_VERSION),
    encoding: z.enum(["utf8_bom", "cp932"]),
    lineEnding: z.enum(["crlf", "lf"]),
    fileNamePattern: z
      .string()
      .trim()
      .min(1)
      .max(PAYROLL_PROFILE_LIMITS.fileNamePatternLength)
      .refine(
        (value) => !/[\\/\u0000-\u001f\u007f]/u.test(value),
        "ファイル名にパスや制御文字は使えません。",
      )
      .refine(
        (value) => value.toLocaleLowerCase().endsWith(".csv"),
        "ファイル名は.csvで終わる必要があります。",
      )
      .refine((value) => value.includes("{targetMonth}"), "ファイル名には{targetMonth}が必要です。")
      .refine(
        (value) => !/\{(?!targetMonth\}|revision\}|profileName\})[^}]*\}/u.test(value),
        "未知のファイル名プレースホルダーです。",
      ),
    columns: z.array(columnSchema).min(1).max(PAYROLL_PROFILE_LIMITS.columnCount),
  })
  .strict()
  .superRefine((config, context) => {
    const ids = new Set<string>();
    const headers = new Set<string>();

    config.columns.forEach((column, index) => {
      const normalizedHeader = normalizePayrollColumnName(column.header);
      if (ids.has(column.id)) {
        context.addIssue({
          code: "custom",
          message: "列IDが重複しています。",
          path: ["columns", index, "id"],
        });
      }
      if (headers.has(normalizedHeader)) {
        context.addIssue({
          code: "custom",
          message: "正規化すると同じ列名が重複しています。",
          path: ["columns", index, "header"],
        });
      }
      ids.add(column.id);
      headers.add(normalizedHeader);

      if (column.source.kind === "field") {
        const field = payrollFieldByKey.get(column.source.field);
        if (!field) {
          context.addIssue({
            code: "custom",
            message: "許可されていない給与連携フィールドです。",
            path: ["columns", index, "source", "field"],
          });
        } else if (!compatibleTransforms[field.valueType].includes(column.transform.kind)) {
          context.addIssue({
            code: "custom",
            message: `${field.label}に${column.transform.kind}変換は使用できません。`,
            path: ["columns", index, "transform", "kind"],
          });
        }
      } else if (column.transform.kind !== "text" && column.transform.kind !== "mapped_value") {
        context.addIssue({
          code: "custom",
          message: "固定値と空欄には文字列または区分対応だけを使用できます。",
          path: ["columns", index, "transform", "kind"],
        });
      }
    });

    if (Buffer.byteLength(JSON.stringify(config), "utf8") > PAYROLL_PROFILE_LIMITS.configBytes) {
      context.addIssue({
        code: "custom",
        message: `設定は${PAYROLL_PROFILE_LIMITS.configBytes}bytesまでです。`,
      });
    }
  });

export class PayrollProfileConfigValidationError extends Error {
  constructor(readonly issues: z.core.$ZodIssue[]) {
    super("給与連携プロファイル設定が不正です。");
    this.name = "PayrollProfileConfigValidationError";
  }
}

export function parsePayrollExportProfileConfig(input: unknown): PayrollExportProfileConfig {
  const result = payrollExportProfileConfigSchema.safeParse(input);
  if (!result.success) throw new PayrollProfileConfigValidationError(result.error.issues);
  return result.data;
}

export function payrollExportFieldCatalog() {
  return PAYROLL_EXPORT_FIELDS.map((field) => ({
    ...field,
    compatibleTransforms: [...compatibleTransforms[field.valueType]],
  }));
}
