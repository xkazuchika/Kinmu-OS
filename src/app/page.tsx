import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import Link from "next/link";

import { AppShell } from "@/components/app-shell";
import { AttendancePanel } from "@/components/attendance-panel";
import { ClockIcon, ReportIcon } from "@/components/icons";
import { EmptyState, PageHeader } from "@/components/ui";
import { sessionForToken, SESSION_COOKIE_NAME } from "@/lib/auth";
import { getAttendanceState, type PunchType } from "@/lib/attendance";
import { getDatabase } from "@/lib/db/client";
import { organizations } from "@/lib/db/schema";
import { managementDashboard } from "@/lib/reporting";

export const dynamic = "force-dynamic";

function EmployeeHome({
  attendance,
  dateLabel,
}: {
  attendance: { actions: PunchType[]; stateLabel: string; workDate: string };
  dateLabel: string;
}) {
  return (
    <main className="employee-home">
      <PageHeader title="おはようございます">{dateLabel}</PageHeader>
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

function ManagementHome({ summary }: { summary: Awaited<ReturnType<typeof managementDashboard>> }) {
  return (
    <main className="management-home">
      <PageHeader title="今日の状況">従業員と勤怠の確認が必要な項目をまとめます。</PageHeader>
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
      </dl>
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

export default async function HomePage() {
  const cookieStore = await cookies();
  const database = getDatabase();
  const actor = await sessionForToken(database, cookieStore.get(SESSION_COOKIE_NAME)?.value);

  if (!actor) {
    return (
      <main className="landing-page">
        <h1>毎日の勤怠を、もっと静かに、確かに。</h1>
        <p>従業員100名以下のチームのための、セルフホスト型勤怠管理ソフトです。</p>
        <div className="landing-actions">
          <Link href="/login">ログイン</Link>
          <Link href="/setup">初期設定</Link>
        </div>
      </main>
    );
  }

  let employeeHome = (
    <EmployeeHome
      attendance={{ actions: ["clock_in"], stateLabel: "未出勤", workDate: "" }}
      dateLabel="今日"
    />
  );

  if (actor.role === "employee") {
    const [organization] = await database
      .select({ timezone: organizations.timezone })
      .from(organizations)
      .where(eq(organizations.id, actor.organizationId))
      .limit(1);
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
    employeeHome = <EmployeeHome attendance={attendance} dateLabel={dateLabel} />;
  }

  const dashboard =
    actor.role === "employee"
      ? undefined
      : await managementDashboard(
          database,
          actor.organizationId,
          new Date().toISOString().slice(0, 7),
        );
  return (
    <AppShell actor={{ displayName: actor.displayName, role: actor.role }}>
      {actor.role === "employee" ? employeeHome : <ManagementHome summary={dashboard!} />}
    </AppShell>
  );
}
