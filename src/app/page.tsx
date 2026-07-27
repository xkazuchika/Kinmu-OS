import { cookies } from "next/headers";
import { and, count, eq, inArray, isNotNull, ne } from "drizzle-orm";
import Link from "next/link";

import { AppShell } from "@/components/app-shell";
import { AttendancePanel } from "@/components/attendance-panel";
import { ClockIcon, HomeIcon, PeopleIcon, ReportIcon, ShieldIcon } from "@/components/icons";
import { EmptyState, PageHeader } from "@/components/ui";
import { WorkflowProgressPanel } from "@/components/workflow-progress";
import { sessionForToken, SESSION_COOKIE_NAME } from "@/lib/auth";
import { getAttendanceState, type PunchType } from "@/lib/attendance";
import { getAttendanceMonthStatus } from "@/lib/attendance-closing";
import type { AppDatabase } from "@/lib/db/client";
import { getDatabase } from "@/lib/db/client";
import {
  attendanceCorrectionRequests,
  approvalCases,
  employees,
  leaveRequests,
  leaveTypes,
  organizations,
  overtimeRequestPolicies,
  overtimeWorkRequests,
  payrollExportProfileVersions,
  users,
  workCalendarPatterns,
  workRules,
} from "@/lib/db/schema";
import { managementDashboard } from "@/lib/reporting";
import {
  initialSetupProgress,
  monthlyWorkflowProgress,
  type WorkflowProgress,
} from "@/lib/workflow-progress";

export const dynamic = "force-dynamic";

function EmployeeHome({
  approvalCount = 0,
  attention,
  attendance,
  dateLabel,
}: {
  approvalCount?: number;
  attention: { corrections: number; leave: number; overtime: number };
  attendance: { actions: PunchType[]; stateLabel: string; workDate: string };
  dateLabel: string;
}) {
  return (
    <main className="employee-home">
      <PageHeader context={dateLabel} status={attendance.stateLabel} title="今日の勤怠">
        現在の状態を確認し、次の打刻を記録します。
      </PageHeader>
      <AttendancePanel initialState={attendance} />
      <section className="home-section">
        <h2>
          <ClockIcon /> 今日の予定
        </h2>
        <EmptyState title="勤務ルールが未設定です">
          労務管理者に勤務ルールの設定を依頼してください。
        </EmptyState>
      </section>
      <section className="home-section">
        <h2>申請と確認</h2>
        <ul className="employee-attention-list">
          {approvalCount > 0 ? (
            <li>
              <Link href="/approvals">
                <span>自分の承認担当</span>
                <strong>{approvalCount}件が審査待ち</strong>
              </Link>
            </li>
          ) : null}
          <li>
            <Link href="/requests">
              <span>勤怠修正</span>
              <strong>{attention.corrections}件が対応中</strong>
            </Link>
          </li>
          <li>
            <Link href="/leave">
              <span>休暇</span>
              <strong>{attention.leave}件が対応中</strong>
            </Link>
          </li>
          <li>
            <Link href="/overtime">
              <span>残業・休日出勤</span>
              <strong>{attention.overtime}件が対応中</strong>
            </Link>
          </li>
        </ul>
      </section>
      <section className="home-section">
        <h2>
          <ReportIcon /> 今月の勤務
        </h2>
        <dl className="work-summary">
          <div>
            <dt>実労働</dt>
            <dd>—</dd>
          </div>
          <div>
            <dt>所定</dt>
            <dd>—</dd>
          </div>
          <div>
            <dt>残業</dt>
            <dd>—</dd>
          </div>
        </dl>
      </section>
    </main>
  );
}

function ManagementHome({
  initialProgress,
  monthlyProgress,
  summary,
}: {
  initialProgress: WorkflowProgress;
  monthlyProgress: WorkflowProgress;
  summary: Awaited<ReturnType<typeof managementDashboard>>;
}) {
  return (
    <main className="management-home">
      <PageHeader
        status={
          monthlyProgress.current ? `次: ${monthlyProgress.current.label}` : "今月の作業は完了"
        }
        title="今日の状況"
      >
        確認が必要な項目と、次に進める月次業務をまとめます。
      </PageHeader>
      {initialProgress.completedCount < initialProgress.totalCount ? (
        <WorkflowProgressPanel progress={initialProgress} title="初期設定" />
      ) : (
        <WorkflowProgressPanel progress={monthlyProgress} title="今月の業務" />
      )}
      <dl className="dashboard-summary">
        <div>
          <dt>在籍従業員</dt>
          <dd>{summary.activeEmployees}名</dd>
        </div>
        <div>
          <dt>未退勤</dt>
          <dd>
            <Link href="/attendance?status=open">{summary.openDays}件</Link>
          </dd>
        </div>
        <div>
          <dt>今月の残業</dt>
          <dd>
            {Math.round(summary.overtime.reduce((sum, row) => sum + row.overtimeMinutes, 0) / 60)}
            時間
          </dd>
        </div>
        <div>
          <dt>未処理の勤怠申請</dt>
          <dd>
            <Link href="/approvals?status=pending&requestType=attendance_correction">
              {summary.pendingCorrections}件
            </Link>
          </dd>
        </div>
        <div>
          <dt>未解決の勤務日</dt>
          <dd>
            <Link href="/attendance?status=unresolved">{summary.unresolvedDays}件</Link>
          </dd>
        </div>
        <div>
          <dt>審査待ち休暇</dt>
          <dd>
            <Link href="/approvals?status=pending&requestType=leave">
              {summary.pendingLeaveRequests}件
            </Link>
          </dd>
        </div>
        <div>
          <dt>審査待ち残業</dt>
          <dd>
            <Link href="/approvals?status=pending&requestType=overtime">
              {summary.pendingOvertimeRequests}件
            </Link>
          </dd>
        </div>
        <div>
          <dt>申請超過</dt>
          <dd>
            <Link href="/attendance?overtimeStatus=exceeded_request">
              {summary.overtimeReconciliations.exceededRequest}件
            </Link>
          </dd>
        </div>
        <div>
          <dt>実績なし</dt>
          <dd>
            <Link href="/attendance?overtimeStatus=no_actual">
              {summary.overtimeReconciliations.noActual}件
            </Link>
          </dd>
        </div>
        <div>
          <dt>未申請の実績</dt>
          <dd>
            <Link href="/attendance?overtimeStatus=unapproved_actual">
              {summary.overtimeReconciliations.unapprovedActual}件
            </Link>
          </dd>
        </div>
        <div>
          <dt>今月の休暇</dt>
          <dd>
            <Link href="/attendance?status=leave">{summary.leaveDays}日</Link>
          </dd>
        </div>
        <div>
          <dt>欠勤</dt>
          <dd>
            <Link href="/attendance?status=absence">{summary.absences}件</Link>
          </dd>
        </div>
        <div>
          <dt>日区分の競合</dt>
          <dd>
            <Link href="/attendance?status=conflict">{summary.conflictingDays}件</Link>
          </dd>
        </div>
      </dl>
      <section className="home-section payroll-home-link">
        <div>
          <p>月次締めの次の仕事</p>
          <h2>給与連携CSVを準備</h2>
          <span>締め済み勤怠を全件検査し、再現可能なCSVとして出力します。</span>
        </div>
        <Link className="ui-button ui-button--secondary" href="/payroll-exports">
          給与連携を開く
        </Link>
      </section>
      <section className="home-section">
        <h2>従業員別の残業</h2>
        {summary.overtime.length === 0 ? (
          <EmptyState
            action={<Link href="/employees">従業員台帳を開く</Link>}
            title="集計対象がありません"
          >
            退勤済みの勤務実績がここに表示されます。
          </EmptyState>
        ) : (
          <ul className="overtime-ranking">
            {summary.overtime.slice(0, 10).map((row) => (
              <li key={row.employeeId}>
                <Link href={`/attendance?employeeId=${row.employeeId}`}>{row.displayName}</Link>
                <strong>
                  {Math.floor(row.overtimeMinutes / 60)}時間{row.overtimeMinutes % 60}分
                </strong>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

async function managementWorkflowProgress(
  database: AppDatabase,
  organizationId: string,
  targetMonth: string,
  summaryPromise: ReturnType<typeof managementDashboard>,
) {
  const [
    [organization],
    [linkedEmployees],
    [activeUsers],
    [rules],
    [calendars],
    [leave],
    [overtime],
    [payrollVersions],
    monthStatus,
    summary,
  ] = await Promise.all([
    database
      .select({ setupCompletedAt: organizations.setupCompletedAt })
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .limit(1),
    database
      .select({ value: count() })
      .from(employees)
      .where(
        and(
          eq(employees.organizationId, organizationId),
          ne(employees.status, "terminated"),
          isNotNull(employees.userId),
        ),
      ),
    database
      .select({ value: count() })
      .from(users)
      .where(and(eq(users.organizationId, organizationId), eq(users.status, "active"))),
    database
      .select({ value: count() })
      .from(workRules)
      .where(eq(workRules.organizationId, organizationId)),
    database
      .select({ value: count() })
      .from(workCalendarPatterns)
      .where(
        and(
          eq(workCalendarPatterns.organizationId, organizationId),
          eq(workCalendarPatterns.status, "active"),
        ),
      ),
    database
      .select({ value: count() })
      .from(leaveTypes)
      .where(and(eq(leaveTypes.organizationId, organizationId), eq(leaveTypes.active, true))),
    database
      .select({ value: count() })
      .from(overtimeRequestPolicies)
      .where(
        and(
          eq(overtimeRequestPolicies.organizationId, organizationId),
          eq(overtimeRequestPolicies.status, "active"),
        ),
      ),
    database
      .select({ value: count() })
      .from(payrollExportProfileVersions)
      .where(eq(payrollExportProfileVersions.organizationId, organizationId)),
    getAttendanceMonthStatus(database, organizationId, targetMonth),
    summaryPromise,
  ]);

  return {
    initial: initialSetupProgress({
      calendarReady: calendars.value > 0,
      leaveReady: leave.value > 0,
      organizationReady: Boolean(organization?.setupCompletedAt),
      overtimePolicyReady: overtime.value > 0,
      peopleReady:
        summary.activeEmployees > 0 && linkedEmployees.value > 0 && activeUsers.value > 1,
      workRuleReady: rules.value > 0,
    }),
    monthly: monthlyWorkflowProgress({
      closingStatus: monthStatus.status,
      openDays: summary.openDays,
      payrollPublished: payrollVersions.value > 0,
      pendingCorrections: summary.pendingCorrections,
      pendingLeaveRequests: summary.pendingLeaveRequests,
      pendingOvertimeRequests: summary.pendingOvertimeRequests,
      unresolvedDays: summary.unresolvedDays,
    }),
  };
}

function PublicLanding() {
  return (
    <main className="landing-page">
      <header className="landing-header">
        <Link className="landing-brand" href="/">
          <span aria-hidden="true">K</span>
          KINMU-OS
        </Link>
        <nav aria-label="公開メニュー" className="landing-nav">
          <a href="https://github.com/xkazuchika/Kinmu-OS">GitHub</a>
          <Link className="landing-nav__login" href="/login">
            ログイン
          </Link>
        </nav>
      </header>

      <section className="landing-hero">
        <div className="landing-copy">
          <h1>
            勤怠と労務を、
            <br />
            すっきりひとつに。
          </h1>
          <p className="landing-lead">
            従業員100名以下のチームのための、セルフホスト型労務管理ソフトです。
            毎日の出退勤から従業員台帳、残業集計まで、必要な仕事を迷わず進められます。
          </p>
          <div className="landing-actions">
            <Link className="landing-action landing-action--primary" href="/login">
              ログイン
            </Link>
            <Link className="landing-action landing-action--secondary" href="/setup">
              初期設定を始める
            </Link>
          </div>
          <ul className="landing-points">
            <li>
              <ShieldIcon /> データを自社環境で管理
            </li>
            <li>
              <PeopleIcon /> 100名以下のチームに最適
            </li>
          </ul>
        </div>

        <div aria-label="Kinmu-OSの管理画面プレビュー" className="landing-preview">
          <div className="landing-preview__bar">
            <span />
            <span />
            <span />
            <small>kinmu-os.local</small>
          </div>
          <div className="landing-preview__app">
            <aside>
              <strong>KINMU-OS</strong>
              <ul>
                <li className="is-current">
                  <HomeIcon /> ホーム
                </li>
                <li>
                  <PeopleIcon /> 従業員
                </li>
                <li>
                  <ClockIcon /> 勤怠
                </li>
                <li>
                  <ReportIcon /> レポート
                </li>
              </ul>
            </aside>
            <div className="landing-preview__content">
              <header>
                <div>
                  <h2>今日の状況</h2>
                  <p>確認が必要な項目をまとめます。</p>
                </div>
                <span aria-hidden="true" className="landing-preview__avatar">
                  K
                </span>
              </header>
              <dl>
                <div>
                  <dt>在籍従業員</dt>
                  <dd>—</dd>
                </div>
                <div>
                  <dt>未退勤</dt>
                  <dd>—</dd>
                </div>
                <div>
                  <dt>今月の残業</dt>
                  <dd>—</dd>
                </div>
              </dl>
              <section>
                <h3>従業員別の残業</h3>
                <div className="landing-preview__empty">
                  <ReportIcon />
                  <strong>勤務実績をすっきり確認</strong>
                  <span>集計結果がここに表示されます</span>
                </div>
              </section>
            </div>
          </div>
        </div>
      </section>

      <footer className="landing-footer">
        <span>Kinmu-OS</span>
        <span>あなたの職場のデータを、あなたの管理下に。</span>
      </footer>
    </main>
  );
}

export default async function HomePage() {
  const cookieStore = await cookies();
  const database = getDatabase();
  const actor = await sessionForToken(database, cookieStore.get(SESSION_COOKIE_NAME)?.value);

  if (!actor) {
    return <PublicLanding />;
  }

  let employeeHome = (
    <EmployeeHome
      attention={{ corrections: 0, leave: 0, overtime: 0 }}
      attendance={{ actions: ["clock_in"], stateLabel: "未出勤", workDate: "" }}
      dateLabel="今日"
    />
  );

  if (actor.role === "employee" || actor.role === "approver") {
    const [[organization], [employee]] = await Promise.all([
      database
        .select({ timezone: organizations.timezone })
        .from(organizations)
        .where(eq(organizations.id, actor.organizationId))
        .limit(1),
      database
        .select({ id: employees.id })
        .from(employees)
        .where(
          and(
            eq(employees.organizationId, actor.organizationId),
            eq(employees.userId, actor.userId),
          ),
        )
        .limit(1),
    ]);
    const dateLabel = new Intl.DateTimeFormat("ja-JP", {
      day: "numeric",
      month: "long",
      timeZone: organization?.timezone ?? "Asia/Tokyo",
      weekday: "short",
    }).format(new Date());
    let attendance = { actions: ["clock_in"] as PunchType[], stateLabel: "未出勤", workDate: "" };
    try {
      attendance = await getAttendanceState(database, actor);
    } catch {
      // The employee record can be linked later by a labor administrator.
    }
    const attention = employee
      ? await Promise.all([
          database
            .select({ value: count() })
            .from(attendanceCorrectionRequests)
            .where(
              and(
                eq(attendanceCorrectionRequests.employeeId, employee.id),
                inArray(attendanceCorrectionRequests.status, ["pending", "returned"]),
              ),
            ),
          database
            .select({ value: count() })
            .from(leaveRequests)
            .where(
              and(
                eq(leaveRequests.employeeId, employee.id),
                inArray(leaveRequests.status, ["pending", "returned"]),
              ),
            ),
          database
            .select({ value: count() })
            .from(overtimeWorkRequests)
            .where(
              and(
                eq(overtimeWorkRequests.employeeId, employee.id),
                inArray(overtimeWorkRequests.status, ["pending", "returned"]),
              ),
            ),
        ])
      : [[{ value: 0 }], [{ value: 0 }], [{ value: 0 }]];
    const [assigned] =
      actor.role === "approver"
        ? await database
            .select({ value: count() })
            .from(approvalCases)
            .where(
              and(
                eq(approvalCases.organizationId, actor.organizationId),
                eq(approvalCases.assignedApproverUserId, actor.userId),
                eq(approvalCases.status, "pending"),
              ),
            )
        : [{ value: 0 }];
    employeeHome = (
      <EmployeeHome
        approvalCount={assigned?.value ?? 0}
        attention={{
          corrections: attention[0][0]?.value ?? 0,
          leave: attention[1][0]?.value ?? 0,
          overtime: attention[2][0]?.value ?? 0,
        }}
        attendance={attendance}
        dateLabel={dateLabel}
      />
    );
  }

  const targetMonth = new Date().toISOString().slice(0, 7);
  const dashboardPromise =
    actor.role === "employee" || actor.role === "approver"
      ? undefined
      : managementDashboard(database, actor.organizationId, targetMonth);
  const [dashboard, progress] = dashboardPromise
    ? await Promise.all([
        dashboardPromise,
        managementWorkflowProgress(database, actor.organizationId, targetMonth, dashboardPromise),
      ])
    : [undefined, undefined];
  return (
    <AppShell actor={{ displayName: actor.displayName, role: actor.role }}>
      {actor.role === "employee" || actor.role === "approver" ? (
        employeeHome
      ) : (
        <ManagementHome
          initialProgress={progress!.initial}
          monthlyProgress={progress!.monthly}
          summary={dashboard!}
        />
      )}
    </AppShell>
  );
}
