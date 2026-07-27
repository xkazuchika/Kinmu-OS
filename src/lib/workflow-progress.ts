export type WorkflowStepStatus =
  "blocked" | "completed" | "in_progress" | "not_applicable" | "not_started";

export type WorkflowStep = Readonly<{
  href: string;
  id: string;
  label: string;
  reason?: string;
  status: WorkflowStepStatus;
}>;

export type WorkflowProgress = Readonly<{
  completedCount: number;
  current?: WorkflowStep;
  steps: readonly WorkflowStep[];
  totalCount: number;
}>;

type InitialSetupFacts = Readonly<{
  calendarReady: boolean;
  leaveReady: boolean;
  organizationReady: boolean;
  overtimePolicyReady: boolean;
  peopleReady: boolean;
  workRuleReady: boolean;
}>;

type MonthlyFacts = Readonly<{
  closingStatus: "closed" | "open";
  openDays: number;
  payrollPublished: boolean;
  pendingCorrections: number;
  pendingLeaveRequests: number;
  pendingOvertimeRequests: number;
  unresolvedDays: number;
}>;

function summarize(steps: readonly WorkflowStep[]): WorkflowProgress {
  const applicable = steps.filter((step) => step.status !== "not_applicable");
  return {
    completedCount: applicable.filter((step) => step.status === "completed").length,
    current: applicable.find(
      (step) =>
        step.status === "blocked" || step.status === "in_progress" || step.status === "not_started",
    ),
    steps,
    totalCount: applicable.length,
  };
}

export function initialSetupProgress(facts: InitialSetupFacts) {
  const definitions = [
    {
      complete: facts.organizationReady,
      href: "/about",
      id: "organization",
      label: "組織情報",
      reason: "組織の初期設定を完了してください。",
    },
    {
      complete: facts.peopleReady,
      href: "/employees",
      id: "people",
      label: "従業員・利用者",
      reason: "従業員とログイン利用者を登録してください。",
    },
    {
      complete: facts.workRuleReady,
      href: "/attendance/rules",
      id: "work-rule",
      label: "勤務ルール",
      reason: "所定時刻と所定労働時間を設定してください。",
    },
    {
      complete: facts.calendarReady,
      href: "/calendar",
      id: "calendar",
      label: "勤務カレンダー",
      reason: "勤務曜日と休日を有効化してください。",
    },
    {
      complete: facts.leaveReady,
      href: "/leave/manage",
      id: "leave",
      label: "休暇",
      reason: "利用する休暇種別を登録してください。",
    },
    {
      complete: facts.overtimePolicyReady,
      href: "/overtime/settings",
      id: "overtime",
      label: "残業申請",
      reason: "残業・休日出勤の申請ルールを公開してください。",
    },
  ] as const;
  const firstIncomplete = definitions.findIndex((step) => !step.complete);

  return summarize(
    definitions.map((step, index) => ({
      href: step.href,
      id: step.id,
      label: step.label,
      reason: step.complete ? undefined : step.reason,
      status: step.complete
        ? ("completed" as const)
        : index === firstIncomplete
          ? ("in_progress" as const)
          : ("not_started" as const),
    })),
  );
}

export function monthlyWorkflowProgress(facts: MonthlyFacts) {
  const pendingReviews =
    facts.pendingCorrections + facts.pendingLeaveRequests + facts.pendingOvertimeRequests;
  const blockers = facts.openDays + facts.unresolvedDays + pendingReviews;
  return summarize([
    {
      href: "/attendance?status=open",
      id: "open-days",
      label: "未退勤を確認",
      reason: facts.openDays > 0 ? `未退勤が${facts.openDays}件あります。` : undefined,
      status: facts.openDays > 0 ? "blocked" : "completed",
    },
    {
      href: "/approvals?status=pending",
      id: "reviews",
      label: "申請を審査",
      reason: pendingReviews > 0 ? `審査待ちが${pendingReviews}件あります。` : undefined,
      status: pendingReviews > 0 ? "blocked" : "completed",
    },
    {
      href: "/attendance?status=unresolved",
      id: "unresolved",
      label: "未解決日を確認",
      reason:
        facts.unresolvedDays > 0
          ? `未解決の勤務日が${facts.unresolvedDays}件あります。`
          : undefined,
      status: facts.unresolvedDays > 0 ? "blocked" : "completed",
    },
    {
      href: "/attendance#monthly-closing",
      id: "closing",
      label: "月次勤怠を締める",
      reason:
        facts.closingStatus === "open" && blockers > 0
          ? "先に未退勤、審査待ち、未解決日を解消してください。"
          : undefined,
      status:
        facts.closingStatus === "closed"
          ? "completed"
          : blockers > 0
            ? "not_started"
            : "in_progress",
    },
    {
      href: "/payroll-exports",
      id: "payroll",
      label: "給与連携CSVを生成",
      reason: facts.payrollPublished ? undefined : "公開済みプロファイルがないため任意です。",
      status: facts.payrollPublished
        ? facts.closingStatus === "closed"
          ? "in_progress"
          : "not_started"
        : "not_applicable",
    },
  ]);
}
