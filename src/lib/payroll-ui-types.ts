import type {
  PayrollExportProfileConfig,
  PayrollValidationIssue,
  PayrollValidationSummary,
} from "@/lib/payroll-export-types";

export type PayrollProfile = {
  archivedAt: string | null;
  description: string;
  draftConfig: PayrollExportProfileConfig;
  id: string;
  name: string;
  status: "archived" | "draft" | "published";
  updatedAt: string;
  version: number;
};

export type PayrollProfileVersion = {
  configHash: string;
  configSnapshot: PayrollExportProfileConfig;
  encoding: "cp932" | "utf8_bom";
  id: string;
  lineEnding: "crlf" | "lf";
  profileId: string;
  publishedAt: string;
  version: number;
};

export type PayrollField = {
  availability: "all_revisions" | "v04_or_later" | "v05_or_later";
  compatibleTransforms: string[];
  description: string;
  key: string;
  label: string;
  nullable: boolean;
  valueType: string;
};

export type PayrollMapping = {
  displayName: string;
  employeeId: string;
  employeeNumber: string;
  externalEmployeeCode: string | null;
  mappingVersion: number | null;
  status: string;
};

export type PayrollRun = {
  attendanceRevisionId: string;
  attendanceRevision: number;
  byteCount: number;
  columnCount: number;
  generatedAt: string;
  generatedByUserId: string;
  generatedByName: string;
  id: string;
  isLatestRevision: boolean;
  kind: "generated" | "regenerated";
  manifest: {
    confirmedWarningCodes: string[];
    config: PayrollExportProfileConfig;
    fileName?: string;
    mappings: Array<{ employeeId: string; mappingVersion: number }>;
    profileId: string;
    profileVersion: number;
    profileVersionId: string;
  };
  rowCount: number;
  sha256: string;
  sourceRunId: string | null;
  targetMonth: string;
  validationSummary: PayrollValidationSummary;
};

export type PayrollInspection = {
  context: {
    isLatestRevision: boolean;
    period: { currentRevision: number; status: "closed" | "open" };
    profileVersion: {
      configSnapshot: PayrollExportProfileConfig;
      id: string;
      profileId: string;
      profileName: string;
      version: number;
    };
    revision: { id: string; revision: number };
  };
  issues: PayrollValidationIssue[];
  mappings: Array<{
    employeeId: string;
    mappingVersion: number;
  }>;
  page: number;
  pageCount: number;
  pageSize: number;
  previewRows: Array<{
    cells: Array<{
      columnId: string;
      sourceValue: string | number | null;
      value: string;
    }>;
    displayName?: string;
    employeeId: string;
    externalEmployeeCode: string;
  }>;
  summary: PayrollValidationSummary;
  totalRows: number;
};
