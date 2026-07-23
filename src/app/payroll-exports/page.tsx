"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { PayrollExportNav, PayrollStatus } from "@/components/payroll-export-nav";
import { EmptyState, Field, PageHeader, Toast } from "@/components/ui";
import type { PayrollProfile, PayrollProfileVersion, PayrollRun } from "@/lib/payroll-ui-types";

type Closing = {
  payrollExport: {
    latestRun: PayrollRun | null;
    latestRunCount: number;
    oldRevisionRunCount: number;
    status: "generated" | "month_open" | "not_generated";
  };
  period: { currentRevision: number | null; status: "closed" | "open" };
};

const currentMonth = () => new Date().toISOString().slice(0, 7);
const statusCopy = {
  generated: ["出力済み", "success"],
  month_open: ["月次締めが必要", "warning"],
  not_generated: ["未生成", "neutral"],
} as const;

export default function PayrollExportHomePage() {
  const [month, setMonth] = useState(currentMonth());
  const [closing, setClosing] = useState<Closing>();
  const [profiles, setProfiles] = useState<PayrollProfile[]>([]);
  const [version, setVersion] = useState<PayrollProfileVersion>();
  const [error, setError] = useState<string>();
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async (targetMonth: string) => {
    setLoaded(false);
    const [closingResponse, profilesResponse] = await Promise.all([
      fetch(`/api/attendance/closing?month=${targetMonth}`),
      fetch("/api/payroll-exports/profiles"),
    ]);
    const closingPayload = (await closingResponse.json()) as { closing?: Closing; error?: string };
    const profilesPayload = (await profilesResponse.json()) as {
      error?: string;
      profiles?: PayrollProfile[];
    };
    if (!closingResponse.ok || !profilesResponse.ok) {
      setError(
        closingPayload.error ?? profilesPayload.error ?? "給与連携の状態を取得できませんでした。",
      );
      setLoaded(true);
      return;
    }
    const nextProfiles = profilesPayload.profiles ?? [];
    setClosing(closingPayload.closing);
    setProfiles(nextProfiles);
    const published = nextProfiles.find((profile) => profile.status === "published");
    if (published) {
      const detailResponse = await fetch(`/api/payroll-exports/profiles/${published.id}`);
      const detailPayload = (await detailResponse.json()) as {
        detail?: { versions: PayrollProfileVersion[] };
      };
      setVersion(detailPayload.detail?.versions.at(0));
    } else {
      setVersion(undefined);
    }
    setError(undefined);
    setLoaded(true);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(month), 0);
    return () => window.clearTimeout(timer);
  }, [load, month]);

  const exportState = closing?.payrollExport.status ?? "not_generated";
  const [exportLabel, exportTone] = statusCopy[exportState];
  const nextHref =
    closing?.period.status !== "closed"
      ? `/attendance?month=${month}`
      : version
        ? `/payroll-exports/inspect?month=${month}&profileVersionId=${version.id}`
        : "/payroll-exports/profiles";
  const nextLabel =
    closing?.period.status !== "closed"
      ? "月次締めを確認"
      : version
        ? "全件検査へ進む"
        : "プロファイルを公開";

  return (
    <main className="payroll-page">
      <PageHeader title="給与連携">
        締め済みの勤務実績を検査し、給与ソフトへ渡すCSVを安全に生成します。
      </PageHeader>
      <PayrollExportNav />
      <Toast tone="error">{error}</Toast>
      <section className="payroll-month-bar" aria-labelledby="payroll-month-heading">
        <div>
          <p className="payroll-eyebrow">PAYROLL EXPORT</p>
          <h2 id="payroll-month-heading">{month.replace("-", "年")}月の出力準備</h2>
        </div>
        <Field
          id="payroll-home-month"
          label="対象月"
          onChange={(event) => setMonth(event.target.value)}
          type="month"
          value={month}
        />
      </section>

      {!loaded ? (
        <EmptyState title="状態を読み込んでいます">しばらくお待ちください。</EmptyState>
      ) : (
        <>
          <section className="payroll-workflow" aria-labelledby="payroll-workflow-heading">
            <div className="payroll-workflow__heading">
              <div>
                <PayrollStatus tone={exportTone}>{exportLabel}</PayrollStatus>
                <h2 id="payroll-workflow-heading">CSV生成までの確認</h2>
                <p>締め内容と設定を固定してから、全従業員を一括検査します。</p>
              </div>
              <Link className="ui-button ui-button--primary" href={nextHref}>
                {nextLabel}
              </Link>
            </div>
            <ol className="payroll-steps">
              <li data-complete={closing?.period.status === "closed"}>
                <span>1</span>
                <div>
                  <strong>月次締め</strong>
                  <small>
                    {closing?.period.status === "closed"
                      ? `締め済み・リビジョン ${closing.period.currentRevision}`
                      : "勤怠を締めて内容を固定します"}
                  </small>
                </div>
              </li>
              <li data-complete={Boolean(version)}>
                <span>2</span>
                <div>
                  <strong>公開プロファイル</strong>
                  <small>
                    {version
                      ? `v${version.version}・${version.encoding === "cp932" ? "CP932" : "UTF-8 BOM"}`
                      : "公開版がありません"}
                  </small>
                </div>
              </li>
              <li data-complete={exportState === "generated"}>
                <span>3</span>
                <div>
                  <strong>検査・CSV生成</strong>
                  <small>
                    {exportState === "generated"
                      ? "現在の締め版を出力済み"
                      : "全件検査後に生成できます"}
                  </small>
                </div>
              </li>
            </ol>
          </section>

          <dl className="payroll-summary">
            <div>
              <dt>締め状態</dt>
              <dd>{closing?.period.status === "closed" ? "締め済み" : "編集中"}</dd>
            </div>
            <div>
              <dt>プロファイル</dt>
              <dd>{version ? `公開版 v${version.version}` : "未公開"}</dd>
            </div>
            <div>
              <dt>現在版のrun</dt>
              <dd>{closing?.payrollExport.latestRunCount ?? 0}件</dd>
            </div>
            <div>
              <dt>旧版のrun</dt>
              <dd>{closing?.payrollExport.oldRevisionRunCount ?? 0}件</dd>
            </div>
          </dl>

          {closing?.payrollExport.latestRun ? (
            <section className="payroll-latest-run" aria-labelledby="payroll-latest-heading">
              <div>
                <p className="payroll-eyebrow">LATEST RUN</p>
                <h2 id="payroll-latest-heading">最新の出力</h2>
              </div>
              <div>
                <strong>
                  {closing.payrollExport.latestRun.manifest.fileName ?? "給与連携CSV"}
                </strong>
                <span>
                  {closing.payrollExport.latestRun.rowCount}名・
                  {new Date(closing.payrollExport.latestRun.generatedAt).toLocaleString("ja-JP")}
                </span>
              </div>
              <Link href={`/payroll-exports/runs#${closing.payrollExport.latestRun.id}`}>
                詳細を表示
              </Link>
            </section>
          ) : (
            <EmptyState
              action={<Link href={nextHref}>{nextLabel}</Link>}
              title="この締め版の出力はまだありません"
            >
              全件検査でエラーが0件になるとCSVを生成できます。
            </EmptyState>
          )}
        </>
      )}
      <p className="payroll-scope-note">
        Kinmu-OSは勤怠値の連携用CSVを生成します。給与・税・社会保険・割増賃金の計算や法令判定、振込、給与明細の作成は行いません。
      </p>
    </main>
  );
}
