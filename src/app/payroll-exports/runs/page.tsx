"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { PayrollExportNav, PayrollStatus } from "@/components/payroll-export-nav";
import { Button, ConfirmDialog, EmptyState, Field, PageHeader, Toast } from "@/components/ui";
import type { PayrollRun } from "@/lib/payroll-ui-types";

function saveDownload(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function PayrollRunsPage() {
  const regenerateButtonRef = useRef<HTMLButtonElement>(null);
  const [month, setMonth] = useState("");
  const [runs, setRuns] = useState<PayrollRun[]>([]);
  const [regenerateTarget, setRegenerateTarget] = useState<PayrollRun>();
  const [error, setError] = useState<string>();
  const [success, setSuccess] = useState<string>();
  const [loaded, setLoaded] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async (targetMonth: string) => {
    setLoaded(false);
    const response = await fetch(
      `/api/payroll-exports/runs${targetMonth ? `?month=${targetMonth}` : ""}`,
    );
    const payload = (await response.json()) as { error?: string; runs?: PayrollRun[] };
    if (!response.ok) setError(payload.error ?? "出力履歴を取得できませんでした。");
    else {
      setRuns(payload.runs ?? []);
      setError(undefined);
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(""), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function redownload(run: PayrollRun) {
    setSubmitting(true);
    const response = await fetch(`/api/payroll-exports/runs/${run.id}/download`);
    setSubmitting(false);
    if (!response.ok) {
      const payload = (await response.json()) as { error?: string };
      setError(payload.error ?? "保存済みrunを再ダウンロードできませんでした。");
      return;
    }
    saveDownload(await response.blob(), run.manifest.fileName ?? `payroll-${run.targetMonth}.csv`);
    setSuccess("保存済みマニフェストから再生成し、SHA-256一致を確認しました。");
  }

  async function regenerate() {
    const run = regenerateTarget;
    if (!run) return;
    setRegenerateTarget(undefined);
    setSubmitting(true);
    const response = await fetch("/api/payroll-exports/runs", {
      body: JSON.stringify({
        allowOldRevision: !run.isLatestRevision,
        confirmedWarningCodes: run.manifest.confirmedWarningCodes,
        expectedMappingVersions: Object.fromEntries(
          run.manifest.mappings.map((mapping) => [mapping.employeeId, mapping.mappingVersion]),
        ),
        expectedRevision: run.attendanceRevision,
        month: run.targetMonth,
        profileVersionId: run.manifest.profileVersionId,
        revisionId: run.attendanceRevisionId,
        sourceRunId: run.id,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    setSubmitting(false);
    if (!response.ok) {
      const payload = (await response.json()) as { error?: string };
      setError(
        response.status === 409
          ? "元runの条件から変更があります。対象月をもう一度検査してください。"
          : (payload.error ?? "同条件で再生成できませんでした。"),
      );
      return;
    }
    saveDownload(await response.blob(), run.manifest.fileName ?? `payroll-${run.targetMonth}.csv`);
    setSuccess("同じ条件を再検査し、新しいrunとして生成しました。");
    await load(month);
  }

  return (
    <main className="payroll-page">
      <PageHeader title="給与連携の出力履歴">
        生成条件とハッシュを追記型で保持し、保存済みrunを再ダウンロードできます。
      </PageHeader>
      <PayrollExportNav />
      <Toast tone="error">{error}</Toast>
      <Toast tone="success">{success}</Toast>
      <form
        className="payroll-history-filter"
        onSubmit={(event) => {
          event.preventDefault();
          void load(month);
        }}
      >
        <Field
          id="run-month"
          label="対象月"
          onChange={(event) => setMonth(event.target.value)}
          type="month"
          value={month}
        />
        <Button type="submit" variant="secondary">
          絞り込む
        </Button>
        {month ? (
          <Button
            onClick={() => {
              setMonth("");
              void load("");
            }}
            type="button"
            variant="text"
          >
            条件を解除
          </Button>
        ) : null}
      </form>
      {!loaded ? (
        <EmptyState title="出力履歴を読み込んでいます">しばらくお待ちください。</EmptyState>
      ) : runs.length === 0 ? (
        <EmptyState title="出力履歴はありません">
          締め済みの月を全件検査してCSVを生成してください。
        </EmptyState>
      ) : (
        <section className="payroll-run-list" aria-label="給与連携出力run一覧">
          {runs.map((run) => (
            <article id={run.id} key={run.id}>
              <header>
                <div>
                  <PayrollStatus tone={run.isLatestRevision ? "success" : "warning"}>
                    {run.isLatestRevision ? "現在の締め版" : "旧リビジョン"}
                  </PayrollStatus>
                  <h2>{run.targetMonth.replace("-", "年")}月</h2>
                </div>
                <span>{run.kind === "regenerated" ? "再生成" : "生成"}</span>
              </header>
              <dl>
                <div>
                  <dt>run ID</dt>
                  <dd>
                    <code>{run.id}</code>
                  </dd>
                </div>
                <div>
                  <dt>締めリビジョン</dt>
                  <dd>{run.attendanceRevision}</dd>
                </div>
                <div>
                  <dt>プロファイル版</dt>
                  <dd>v{run.manifest.profileVersion}</dd>
                </div>
                <div>
                  <dt>生成日時</dt>
                  <dd>{new Date(run.generatedAt).toLocaleString("ja-JP")}</dd>
                </div>
                <div>
                  <dt>生成者</dt>
                  <dd>{run.generatedByName}</dd>
                </div>
                <div>
                  <dt>行・列</dt>
                  <dd>
                    {run.rowCount}名・{run.columnCount}列
                  </dd>
                </div>
                <div>
                  <dt>サイズ</dt>
                  <dd>{run.byteCount.toLocaleString("ja-JP")} bytes</dd>
                </div>
                <div className="payroll-run-hash">
                  <dt>SHA-256</dt>
                  <dd>
                    <code>{run.sha256}</code>
                  </dd>
                </div>
              </dl>
              <div className="payroll-card-actions">
                <Button disabled={submitting} onClick={() => void redownload(run)}>
                  整合性確認して再ダウンロード
                </Button>
                <Button
                  disabled={submitting}
                  onClick={() => setRegenerateTarget(run)}
                  ref={regenerateButtonRef}
                  variant="secondary"
                >
                  同じ条件で新しいrunを生成
                </Button>
              </div>
            </article>
          ))}
        </section>
      )}
      <ConfirmDialog
        confirmDisabled={submitting}
        confirmLabel="新しいrunを生成"
        onCancel={() => setRegenerateTarget(undefined)}
        onConfirm={() => void regenerate()}
        open={Boolean(regenerateTarget)}
        returnFocusRef={regenerateButtonRef}
        title="同じ条件で再生成しますか？"
      >
        <p>
          元runは変更せず、新しい追記型runとして保存します。締め版・設定・コード対応を再検査します。
        </p>
        {regenerateTarget && !regenerateTarget.isLatestRevision ? (
          <p>
            <strong>旧締めリビジョンからの生成です。</strong>{" "}
            現在版と取り違えないよう確認してください。
          </p>
        ) : null}
      </ConfirmDialog>
    </main>
  );
}
