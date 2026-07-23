export const PAYROLL_PROFILE_SCHEMA_VERSION = 1;
export const PAYROLL_GENERATOR_SCHEMA_VERSION = 1;

export const PAYROLL_PROFILE_STATUSES = ["draft", "published", "archived"] as const;
export type PayrollProfileStatus = (typeof PAYROLL_PROFILE_STATUSES)[number];

export const PAYROLL_EXPORT_ENCODINGS = ["utf8_bom", "cp932"] as const;
export type PayrollExportEncoding = (typeof PAYROLL_EXPORT_ENCODINGS)[number];

export const PAYROLL_EXPORT_LINE_ENDINGS = ["crlf", "lf"] as const;
export type PayrollExportLineEnding = (typeof PAYROLL_EXPORT_LINE_ENDINGS)[number];

export const PAYROLL_FORMULA_POLICIES = ["reject", "prefix_apostrophe"] as const;
export type PayrollFormulaPolicy = (typeof PAYROLL_FORMULA_POLICIES)[number];

export const PAYROLL_EXPORT_RUN_KINDS = ["generated", "regenerated"] as const;
export type PayrollExportRunKind = (typeof PAYROLL_EXPORT_RUN_KINDS)[number];

export const PAYROLL_SOURCE_KINDS = ["field", "fixed", "empty"] as const;
export type PayrollSourceKind = (typeof PAYROLL_SOURCE_KINDS)[number];

export const PAYROLL_TRANSFORM_KINDS = [
  "text",
  "integer",
  "minutes",
  "hhmm",
  "decimal_hours",
  "date",
  "year_month",
  "mapped_value",
] as const;
export type PayrollTransformKind = (typeof PAYROLL_TRANSFORM_KINDS)[number];

export const PAYROLL_ROUNDING_MODES = ["half_up", "truncate"] as const;
export type PayrollRoundingMode = (typeof PAYROLL_ROUNDING_MODES)[number];

export type PayrollColumnSource =
  { kind: "field"; field: string } | { kind: "fixed"; value: string } | { kind: "empty" };

export type PayrollColumnTransform = {
  kind: PayrollTransformKind;
  dateFormat?: "YYYY-MM-DD" | "YYYY/MM/DD" | "YYYYMMDD";
  decimalPlaces?: number;
  rounding?: PayrollRoundingMode;
  valueMap?: Record<string, string>;
};

export type PayrollExportColumn = {
  id: string;
  header: string;
  source: PayrollColumnSource;
  transform: PayrollColumnTransform;
  required: boolean;
  formulaPolicy: PayrollFormulaPolicy;
  maxLength?: number;
};

export type PayrollExportProfileConfig = {
  schemaVersion: number;
  encoding: PayrollExportEncoding;
  lineEnding: PayrollExportLineEnding;
  fileNamePattern: string;
  columns: PayrollExportColumn[];
};

export type PayrollEmployeeMappingSnapshot = {
  employeeId: string;
  employeeNumber: string;
  displayName: string;
  externalEmployeeCode: string;
  mappingVersion: number;
};

export type PayrollValidationIssueSeverity = "error" | "warning";

export type PayrollValidationIssue = {
  code: string;
  severity: PayrollValidationIssueSeverity;
  employeeId?: string;
  columnId?: string;
  message: string;
};

export type PayrollValidationSummary = {
  errorCount: number;
  warningCount: number;
  issueCounts: Record<string, number>;
};

export type PayrollExportRunManifest = {
  schemaVersion: number;
  generatorVersion: number;
  profileId: string;
  profileVersionId: string;
  profileVersion: number;
  targetMonth: string;
  attendanceRevisionId: string;
  attendanceRevision: number;
  config: PayrollExportProfileConfig;
  fileName?: string;
  mappings: PayrollEmployeeMappingSnapshot[];
  confirmedWarningCodes: string[];
};
